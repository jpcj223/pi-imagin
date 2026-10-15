"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { openStackedDialog } from "@/lib/stacked-dialog";
import type { SessionInfo } from "@/lib/types";
import { SessionSearch } from "./SessionSearch";
import { SearchIcon } from "./SidebarIcons";

/** 复用现有搜索接口和结果定位，仅将搜索承载在独立弹窗中。 */
export function SessionSearchDialog({ query, onQueryChange, onClose, onSelectSession, selectedSessionId, archivedSessionIds }: {
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onSelectSession: (session: SessionInfo, entryId?: string, blockIndex?: number) => void;
  selectedSessionId: string | null;
  archivedSessionIds: ReadonlySet<string>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const cleanup = openStackedDialog(document, inputRef.current, () => closeRef.current());
    return cleanup;
  }, []);
  return createPortal(<div className="workspace-search-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="workspace-search-title" className="workspace-search-dialog" onKeyDown={event => {
      if (event.key !== "Tab") return;
      const items = dialogRef.current?.querySelectorAll<HTMLElement>('input,button:not(:disabled),[tabindex="0"]');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <header><h2 id="workspace-search-title">搜索会话</h2><button type="button" aria-label="关闭搜索" onClick={onClose}>×</button></header>
      <label className="workspace-search-field"><SearchIcon size={18} /><input ref={inputRef} type="search" maxLength={200} value={query} onChange={event => onQueryChange(event.target.value)} placeholder="搜索会话标题与内容…" aria-label="搜索会话标题与内容" /><kbd>Esc</kbd></label>
      <SessionSearch open query={query} selectedSessionId={selectedSessionId} archivedSessionIds={archivedSessionIds} onSelectSession={(...args) => { onSelectSession(...args); onClose(); }}>
        <div className="workspace-search-empty">输入关键词查找会话，选择结果即可定位到对应消息。</div>
      </SessionSearch>
    </div>
  </div>, document.body);
}
