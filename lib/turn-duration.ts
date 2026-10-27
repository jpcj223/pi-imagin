import type { AgentMessage } from "./types";

function recordedMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** 回复结束时间为请求开始加 SDK 记录的 durationMs。 */
function responseEnd(message: AgentMessage): number | undefined {
  if (message.role !== "assistant") return undefined;
  const start = recordedMs(message.timestamp);
  const duration = recordedMs(message.durationMs);
  return start !== undefined && duration !== undefined ? start + duration : undefined;
}

/** 已回答回合的最终回复；其后由扩展触发的新运行单独计算空闲间隔。 */
function answersTurn(message: AgentMessage): boolean {
  return message.role === "assistant" && (message.stopReason === "stop" || message.stopReason === "length");
}

/** 计算从回合锚点到最后回复或工具结果的耗时，扣除答复后扩展再次启动前的等待。缺少锚点或末条回复 durationMs 时返回 undefined，避免猜测结束时间。 */
export function getTurnDurationMs(messages: AgentMessage[], anchorIdx: number, endIdx: number): number | undefined {
  const start = recordedMs(messages[anchorIdx]?.timestamp);
  if (start === undefined) return undefined;
  let end: number | undefined;
  let lastResponseTimed = false;
  let idle = 0;
  let answeredAt: number | undefined;
  let nextRunAt: number | undefined;
  for (let idx = anchorIdx + 1; idx < endIdx; idx++) {
    const message = messages[idx];
    if (message.role === "assistant") {
      if (answeredAt !== undefined && nextRunAt !== undefined) idle += Math.max(0, nextRunAt - answeredAt);
      answeredAt = nextRunAt = undefined;
      const ended = responseEnd(message);
      lastResponseTimed = ended !== undefined;
      if (ended !== undefined) end = Math.max(end ?? ended, ended);
      if (ended !== undefined && answersTurn(message)) answeredAt = end;
    } else if (message.role === "toolResult") {
      const ended = recordedMs(message.timestamp);
      if (ended !== undefined) end = Math.max(end ?? ended, ended);
    } else if (answeredAt !== undefined) {
      const at = recordedMs(message.timestamp);
      if (at !== undefined) nextRunAt = Math.max(nextRunAt ?? at, at);
    }
  }
  if (!lastResponseTimed || end === undefined) return undefined;
  return Math.max(0, end - start - idle);
}

/** 按整秒显示回合耗时：14s、3m 5s、1h 2m 5s。 */
export function formatTurnDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds}s`;
}
