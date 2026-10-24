import type { SessionSearchResponse } from "./session-search";
import type { TerminalSearchOptions } from "./terminal-search";

/** 临时网络或服务错误只重试一次；取消、参数错误不重试，避免旧查询覆盖新查询。 */
export async function fetchSessionSearch(query: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch, options: TerminalSearchOptions = {}): Promise<SessionSearchResponse> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    let retryable = true;
    try {
      const params = new URLSearchParams({ q: query });
      for (const key of ["caseSensitive", "wholeWord", "regex"] as const) if (options[key]) params.set(key, "1");
      const response = await fetchImpl(`/api/sessions/search?${params}`, { signal, cache: "no-store" });
      retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as SessionSearchResponse;
      if (!Array.isArray(data.results)) throw new Error("搜索响应无效");
      signal.throwIfAborted();
      return data;
    } catch (error) {
      if (signal.aborted || !retryable || attempt >= 1) throw error;
    }
  }
}
