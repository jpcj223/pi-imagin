"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { compactDisplayPath } from "@/lib/display-path";
import { CopyButton } from "./CopyButton";
import { SidebarMenu } from "./SidebarMenu";

/** 列表路径保持一行，完整内容沿用视口内浮层，不撑高列表。 */
export function InlineResourcePath({ path, disabled = false, copy = true }: { path: string; disabled?: boolean; copy?: boolean }) {
  const { t } = useI18n();
  return <span className="inline-resource-path"><ResourcePath path={path} disabled={disabled} contextMenu />{copy && <CopyButton value={path} label={t("resourcePath.copy")} />}</span>;
}

/** 完整路径留在浮层中，悬停展开不改变工具栏的尺寸。 */
export function ResourcePath({ path, disabled = false, contextMenu = false }: { path: string; disabled?: boolean; contextMenu?: boolean }) {
  const { t } = useI18n(), id = useId();
  const anchor = useRef<HTMLSpanElement>(null), popup = useRef<HTMLDivElement>(null);
  const [pathBudget, setPathBudget] = useState(42);
  useEffect(() => {
    const node = anchor.current;
    if (!node) return;
    const measure = () => {
      const trigger = node.querySelector("button");
      if (!trigger || !node.clientWidth) return;
      const font = getComputedStyle(trigger);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return;
      context.font = `${font.fontSize} ${font.fontFamily}`;
      setPathBudget(Math.max(12, Math.floor(node.clientWidth / context.measureText("0").width)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node); measure();
    return () => observer.disconnect();
  }, []);
  const skipFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false), [copied, setCopied] = useState(false), [failed, setFailed] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [manager, setManager] = useState(false), [managerError, setManagerError] = useState("");
  const menuOpen = menu !== null;
  useEffect(() => {
    if (!menuOpen) return;
    let active = true;
    fetch("/api/open-in-explorer").then(response => response.json()).then(data => { if (active) setManager(data.supported === true); }).catch(() => {});
    return () => { active = false; };
  }, [menuOpen]);
  const showMenu = (x: number, y: number) => { if (disabled) return; document.dispatchEvent(new Event("pi-resource-path-dismiss")); setManagerError(""); setManager(false); setMenu({ x, y }); };
  const openManager = async () => {
    try {
      const response = await fetch("/api/open-in-explorer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: path }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === "remote" ? t("sidebar.openInExplorerRemoteOnly") : t("fileEdit.openManagerFailed"));
    } catch (error) { setManagerError(String(error instanceof Error ? error.message : error)); setOpen(true); }
  };
  const show = () => { if (timer.current) clearTimeout(timer.current); if (!disabled) { if (!open) document.dispatchEvent(new Event("pi-resource-path-dismiss")); setOpen(true); } };
  const hide = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 180); };
  useEffect(() => { if (disabled) { setOpen(false); setMenu(null); } }, [disabled]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (!open && !menuOpen) return;
    const place = () => {
      if (!anchor.current || !popup.current) return;
      const box = anchor.current.getBoundingClientRect(), panel = popup.current.getBoundingClientRect();
      setPosition({ left: Math.max(12, Math.min(box.left, innerWidth - panel.width - 12)), top: box.bottom + panel.height + 8 < innerHeight ? box.bottom + 6 : Math.max(12, box.top - panel.height - 6), ready: true });
    };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    const outside = (event: PointerEvent) => { const node = event.target as Node; if (!anchor.current?.contains(node) && !popup.current?.contains(node)) setOpen(false); };
    const dismiss = (event: Event) => {
      if ((event as CustomEvent<{ restoreFocus?: boolean }>).detail?.restoreFocus) {
        skipFocus.current = true; anchor.current?.querySelector("button")?.focus({ preventScroll: true }); skipFocus.current = false;
      }
      setOpen(false);
      setMenu(null);
    };
    window.addEventListener("pointerdown", outside);
    document.addEventListener("pi-resource-path-dismiss", dismiss);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); window.removeEventListener("pointerdown", outside); document.removeEventListener("pi-resource-path-dismiss", dismiss); if (timer.current) clearTimeout(timer.current); };
  }, [open, menuOpen, path]);
  const escape = (event: React.KeyboardEvent) => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); skipFocus.current = true; anchor.current?.querySelector("button")?.focus({ preventScroll: true }); skipFocus.current = false; setOpen(false); } };
  return <span className="resource-path" ref={anchor} onPointerEnter={contextMenu ? undefined : show} onPointerLeave={contextMenu ? undefined : hide} onFocus={() => { if (!contextMenu && !skipFocus.current) show(); }} onBlur={contextMenu ? undefined : hide} onKeyDown={escape}>
    <button type="button" className="resource-path-trigger" disabled={disabled} aria-label={t("resourcePath.show")} aria-haspopup={contextMenu ? "menu" : undefined} aria-expanded={(open || menuOpen) && !disabled} aria-controls={open && !disabled ? id : undefined}
      onContextMenu={contextMenu ? event => { event.preventDefault(); event.stopPropagation(); showMenu(event.clientX, event.clientY); } : undefined}
      onKeyDown={event => { if (contextMenu && (event.key === "ContextMenu" || event.shiftKey && event.key === "F10")) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); showMenu(box.left, box.bottom); } }}
      onClick={event => { if (contextMenu) { const box = event.currentTarget.getBoundingClientRect(); showMenu(box.left, box.bottom); } else show(); }}>{compactDisplayPath(path, pathBudget)}</button>
    <SidebarMenu sheet={false} open={menuOpen && !disabled} anchor={menu ? { kind: "point", ...menu } : null} ariaLabel={t("resourcePath.full")} cancelLabel={t("sidebar.cancel")} returnFocusTo={anchor.current?.querySelector("button")} onClose={() => setMenu(null)} items={[
      { type: "item", id: "full", label: t("resourcePath.show"), onSelect: () => { setManagerError(""); setOpen(true); } },
      { type: "item", id: "explorer", label: t("sidebar.openInExplorer"), disabled: !manager, disabledReason: !manager ? t("sidebar.openInExplorerRemoteOnly") : undefined, onSelect: () => void openManager() },
    ]} />
    {open && !disabled && createPortal(<div ref={popup} id={id} className="resource-path-popup" role="group" aria-label={t("resourcePath.full")} style={{ left: position.left, top: position.top, visibility: position.ready ? "visible" : "hidden" }} onPointerEnter={contextMenu ? undefined : show} onPointerLeave={contextMenu ? undefined : hide} onFocus={contextMenu ? undefined : show} onBlur={contextMenu ? undefined : hide} onKeyDown={escape}>
      <span className="resource-path-full">{path}</span>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(path); setCopied(true); setFailed(false); } catch { setFailed(true); } }}>{t(copied ? "resourcePath.copied" : "resourcePath.copy")}</button>
      {failed && <span role="status">{t("resourcePath.copyFailed")}</span>}
      {managerError && <span role="alert">{managerError}</span>}
    </div>, document.body)}
  </span>;
}
