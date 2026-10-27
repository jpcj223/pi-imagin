import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentUsage, SessionEntry } from "./types";
import { withTranscriptNotices, type TranscriptNotice } from "./transcript-notices";

// 按 showCacheMissNotices 从历史条目推导 TUI 同口径通知，重载和分页结果一致；缓存未命中通知不持久化。扫描规则对应 SDK 未公开的 core/cache-stats.js。

/** 长于此值的空闲间隔可作为缓存未命中的可能原因，沿用 Anthropic 默认 TTL。 */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** 忽略阈值内的缓存分块计量噪声。 */
const NOISE_FLOOR_TOKENS = 1024;
/** 重新计费达到 20k token 或 $0.10 时显示通知。 */
const NOTICE_MIN_TOKENS = 20_000;
const NOTICE_MIN_COST = 0.1;

/** 计算完全未命中费用所需的最小模型查询接口。 */
export interface NoticeModelLookup {
  getModel(provider: string, modelId: string): { cost?: { cacheRead?: number } } | undefined;
}

interface UsageMessage {
  role: "assistant";
  provider: string;
  model: string;
  timestamp: number;
  usage: AgentUsage;
  stopReason?: string;
  diagnostics?: unknown;
}

interface PreviousRequest {
  promptTokens: number;
  modelKey: string;
  timestamp: number;
  reportedCache: boolean;
}

export interface CacheMiss {
  missedTokens: number;
  missedCost: number;
  idleMs: number;
  modelChanged: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUsage(value: unknown): value is AgentUsage {
  return isRecord(value)
    && typeof value.input === "number"
    && typeof value.output === "number"
    && typeof value.cacheRead === "number"
    && typeof value.cacheWrite === "number"
    && isRecord(value.cost);
}

function assistantMessageOf(entry: SessionEntry): UsageMessage | undefined {
  if (entry.type !== "message") return undefined;
  const message = entry.message as unknown as Record<string, unknown>;
  if (message.role !== "assistant" || !isUsage(message.usage)) return undefined;
  return message as unknown as UsageMessage;
}

function detectMiss(prev: PreviousRequest | undefined, message: UsageMessage, models: NoticeModelLookup): CacheMiss | undefined {
  const usage = message.usage;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  // 仅此前报告过缓存活动时，零缓存才代表完全未命中；从不报告缓存的服务商不据此判断。
  if (!prev || promptTokens <= 0 || (usage.cacheRead + usage.cacheWrite === 0 && !prev.reportedCache)) {
    return undefined;
  }
  const missedTokens = Math.min(prev.promptTokens, promptTokens) - usage.cacheRead;
  if (missedTokens <= NOISE_FLOOR_TOKENS) return undefined;
  // 未命中计费来自输入或缓存写入桶，采用当前消息费用明细。
  const paidTokens = usage.input + usage.cacheWrite;
  const paidPerToken = paidTokens > 0 ? (usage.cost.input + usage.cost.cacheWrite) / paidTokens : 0;
  const readPerToken = usage.cacheRead > 0
    ? usage.cost.cacheRead / usage.cacheRead
    : (models.getModel(message.provider, message.model)?.cost?.cacheRead ?? 0) / 1_000_000;
  return {
    missedTokens,
    missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken),
    idleMs: Math.max(0, message.timestamp - prev.timestamp),
    modelChanged: `${message.provider}/${message.model}` !== prev.modelKey,
  };
}

function asPreviousRequest(message: UsageMessage, reportedCache: boolean): PreviousRequest | undefined {
  const usage = message.usage;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  if (promptTokens <= 0) return undefined;
  return {
    promptTokens,
    modelKey: `${message.provider}/${message.model}`,
    timestamp: message.timestamp,
    reportedCache: reportedCache || usage.cacheRead + usage.cacheWrite > 0,
  };
}

