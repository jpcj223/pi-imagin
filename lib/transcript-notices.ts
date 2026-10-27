// 客户端通知类型；服务端从历史条目计算后附加在对应展示消息上，浏览器逐行显示。

export type TranscriptNotice =
  /** 助手回复中原本可命中缓存的提示词被重新计费。 */
  | { kind: "cache_miss"; missedTokens: number; missedCost: number; idleMinutes?: number; modelChanged?: boolean }
  /** 模型上下文外的提示词缓存预热计费，来自 kind 为 cache_warm 的 usage 条目。 */
  | { kind: "cache_warm"; cost: number; note?: string }
  /** 压缩或分支摘要的计费。 */
  | { kind: "summary_cost"; source: "compaction" | "branch_summary"; tokens: number; cost: number }
  /** Anthropic 请求转换中丢弃的思考块。 */
  | { kind: "thinking_dropped"; count: number };

/** 展示消息上的通知属性，不属于 SDK 原消息。 */
export const TRANSCRIPT_NOTICES_KEY = "transcriptNotices";

export type WithTranscriptNotices<T> = T & { [TRANSCRIPT_NOTICES_KEY]?: TranscriptNotice[] };

/** 读取展示消息通知；没有时返回空列表。 */
export function getTranscriptNotices(message: unknown): TranscriptNotice[] {
  if (typeof message !== "object" || message === null) return [];
  const notices = (message as Record<string, unknown>)[TRANSCRIPT_NOTICES_KEY];
  return Array.isArray(notices) ? notices as TranscriptNotice[] : [];
}

/** 有通知时返回展示副本，否则保留原消息。 */
export function withTranscriptNotices<T extends object>(message: T, notices: readonly TranscriptNotice[] | undefined): T {
  if (!notices || notices.length === 0) return message;
  return { ...message, [TRANSCRIPT_NOTICES_KEY]: [...notices] };
}

/** 沿用 TUI token 格式：950、8.5k、85k、1.2M。 */
export function formatNoticeTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

/** 费用从一美分开始显示，保留两位小数。 */
export function formatNoticeCost(cost: number): string | undefined {
  return cost >= 0.01 ? `$${cost.toFixed(2)}` : undefined;
}

/** 缓存预热费用保留六位小数，第三位以后移除尾零。 */
export function formatCacheWarmCost(cost: number): string {
  return `$${cost.toFixed(6).replace(/(\.\d{3}\d*?)0+$/, "$1")}`;
}

export interface CacheMissSummary {
  count: number;
  missedTokens: number;
  missedCost: number;
}

/** 为折叠过程详情合计缓存未命中通知；没有时返回 undefined。 */
export function summarizeCacheMisses(messages: readonly unknown[]): CacheMissSummary | undefined {
  let summary: CacheMissSummary | undefined;
  for (const message of messages) {
    for (const notice of getTranscriptNotices(message)) {
      if (notice.kind !== "cache_miss") continue;
      summary ??= { count: 0, missedTokens: 0, missedCost: 0 };
      summary.count += 1;
      summary.missedTokens += notice.missedTokens;
      summary.missedCost += notice.missedCost;
    }
  }
  return summary;
}
