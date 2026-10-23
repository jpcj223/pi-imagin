"use client";
import { useI18n } from "@/hooks/useI18n";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AUXILIARY_TAB_ORDER_KEY, moveAuxiliaryTab, normalizeAuxiliaryTabOrder, type AuxiliaryTab } from "@/lib/auxiliary-tabs";

const labelKeys: Record<AuxiliaryTab, string> = { outline: "workspace.outline", files: "sidebar.tabFiles", history: "history.full", system: "system.label", tools: "tools.label", session: "session.info" };
const changedEvent = "pi-web:auxiliary-tabs-changed";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changedEvent, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(changedEvent, callback); };
}
function snapshot() { try { return localStorage.getItem(AUXILIARY_TAB_ORDER_KEY) ?? ""; } catch { return ""; } }

/** 悬停或键盘聚焦时横向展开；触屏点击当前标签也可展开。 */
export function AuxiliaryTabs({ active, historyAvailable, onSelect, children }: {
  active: AuxiliaryTab;
  historyAvailable: boolean;
  onSelect: (tab: AuxiliaryTab) => void;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  const order = useMemo(() => { try { return normalizeAuxiliaryTabOrder(JSON.parse(raw)); } catch { return normalizeAuxiliaryTabOrder(null); } }, [raw]);
  const [expanded, setExpanded] = useState(false);
  const hovering = useRef(false);
  const dragging = useRef<AuxiliaryTab | null>(null);
  const touchDrag = useRef<{ tab: AuxiliaryTab; x: number; y: number; moved: boolean } | null>(null);
  const dropTarget = useRef<AuxiliaryTab | null>(null);
  const skipClick = useRef(false);
  const openOnClick = useRef(false);
  const move = (from: AuxiliaryTab, to: AuxiliaryTab) => {
    try { localStorage.setItem(AUXILIARY_TAB_ORDER_KEY, JSON.stringify(moveAuxiliaryTab(order, from, to))); window.dispatchEvent(new Event(changedEvent)); } catch { /* 存储不可用时不影响标签选择。 */ }
  };
  return <nav className={`workspace-aux-tabs workspace-aux-switcher${expanded ? " is-expanded" : ""}`} aria-label={t("workspace.auxiliary")} onPointerEnter={event => { if (event.pointerType === "mouse") { hovering.current = true; setExpanded(true); } }} onPointerLeave={event => { if (event.pointerType === "mouse") { hovering.current = false; if (!dragging.current) setExpanded(false); } }} onBlur={event => { if (!hovering.current && !event.currentTarget.contains(event.relatedTarget)) setExpanded(false); }}>
    <div className="workspace-aux-tab-list" role="tablist" aria-label={t("workspace.auxiliaryTabs")}>
      {order.map((tab, index) => <button key={tab} type="button" role="tab" draggable={false} aria-selected={active === tab} data-active={active === tab} data-aux-tab={tab} disabled={tab === "history" && !historyAvailable} title={t("workspace.tabReorderHint", { label: t(labelKeys[tab]) })} onFocus={() => setExpanded(true)} onClick={event => {
        if (skipClick.current) { skipClick.current = false; return; }
        if (openOnClick.current) { openOnClick.current = false; setExpanded(true); return; }
        if (tab === active && !expanded) setExpanded(true); else { onSelect(tab); setExpanded(hovering.current || event.detail === 0); }
      }} onPointerDown={event => {
        if (event.button !== 0) return;
        touchDrag.current = { tab, x: event.clientX, y: event.clientY, moved: false };
        dropTarget.current = null;
        openOnClick.current = event.pointerType !== "mouse" && !expanded;
        event.currentTarget.setPointerCapture(event.pointerId);
        setExpanded(true);
      }} onPointerMove={event => {
        const touch = touchDrag.current;
        if (!touch || Math.hypot(event.clientX - touch.x, event.clientY - touch.y) < 9) return;
        touch.moved = true;
        dragging.current = touch.tab;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-aux-tab]")?.dataset.auxTab as AuxiliaryTab | undefined;
        dropTarget.current = target ?? null;
      }} onPointerUp={() => {
        const touch = touchDrag.current;
        skipClick.current = touch?.moved ?? false;
        if (touch?.moved) {
          openOnClick.current = false;
          if (dropTarget.current) move(touch.tab, dropTarget.current);
          setExpanded(hovering.current);
        }
        touchDrag.current = null; dragging.current = null; dropTarget.current = null;
      }} onPointerCancel={() => { touchDrag.current = null; dragging.current = null; dropTarget.current = null; openOnClick.current = false; }} onKeyDown={event => {
        if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault(); const target = order[index + (event.key === "ArrowLeft" ? -1 : 1)]; if (target) move(tab, target);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); const target = order[(index + (event.key === "ArrowLeft" ? order.length - 1 : 1)) % order.length]; event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-aux-tab="${target}"]`)?.focus();
        } else if (event.key === "Escape") { event.stopPropagation(); setExpanded(false); }
      }}>{t(labelKeys[tab])}</button>)}
    </div>
    {children}
  </nav>;
}