/** 按文件顺序扫描所有条目，包括其他分支，与 SDK getEntries 和 TUI 一致；结果以条目 ID 索引。 */
export function scanCacheMisses(
  entries: readonly SessionEntry[],
  models: NoticeModelLookup,
): { prev: PreviousRequest | undefined; misses: Map<string, CacheMiss> } {
  let prev: PreviousRequest | undefined;
  const misses = new Map<string, CacheMiss>();
  for (const entry of entries) {
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      // 压缩或分支摘要主动改变上下文，后续请求不算旧内容重新计费；模型切换仍参与判断。
      prev = undefined;
      continue;
    }
    if (entry.type === "usage" && entry.kind === "cache_warm") {
      if (!isUsage(entry.usage)) continue;
      const promptTokens = entry.usage.input + entry.usage.cacheRead + entry.usage.cacheWrite;
      if (promptTokens > 0) {
        prev = {
          promptTokens,
          modelKey: `${entry.provider}/${entry.model}`,
          timestamp: Date.parse(entry.timestamp),
          reportedCache: true,
        };
      }
      continue;
    }
    const message = assistantMessageOf(entry);
    if (!message) continue;
    const miss = detectMiss(prev, message, models);
    if (miss) misses.set(entry.id, miss);
    prev = asPreviousRequest(message, prev?.reportedCache ?? false) ?? prev;
  }
  return { prev, misses };
}

function cacheMissNotice(miss: CacheMiss): TranscriptNotice | undefined {
  if (miss.missedTokens < NOTICE_MIN_TOKENS && miss.missedCost < NOTICE_MIN_COST) return undefined;
  return {
    kind: "cache_miss",
    missedTokens: miss.missedTokens,
    missedCost: miss.missedCost,
    ...(miss.modelChanged
      ? { modelChanged: true }
      : miss.idleMs >= CACHE_TTL_MS ? { idleMinutes: Math.round(miss.idleMs / 60_000) } : {}),
  };
}

/** 读取 Anthropic 对当前请求丢弃的思考块数量。 */
export function countDroppedThinkingBlocks(message: unknown): number {
  if (!isRecord(message) || !Array.isArray(message.diagnostics)) return 0;
  let count = 0;
  for (const diagnostic of message.diagnostics) {
    if (!isRecord(diagnostic) || diagnostic.type !== "anthropic_input_transformations") continue;
    const transformations = isRecord(diagnostic.details) ? diagnostic.details.transformations : undefined;
    if (!Array.isArray(transformations)) continue;
    count += transformations.filter((t) => isRecord(t) && t.type === "thinking_dropped").length;
  }
  return count;
}

/** 仅丢弃数量比上次更多时显示，与 TUI 一致。 */
function thinkingDroppedNotice(dropped: number, previousDropped: number): TranscriptNotice | undefined {
  return dropped > previousDropped ? { kind: "thinking_dropped", count: dropped } : undefined;
}

function summaryCostNotice(source: "compaction" | "branch_summary", usage: unknown): TranscriptNotice | undefined {
  if (!isUsage(usage)) return undefined;
  return {
    kind: "summary_cost",
    source,
    tokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
    cost: typeof usage.cost.total === "number" ? usage.cost.total : 0,
  };
}

/** 可独立展示、可跟随通知的聊天条目。 */
function rendersStandalone(entry: SessionEntry): boolean {
  switch (entry.type) {
    case "message": {
      const role = (entry.message as { role?: string }).role;
      return role !== "toolResult" && role !== "system";
    }
    case "compaction":
      return true;
    case "branch_summary":
      return Boolean(entry.summary);
    case "custom_message":
      return entry.display;
    default:
      return false;
  }
}

function pushNotice(map: Map<string, TranscriptNotice[]>, entryId: string, notice: TranscriptNotice | undefined): void {
  if (!notice) return;
  const list = map.get(entryId);
  if (list) list.push(notice);
  else map.set(entryId, [notice]);
}

