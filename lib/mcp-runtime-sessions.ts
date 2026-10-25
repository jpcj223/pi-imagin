import { resolve } from "node:path";
import type { McpHost } from "./mcp-host";

/** 只通知已经存在的会话，不因打开设置或切换范围创建会话。 */
export function requestMcpRuntimeRefresh(): void {
  for (const session of globalThis.__piSessions?.values() ?? []) {
    if (session.isAlive() && typeof session.requestMcpRuntimeRefresh === "function") session.requestMcpRuntimeRefresh();
  }
}

export function readMcpRuntimeApplication(): { pending: number; failed: number; sessions: number } {
  const result = { pending: 0, failed: 0, sessions: 0 };
  for (const session of globalThis.__piSessions?.values() ?? []) {
    if (!session.isAlive() || typeof session.mcpRuntimeApplication !== "function") continue;
    const state = session.mcpRuntimeApplication();
    if (state === "unavailable") continue;
    result.sessions++;
    if (state === "pending") result.pending++;
    if (state === "failed") result.failed++;
  }
  return result;
}

/** Apply saved entries or reconnect one exact entry, only in already existing sessions. */
export function requestMcpServerRefresh(options: { cwd?: string; target?: Parameters<McpHost["reconnect"]>[0] } = {}): number {
  let accepted = 0;
  for (const session of globalThis.__piSessions?.values() ?? []) {
    if (options.cwd && resolve(session.cwd) !== resolve(options.cwd)) continue;
    if (session.isAlive() && typeof session.requestMcpServerRefresh === "function"
      && session.requestMcpServerRefresh(options.target)) accepted++;
  }
  return accepted;
}
