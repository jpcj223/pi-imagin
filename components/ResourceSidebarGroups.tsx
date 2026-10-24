"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { moveResourceGroup, resourceSidebarPreference, type ResourceGroup, type ResourceSidebarPreference } from "@/lib/resource-sidebar";

export interface ResourceSidebarSection { id: ResourceGroup; label: string; controls: ReactNode; children: ReactNode; status?: ReactNode }

/** 仅持久化展示顺序和折叠状态；分组拖动不写资源配置。 */
export function ResourceSidebarGroups({ kind, groups, searching = false }: { kind: "plugins" | "skills"; groups: ResourceSidebarSection[]; searching?: boolean }) {
  const { t } = useI18n();
  const key = `pi-resource-sidebar:${kind}`;
  const [preference, setPreference] = useState(resourceSidebarPreference);
  const [dragging, setDragging] = useState<ResourceGroup | null>(null);
  const [drop, setDrop] = useState<{ id: ResourceGroup; after: boolean } | null>(null);
  const allowDrag = useRef(true);
  useEffect(() => {
    const read = () => { try { setPreference(resourceSidebarPreference(JSON.parse(localStorage.getItem(key) || "null"))); } catch { setPreference(resourceSidebarPreference()); } };
    read();
    const changed = (event: StorageEvent) => { if (event.key === key) read(); };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, [key]);
  const save = (change: (previous: ResourceSidebarPreference) => ResourceSidebarPreference) => setPreference(previous => {
    const next = change(previous);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* 存储受限时仍支持本次调整。 */ }
    return next;
  });
  return <>{preference.order.map(id => {
    const group = groups.find(group => group.id === id);
    if (!group) return null;
    const expanded = searching || !preference.collapsed[id];
    return <section key={id} data-resource-group={id} className={`resource-sidebar-group${dragging === id ? " is-dragging" : ""}${drop?.id === id ? drop.after ? " is-drop-after" : " is-drop-before" : ""}`}
      onDragOver={event => { if (!dragging) return; event.preventDefault(); setDrop({ id, after: event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.clientHeight / 2 }); }}
      onDrop={event => { if (!dragging) return; event.preventDefault(); save(previous => ({ ...previous, order: moveResourceGroup(previous.order, dragging, id, drop?.id === id && drop.after) })); setDragging(null); setDrop(null); }}>
      <div className="resource-sidebar-group-header" draggable
        onPointerDown={event => { allowDrag.current = !(event.target as HTMLElement).closest(".config-sidebar-group-switch"); }}
        onDragStart={event => {
          if (!allowDrag.current) { event.preventDefault(); return; }
          setDragging(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id);
          const preview = document.createElement("div"); preview.className = "resource-group-drag-preview"; preview.textContent = group.label; document.body.appendChild(preview);
          event.dataTransfer.setDragImage(preview, 20, 16); setTimeout(() => preview.remove(), 0);
        }} onDragEnd={() => { setDragging(null); setDrop(null); }}>
        <button type="button" className="resource-sidebar-group-toggle" aria-expanded={expanded} title={t("resources.groupReorder")} onClick={() => save(previous => ({ ...previous, collapsed: { ...previous.collapsed, [id]: !previous.collapsed[id] } }))}
          onKeyDown={event => { if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); const index = preference.order.indexOf(id), after = event.key === "ArrowDown", target = preference.order[index + (after ? 1 : -1)]; if (target) save(previous => ({ ...previous, order: moveResourceGroup(previous.order, id, target, after) })); }}>
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" className={expanded ? "is-expanded" : ""}><path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg><span>{group.label}</span>
        </button>{group.controls}
      </div>
      {group.status}
      <div hidden={!expanded}>{group.children}</div>
    </section>;
  })}</>;
}

/** 移除按钮是详情入口的同级元素，避免嵌套按钮及误触详情。 */
export function ResourceSidebarRow({ children, name, disabled = false, reason, onRemove }: { children: ReactNode; name: string; disabled?: boolean; reason?: string; onRemove?: () => void }) {
  const { t } = useI18n();
  return <div className="resource-sidebar-row">{children}<button type="button" className="resource-sidebar-remove" disabled={disabled || !onRemove} aria-label={t("resources.removeNamed", { name })} title={reason || t("i18n.remove")} onClick={onRemove}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
  </button></div>;
}