/** 通知以其跟随的条目 ID 索引；缓存预热依附最近可见祖先，工具结果随工具调用显示，分页定位保持一致。 */
export function collectTranscriptNotices(
  entries: readonly SessionEntry[],
  models: NoticeModelLookup,
  options: { leafId?: string | null } = {},
): Map<string, TranscriptNotice[]> {
  const notices = new Map<string, TranscriptNotice[]>();
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  const ancestor = (entry: SessionEntry, match: (candidate: SessionEntry) => boolean): SessionEntry | undefined => {
    let current = entry.parentId ? byId.get(entry.parentId) : undefined;
    while (current && !match(current)) current = current.parentId ? byId.get(current.parentId) : undefined;
    return current;
  };
  // 缓存预热可能依附各分支共享祖先，因此只显示在实际计费分支。
  let onBranch: Set<string> | undefined;
  if (options.leafId) {
    onBranch = new Set();
    for (let current = byId.get(options.leafId); current; current = current.parentId ? byId.get(current.parentId) : undefined) {
      onBranch.add(current.id);
    }
  }

  const { misses } = scanCacheMisses(entries, models);
  for (const entry of entries) {
    switch (entry.type) {
      case "message": {
        const message = assistantMessageOf(entry);
        if (!message || message.stopReason === "aborted" || message.stopReason === "error") break;
        const miss = misses.get(entry.id);
        if (miss) pushNotice(notices, entry.id, cacheMissNotice(miss));
        const dropped = countDroppedThinkingBlocks(message);
        if (dropped > 0) {
          const previous = ancestor(entry, (candidate) => Boolean(assistantMessageOf(candidate)));
          const previousDropped = previous?.type === "message" ? countDroppedThinkingBlocks(previous.message) : 0;
          pushNotice(notices, entry.id, thinkingDroppedNotice(dropped, previousDropped));
        }
        break;
      }
      case "usage": {
        if (entry.kind !== "cache_warm" || !isUsage(entry.usage) || (onBranch && !onBranch.has(entry.id))) break;
        const anchor = ancestor(entry, rendersStandalone);
        if (anchor) {
          pushNotice(notices, anchor.id, {
            kind: "cache_warm",
            cost: typeof entry.usage.cost.total === "number" ? entry.usage.cost.total : 0,
            ...(entry.note ? { note: entry.note } : {}),
          });
        }
        break;
      }
      case "compaction":
        pushNotice(notices, entry.id, summaryCostNotice("compaction", entry.usage));
        break;
      case "branch_summary":
        if (entry.summary) pushNotice(notices, entry.id, summaryCostNotice("branch_summary", entry.usage));
        break;
    }
  }
  return notices;
}

/** 为刚结束的助手 message_end 推导通知；SDK 先发事件后落盘，已包含当前消息的条目须排除。 */
export function collectLiveAssistantNotices(
  entries: readonly SessionEntry[],
  branch: readonly SessionEntry[],
  message: unknown,
  models: NoticeModelLookup,
): TranscriptNotice[] {
  if (!isRecord(message) || message.role !== "assistant" || !isUsage(message.usage)) return [];
  if (message.stopReason === "aborted" || message.stopReason === "error") return [];
  const isThis = (entry: SessionEntry) => entry.type === "message" && (entry.message as unknown) === message;
  const assistant = message as unknown as UsageMessage;
  const notices: TranscriptNotice[] = [];

  const { prev } = scanCacheMisses(entries.filter((entry) => !isThis(entry)), models);
  const miss = detectMiss(prev, assistant, models);
  const missNotice = miss ? cacheMissNotice(miss) : undefined;
  if (missNotice) notices.push(missNotice);

  const dropped = countDroppedThinkingBlocks(message);
  if (dropped > 0) {
    let previousDropped = 0;
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (isThis(entry) || !assistantMessageOf(entry) || entry.type !== "message") continue;
      previousDropped = countDroppedThinkingBlocks(entry.message);
      break;
    }
    const droppedNotice = thinkingDroppedNotice(dropped, previousDropped);
    if (droppedNotice) notices.push(droppedNotice);
  }
  return notices;
}

