"use client";

import { SearchIcon } from "./SidebarIcons";
import { SettingsSectionIcon } from "./SettingsPanel";
import { useI18n } from "@/hooks/useI18n";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { RAIL_ITEMS, RAIL_ORDER_KEY, moveRailItem, normalizeRailOrder, type RailItem } from "@/lib/workspace-rail-order";

export function WorkspaceRail({ onHome, onSettings, onSearch, onPlugins, onSkills, settingsOpen, pluginsOpen, skillsOpen }: { onSearch: () => void; onHome: () => void; onSettings: () => void; onPlugins: () => void; onSkills: () => void; settingsOpen: boolean; pluginsOpen: boolean; skillsOpen: boolean }) {
  const { t } = useI18n();
  const [order, setOrder] = useState<RailItem[]>([...RAIL_ITEMS]);
  const [dragging, setDragging] = useState<RailItem | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: RailItem; x: number; y: number; before: RailItem[]; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const read = () => { try { setOrder(normalizeRailOrder(JSON.parse(localStorage.getItem(RAIL_ORDER_KEY) ?? "null"))); } catch { setOrder([...RAIL_ITEMS]); } };
    read(); const sync = (event: StorageEvent) => { if (event.key === RAIL_ORDER_KEY) read(); };
    window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
  }, []);
  const save = (next: RailItem[]) => { setOrder(next); try { localStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(next)); } catch { /* 当前窗口仍可调整。 */ } };
  const stop = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const drag = dragRef.current; if (!drag) return;
    const rect = groupRef.current?.getBoundingClientRect();
    const inside = rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (cancel || !inside) setOrder(drag.before); else if (drag.moved) save(order);
    suppressClick.current = drag.moved; dragRef.current = null; setDragging(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setTimeout(() => { suppressClick.current = false; }, 0);
  };
  const items = {
    home: { label: t("workspace.home"), active: !settingsOpen && !pluginsOpen && !skillsOpen, onClick: onHome, icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></svg> },
    search: { label: t("search.title"), active: false, onClick: onSearch, icon: <SearchIcon size={18} /> },
    skills: { label: t("common.skills"), active: skillsOpen, onClick: onSkills, icon: <SettingsSectionIcon section="skills" size={19} strokeWidth={1.7} /> },
    plugins: { label: t("common.plugins"), active: pluginsOpen, onClick: onPlugins, icon: <SettingsSectionIcon section="plugins" size={19} strokeWidth={1.7} /> },
  };
  return <nav className="workspace-rail" aria-label={t("workspace.navigation")}>
    <div className="workspace-rail-items" ref={groupRef}>
      {order.map(id => {
const item = items[id]; return <button key={id} type="button" data-rail-item={id}
          className={`workspace-rail-button ${id === "home" ? "workspace-home" : `workspace-rail-${id}`}${item.active ? " is-active" : ""}${dragging === id ? " is-dragging" : ""}`}
          aria-label={item.label} aria-current={item.active ? "page" : undefined} aria-haspopup={id === "search" ? "dialog" : undefined}
          title={`${item.label} · ${t("rail.reorderHint")}`}
          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } item.onClick(); }}
          onPointerDown={event => { if (event.button !== 0) return; if (event.pointerType === "mouse") event.preventDefault(); suppressClick.current = false; dragRef.current = { id, x: event.clientX, y: event.clientY, before: [...order], moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => {
            const drag = dragRef.current; if (!drag) return;
            if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
            event.preventDefault(); drag.moved = true; setDragging(drag.id);
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>("[data-rail-item]")?.dataset.railItem as RailItem | undefined;
            if (target && groupRef.current?.contains(document.elementFromPoint(event.clientX, event.clientY))) setOrder(current => moveRailItem(current, drag.id, target));
          }}
          onPointerUp={event => stop(event)} onPointerCancel={event => stop(event, true)}
          onKeyDown={event => {
            if (event.key === "Escape" && dragRef.current) { event.preventDefault(); event.stopPropagation(); setOrder(dragRef.current.before); dragRef.current = null; setDragging(null); suppressClick.current = true; }
            if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); const index = order.indexOf(id), target = order[index + (event.key === "ArrowUp" ? -1 : 1)]; if (target) save(moveRailItem(order, id, target)); }
          }}>{item.icon}</button>;
})}
    </div>
    {order.some((id, index) => id !== RAIL_ITEMS[index]) && <button type="button" className="workspace-rail-reset" title={t("rail.resetOrder")} aria-label={t("rail.resetOrder")} onClick={() => save([...RAIL_ITEMS])}>↶</button>}
    <button type="button" className={`workspace-rail-settings${settingsOpen ? " is-active" : ""}`} onClick={onSettings} aria-label={t("common.settings")} aria-pressed={settingsOpen} title={t("common.settings")}>
      <SettingsSectionIcon section="general" size={19} strokeWidth={1.7} />
    </button>
  </nav>;
}
