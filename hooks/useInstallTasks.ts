"use client";

import { useRef, useState } from "react";

/** 按安装目标隔离状态；ref 同步防重，避免连续点击抢在 React 提交之前。 */
export function useInstallTasks() {
  const running = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const run = async (key: string, operation: () => Promise<void>) => {
    if (running.current.has(key)) return;
    running.current.add(key);
    setPending(new Set(running.current));
    setErrors(current => { const next = { ...current }; delete next[key]; return next; });
    try { await operation(); }
    catch (error) { setErrors(current => ({ ...current, [key]: error instanceof Error ? error.message : String(error) })); }
    finally { running.current.delete(key); setPending(new Set(running.current)); }
  };
  return { pending, errors, run };
}
