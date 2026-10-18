"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { fileDraftDirty, fileEditRevision, getFileEditDraft, subscribeFileEdits } from "@/lib/file-edit-drafts";
import { getFileIcon } from "./FileIcons";
import { useI18n } from "@/hooks/useI18n";
import type { FileViewerDisplayMode, FileViewerState } from "@/lib/file-viewer-state";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  kind?: "terminal" | "agent";
  closing?: boolean;
  sourceSessionId?: string | null;
  initialDisplayMode?: FileViewerDisplayMode;
  /** PDF page requested by the link that opened this tab (`#page=N`). */
  page?: number;
  viewerState?: FileViewerState;
  viewerRevision?: number;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const { t } = useI18n();
  useSyncExternalStore(subscribeFileEdits, fileEditRevision, () => 0);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 只移动标签条，避免 scrollIntoView 连带滚动正文。
    const root = strip.current, active = root?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!root || !active) return;
    if (active.offsetLeft < root.scrollLeft) root.scrollLeft = active.offsetLeft;
    else if (active.offsetLeft + active.offsetWidth > root.scrollLeft + root.clientWidth) root.scrollLeft = active.offsetLeft + active.offsetWidth - root.clientWidth;
  }, [activeTabId, tabs.length]);

  return (
    <div
      ref={strip}
      role="tablist"
      aria-label="打开的文件与面板"
      className="workspace-file-tab-strip"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const dirty = !tab.kind && fileDraftDirty(getFileEditDraft(tab.filePath));
        const duplicate = tabs.some(other => other.id !== tab.id && other.label === tab.label);
        const parent = tab.filePath.replaceAll("\\", "/").split("/").at(-2);
        return (
          <div
            key={tab.id}
            role="tab"
            className="workspace-file-tab"
            aria-label={tab.kind === "terminal" ? t("terminal.tabLabel", { name: tab.label }) : tab.kind === "agent" ? t("subagent.tabLabel", { name: tab.label }) : tab.label}
            aria-selected={isActive}
            tabIndex={isActive || (!activeTabId && tabs[0].id === tab.id) ? 0 : -1}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab.id);
              } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const index = tabs.findIndex((item) => item.id === tab.id);
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                onSelectTab(tabs[next].id);
                (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
              }
            }}
            onClick={() => onSelectTab(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              if (!tab.closing) onCloseTab(tab.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 33,
              paddingLeft: 12,
              paddingRight: 6,
              background: isActive ? "var(--bg)" : "var(--bg-panel)",
              cursor: "pointer",
              fontSize: 12,
              color: isActive ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              maxWidth: 200,
              minWidth: 80,
              flexShrink: 0,
              userSelect: "none",
              transition: "background 0.1s, color 0.1s",
            }}
          >
            <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
              {tab.kind === "terminal" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              ) : tab.kind === "agent" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
                </svg>
              ) : getFileIcon(tab.label, 13)}
            </span>
            <span
              className="file-tab-label"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                fontWeight: isActive ? 500 : 400,
              }}
              title={tab.filePath}
            >
              {tab.label}
              {duplicate && parent && <small className="file-tab-parent">{parent}</small>}
            </span>
            <button
              type="button"
              className={`file-tab-close${dirty ? " is-dirty" : ""}`}
              disabled={tab.closing}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24,
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
                transition: "background 0.1s, color 0.1s",
              }}
               title={dirty ? "未保存修改" : t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")}
               aria-label={`${t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")} ${tab.label}`}
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
