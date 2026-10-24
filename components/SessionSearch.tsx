"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { SessionInfo } from "@/lib/types";
import type { SessionSearchResponse } from "@/lib/session-search";
import { fetchSessionSearch } from "@/lib/session-search-client";
import type { TerminalSearchOptions } from "@/lib/terminal-search";

export function SessionSearch({ open, query, children, selectedSessionId, onSelectSession, archivedSessionIds, options = {} }: {
  open: boolean;
  query: string;
  options?: TerminalSearchOptions;
  children: ReactNode;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, entryId?: string, blockIndex?: number) => void;
  /** Ids of every session in an archived family: their results are tagged, not hidden. */
  archivedSessionIds?: ReadonlySet<string>;
}) {
  const { t, locale } = useI18n();
  const listId = useId(), list = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const caseSensitive = Boolean(options.caseSensitive), wholeWord = Boolean(options.wholeWord), regex = Boolean(options.regex);
  const [state, setState] = useState<{ query: string; response?: SessionSearchResponse; failed?: boolean }>({ query: "" });
  const search = query.trim(), key = JSON.stringify([search, caseSensitive, wholeWord, regex]);
  const [retry, setRetry] = useState(0);
  const response = state.query === key ? state.response : undefined;
  const failed = state.query === key && state.failed;
  useEffect(() => {
    setActiveIndex(0);
  }, [key]);
  useEffect(() => {
    const root = list.current?.closest('.workspace-search-dialog');
    if (!open || !root) return;
    const input = root.querySelector<HTMLInputElement>('input[type="search"]');
    input?.setAttribute('role', 'combobox'); input?.setAttribute('aria-controls', listId); input?.setAttribute('aria-expanded', 'true');
    if (response?.results[activeIndex]) input?.setAttribute('aria-activedescendant', `${listId}-${activeIndex}`);
    else input?.removeAttribute('aria-activedescendant');
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing || !response?.results.length || !root.contains(event.target as Node)) return;
      if (event.target !== input && !(event.target as HTMLElement).matches('[role="option"]')) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + response.results.length) % response.results.length); }
      if (event.key === 'Enter') { event.preventDefault(); const result = response.results[activeIndex]; if (result) onSelectSession(result.session, result.entryId, result.blockIndex); }
    };
    root.addEventListener('keydown', keyboard as EventListener);
    return () => { root.removeEventListener('keydown', keyboard as EventListener); for (const attribute of ['aria-activedescendant', 'aria-controls', 'aria-expanded', 'role']) input?.removeAttribute(attribute); };
  }, [open, response, activeIndex, listId, onSelectSession]);

  // Re-runs only when the query changes. It deliberately does not depend on the
  // session-list version: ordinary agent activity bumps that version every few
  // seconds, which used to refetch (and re-order) results while they were being
  // read.
  useEffect(() => {
    if (!open || !search) return;
    const controller = new AbortController();
    setState({ query: key });
    const timer = setTimeout(async () => {
      try {
        const data = await fetchSessionSearch(search, controller.signal, fetch, { caseSensitive, wholeWord, regex });
        if (!controller.signal.aborted) setState({ query: key, response: data });
      } catch {
        if (!controller.signal.aborted) setState({ query: key, failed: true });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, search, retry, key, caseSensitive, wholeWord, regex]);

  return !open || !search ? children : (
    <div ref={list} id={listId} role="listbox" aria-label={t("search.title")} className="min-h-20 flex-1 overflow-y-auto" aria-busy={!response && !failed}>
      <div role="status" className="px-3 py-2 text-xs text-text-muted">
        {failed ? t("sidebar.sessionSearchFailed") : !response ? t("sidebar.sessionSearching")
          : response.results.length === 0 ? t("sidebar.sessionSearchEmpty")
          : t("sidebar.sessionSearchCount", { count: response.results.length })}
      </div>
      {failed && <button type="button" className="workspace-search-retry" onClick={() => setRetry(value => value + 1)}>{t("search.retry")}</button>}
      {response?.truncated && (
        <div role="status" className="px-3 pb-2 text-xs text-text-muted">{t("sidebar.sessionSearchPartial")}</div>
      )}
      {response?.results.map(({ session, entryId, blockIndex, before, match, after }, index) => (
        <button
          key={session.id}
          type="button"
          role="option" id={`${listId}-${index}`} aria-selected={index === activeIndex}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => onSelectSession(session, entryId, blockIndex)}
          aria-current={session.id === selectedSessionId ? "true" : undefined}
          className={`block w-full cursor-pointer border-b border-border px-3 py-2 text-left hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent ${index === activeIndex ? "bg-bg-selected" : ""}`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-xs font-medium text-text">{session.name || session.firstMessage}</span>
            {archivedSessionIds?.has(session.id) && (
              <span className="shrink-0 rounded-[4px] border border-border px-1 text-[10px] leading-[14px] text-text-dim">{t("sidebar.archived")}</span>
            )}
          </span>
          <span className="mt-1 flex min-w-0 gap-2 text-[10px] text-text-dim">
            <span className="min-w-0 flex-1 truncate" title={session.cwd}>{session.cwd}</span>
            <span className="shrink-0">{formatRelativeTime(session.modified, locale)}</span>
          </span>
          <span className="mt-1 block text-xs leading-relaxed wrap-anywhere text-text-muted">
            {before}<mark className="rounded-sm bg-accent/20 text-text">{match}</mark>{after}
          </span>
        </button>
      ))}
    </div>
  );
}
