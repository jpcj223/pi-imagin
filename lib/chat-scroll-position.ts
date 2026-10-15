export type ChatScrollPosition =
  | { atBottom: true }
  | {
      atBottom: false;
      anchorEntryId: string;
      anchorOffset: number;
      oldestEntryId: string | null;
    };

export interface ChatScrollAnchorCandidate {
  entryId: string;
  top: number;
  bottom: number;
}

export const CHAT_SCROLL_POSITIONS_KEY = "pi-web:chat-scroll-positions";
/** 仅保存条目定位和偏移，不保存正文；损坏或过量数据不恢复。 */
export function restoreChatScrollPositions(raw: string | null): Map<string, ChatScrollPosition> {
  const result = new Map<string, ChatScrollPosition>();
  try {
    const data: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(data) || data.length > 20) return result;
    for (const entry of data) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [id, position] = entry;
      if (typeof id !== "string" || id.length > 256 || !position || typeof position !== "object") continue;
      if (position.atBottom === true) result.set(id, { atBottom: true });
      else if (position.atBottom === false && typeof position.anchorEntryId === "string" && position.anchorEntryId.length <= 256
        && Number.isFinite(position.anchorOffset) && Math.abs(position.anchorOffset) <= 10_000_000
        && (position.oldestEntryId === null || typeof position.oldestEntryId === "string" && position.oldestEntryId.length <= 256)) {
        result.set(id, { atBottom: false, anchorEntryId: position.anchorEntryId, anchorOffset: position.anchorOffset, oldestEntryId: position.oldestEntryId });
      }
    }
  } catch { /* 损坏偏好使用默认阅读位置。 */ }
  return result;
}

export function findChatScrollAnchor(
  candidates: ChatScrollAnchorCandidate[],
  viewportTop: number,
): Pick<Extract<ChatScrollPosition, { atBottom: false }>, "anchorEntryId" | "anchorOffset"> | null {
  let candidate = candidates[0];
  for (const item of candidates) {
    if (item.top > viewportTop) break;
    candidate = item;
  }
  if (!candidate) return null;
  return {
    anchorEntryId: candidate.entryId,
    anchorOffset: candidate.top - viewportTop,
  };
}
