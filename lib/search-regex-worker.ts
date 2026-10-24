import { Worker } from "node:worker_threads";
import { searchTextRanges, type TerminalSearchOptions } from "./terminal-search";

/** 正则在独立线程执行；到达时间预算可真正终止，不能阻塞服务端事件循环。 */
export function createSearchMatcher(query: string, options: TerminalSearchOptions, signal: AbortSignal) {
  if (!options.regex) return { match: async (text: string, limit: number) => searchTextRanges(text, query, options, limit), close: () => {} };
  new RegExp(query, options.caseSensitive ? "gu" : "giu");
  const worker = new Worker(`const { parentPort } = require('node:worker_threads'); const find = ${searchTextRanges.toString()}; parentPort.on('message', ({text,query,options,limit}) => { try { parentPort.postMessage({ranges:find(text,query,options,limit)}); } catch { parentPort.postMessage({error:true}); } });`, { eval: true });
  return {
    match: (text: string, limit: number) => new Promise<{ index: number; length: number }[]>((resolve, reject) => {
      const finish = (ranges?: { index: number; length: number }[], error?: Error) => { clearTimeout(timer); signal.removeEventListener("abort", abort); worker.removeListener("message", message); worker.removeListener("error", failed); if (error) reject(error); else resolve(ranges!); };
      const failed = (error: Error) => finish(undefined, error);
      const abort = () => { void worker.terminate(); finish(undefined, new Error("Search timed out or cancelled")); };
      const message = (data: { ranges: { index: number; length: number }[]; error?: boolean }) => data.error ? failed(new Error("Invalid regular expression")) : finish(data.ranges);
      const timer = setTimeout(abort, 750);
      signal.addEventListener("abort", abort, { once: true }); worker.once("message", message); worker.once("error", failed);
      if (signal.aborted) abort(); else worker.postMessage({ text, query, options, limit });
    }),
    close: () => { void worker.terminate(); },
  };
}
