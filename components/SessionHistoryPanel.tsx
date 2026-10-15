"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { sessionHistoryDocument } from "@/lib/session-history-document";

/** 读取原有完整导出，在独立沙盒内展示，不获得父页面或项目访问权限。 */
export function SessionHistoryPanel({ sessionId }: { sessionId: string }) {
  const { isDark } = useTheme();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ id: string; html?: string; url?: string; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const url = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/export?inline=1`, window.location.href).href;
    void fetch(url, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`历史读取失败（${response.status}）`);
        const html = await response.text();
        sessionHistoryDocument(html, false);
        if (!controller.signal.aborted) setResult({ id: sessionId, html, url });
      }).catch(error => {
        if (!controller.signal.aborted) setResult({ id: sessionId, error: String(error) });
      });
    return () => controller.abort();
  }, [sessionId, revision]);
  const current = result?.id === sessionId ? result : null;
  const document = useMemo(() => current?.html ? sessionHistoryDocument(current.html, isDark, current.url) : undefined, [current, isDark]);
  return <section className="workspace-history" aria-label="完整历史">
    <header><span>完整记录 · 含分支与工具调用</span><button type="button" onClick={() => { setResult(null); setRevision(value => value + 1); }}>刷新</button></header>
    {!current && <div role="status" className="workspace-history-status">正在读取完整历史…</div>}
    {current?.error && <div role="alert" className="workspace-history-status">{current.error}<button type="button" onClick={() => { setResult(null); setRevision(value => value + 1); }}>重试</button></div>}
    {document && <iframe title="完整历史记录" srcDoc={document} sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer" />}
  </section>;
}
