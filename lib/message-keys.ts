import type { AgentMessage, CustomMessage } from "./types";
import { userMessageKey } from "./prompt-recovery";

/** 已存消息使用条目 ID；运行中尚无 ID 时使用最后锚点加偏移。重读后传递旧键以保留组件状态；过程折叠及块位置变化仍可能重新挂载。 */
const liveKey = (anchor: string | undefined, offset: number) => `live:${anchor ?? ""}:${offset}`;

export function messageRenderKeys(entryIds: readonly string[], count: number, aliases: ReadonlyMap<string, string>): string[] {
  const anchor = entryIds[entryIds.length - 1];
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = entryIds[i];
    keys.push(id === undefined ? liveKey(anchor, i - entryIds.length) : aliases.get(id) ?? id);
  }
  return keys;
}

// 磁盘保留 SDK 原消息；用户提示词及自定义消息的时间戳来源可能不同。
function sameMessage(live: AgentMessage, loaded: AgentMessage): boolean {
  if (live.role !== loaded.role) return false;
  if (live.role === "user") return userMessageKey(live) === userMessageKey(loaded);
  if (live.role === "custom") return live.customType === (loaded as CustomMessage).customType;
  return live.timestamp === loaded.timestamp;
}

/** 为重读后的条目继承仍匹配的运行中渲染键，遇到首个不匹配即停止；每个分支内锚点与偏移唯一，避免键冲突。 */
export function carryMessageKeys(
  previous: { messages: readonly AgentMessage[]; entryIds: readonly string[]; aliases: ReadonlyMap<string, string> },
  next: { messages: readonly AgentMessage[]; entryIds: readonly string[] },
): Map<string, string> {
  const loaded = new Set(next.entryIds);
  const aliases = new Map([...previous.aliases].filter(([id]) => loaded.has(id)));
  const liveStart = previous.entryIds.length;
  const anchor = previous.entryIds[liveStart - 1];
  const start = anchor === undefined ? 0 : next.entryIds.indexOf(anchor) + 1;
  // 窗口已越过锚点时，不为该窗口传递旧键。
  if (start === 0 && anchor !== undefined) return aliases;
  for (let offset = 0; liveStart + offset < previous.messages.length; offset++) {
    const id = next.entryIds[start + offset];
    if (id === undefined || !sameMessage(previous.messages[liveStart + offset], next.messages[start + offset])) break;
    aliases.set(id, liveKey(anchor, offset));
  }
  return aliases;
}
