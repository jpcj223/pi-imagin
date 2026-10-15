"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/hooks/useTheme";
import { sessionHistoryDocument } from "@/lib/session-history-document";
import { RefreshIcon } from "./SidebarIcons";

/** 读取原有完整导出，在独立沙盒内展示，不获得父页面或项目访问权限。 */
export function SessionHistoryPanel({ sessionId, expanded, onExpand, expandable = true, actionsHost }: { sessionId: string; expanded: boolean; onExpand: () => void; expandable?: boolean; actionsHost?: HTMLElement | null }) {
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
  const expandLabel = expanded ? "恢复侧栏" : "全宽阅读";
  const actions = <>
    {expandable && <button type="button" className="workspace-history-icon" aria-label={expandLabel} title={expandLabel} aria-pressed={expanded} onClick={onExpand}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={expanded ? "M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5" : "M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"} /></svg>
    </button>}
    <button type="button" className="workspace-history-icon" aria-label="刷新完整历史" title="刷新完整历史" onClick={() => setRevision(value => value + 1)}><RefreshIcon size={16} /></button>
  </>;
  return <section className="workspace-history" aria-label="完整历史">
    {actionsHost ? createPortal(actions, actionsHost) : <div className="workspace-history-actions is-fallback">{actions}</div>}
    {!current && <div role="status" className="workspace-history-status">正在读取完整历史…</div>}
    {current?.error && <div role="alert" className="workspace-history-status">{current.error}<button type="button" onClick={() => { setResult(null); setRevision(value => value + 1); }}>重试</button></div>}
    {document && <iframe title="完整历史记录" srcDoc={document} sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer" />}
  </section>;
}
