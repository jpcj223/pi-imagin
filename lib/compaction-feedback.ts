/** 只识别 SDK 明确的无操作结果，其余错误保留原诊断。 */
export function getCompactionInfoKey(message: string | null | undefined): string | undefined {
  switch (message?.trim()) {
    // 实时 compaction_end 事件带前缀，HTTP 拒绝响应返回原文。
    case "Nothing to compact (session too small)":
    case "Compaction failed: Nothing to compact (session too small)": return "chat.compactTooSmall";
    case "Already compacted":
    case "Compaction failed: Already compacted": return "chat.compactAlreadyDone";
    default: return undefined;
  }
}