interface CachedSetting {
  stamp: string;
  value: boolean | undefined;
}

const SETTING_CACHE_LIMIT = 200;
const settingCache = new Map<string, CachedSetting>();

/** 不使用 SettingsManager 文件锁读取开关，避免每次历史读取或答复都为锁忙等；按文件状态变化失效缓存。 */
function readSettingFile(path: string): boolean | undefined {
  let stamp: string;
  try {
    const stats = statSync(path);
    stamp = `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
  } catch {
    settingCache.delete(path);
    return undefined;
  }
  const cached = settingCache.get(path);
  if (cached?.stamp === stamp) return cached.value;
  let value: boolean | undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    const raw = isRecord(parsed) ? parsed.showCacheMissNotices : undefined;
    value = typeof raw === "boolean" ? raw : undefined;
  } catch {
    // 配置无法解析时跳过该文件，继续读取另一层配置。
    value = undefined;
  }
  settingCache.delete(path);
  settingCache.set(path, { stamp, value });
  if (settingCache.size > SETTING_CACHE_LIMIT) settingCache.delete(settingCache.keys().next().value!);
  return value;
}

/** 项目 showCacheMissNotices 覆盖全局配置，默认关闭。 */
export function readShowCacheMissNotices(cwd: string, agentDir: string = getAgentDir()): boolean {
  return readSettingFile(join(cwd, ".pi", "settings.json"))
    ?? readSettingFile(join(agentDir, "settings.json"))
    ?? false;
}

/** 完全未命中且运行时未知模型时，采用会话自身已付的缓存读取价格，使后续历史重读计费一致。 */
function sessionCacheReadPrices(entries: readonly SessionEntry[]): NoticeModelLookup {
  const perMillion = new Map<string, number>();
  for (const entry of entries) {
    const message = assistantMessageOf(entry);
    if (!message || message.usage.cacheRead <= 0 || typeof message.usage.cost.cacheRead !== "number") continue;
    perMillion.set(`${message.provider}/${message.model}`, message.usage.cost.cacheRead / message.usage.cacheRead * 1_000_000);
  }
  return {
    getModel: (provider, modelId) => {
      const cacheRead = perMillion.get(`${provider}/${modelId}`);
      return cacheRead === undefined ? undefined : { cost: { cacheRead } };
    },
  };
}

/** 先用会话自身实际价格，再回退模型目录价格，使实时与历史估算一致。 */
export function withSessionPrices(entries: readonly SessionEntry[], models?: NoticeModelLookup): NoticeModelLookup {
  const fromSession = sessionCacheReadPrices(entries);
  return {
    getModel: (provider, modelId) => fromSession.getModel(provider, modelId) ?? models?.getModel(provider, modelId),
  };
}

/** 关闭开关时不计算历史通知；完全未命中使用会话价格再回退已有运行时，避免为浏览历史加载扩展运行时。 */
export function readSessionTranscriptNotices(options: {
  entries: readonly SessionEntry[];
  cwd: string;
  leafId?: string | null;
  models?: NoticeModelLookup;
}): Map<string, TranscriptNotice[]> | undefined {
  if (!options.cwd || !readShowCacheMissNotices(options.cwd)) return undefined;
  return collectTranscriptNotices(options.entries, withSessionPrices(options.entries, options.models), { leafId: options.leafId });
}

/** 为上下文中的各条展示消息附加其通知。 */
export function attachTranscriptNotices<T extends { messages: unknown[]; entryIds: string[] }>(
  context: T,
  notices: Map<string, TranscriptNotice[]> | undefined,
): T {
  if (!notices || notices.size === 0) return context;
  let messages: unknown[] | undefined;
  context.entryIds.forEach((entryId, index) => {
    const list = notices.get(entryId);
    if (!list) return;
    messages ??= [...context.messages];
    messages[index] = withTranscriptNotices(context.messages[index] as object, list);
  });
  return messages ? { ...context, messages } : context;
}
