"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { ShellKind, ShellProfileChange, ShellProfileSettings } from "@/lib/shell-profile-types";
import { chooseDesktopExecutable } from "@/lib/desktop-bridge";
import { focusModalPanel, listenForStackedDialogEscape } from "@/lib/stacked-dialog";
import { ConfigButton, ConfigPanelShell } from "./SettingsUi";
import { TerminalIcon } from "./TerminalIcon";
import { SidebarMenu, type SidebarMenuItem } from "./SidebarMenu";
import { PiCommandSettings } from "./PiCommandSettings";

export const SHELL_PROFILES_CHANGED = "pi-shell-profiles-changed";
const icon = (kind: ShellKind) => kind === "powershell" ? "powershell" : kind === "cmd" ? "cmd" : kind === "wsl" ? "linux" : "bash";

export function ShellProfilesSettings({ disabled = false, revision = 0, onBusy }: { disabled?: boolean; revision?: number; onBusy?: (value: boolean) => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<ShellProfileSettings | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [saved, setSaved] = useState(false), [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null), [over, setOver] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; opener: HTMLButtonElement; rect: DOMRect } | null>(null);
  const [label, setLabel] = useState(""), [path, setPath] = useState(""), [kind, setKind] = useState<ShellKind>("bash");
  const panel = useRef<HTMLDivElement>(null), pending = useRef(false), section = useRef<HTMLElement>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/shell-profiles"); const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
    setData(value);
  }, []);
  useEffect(() => {
    void load().catch(cause => setError(String(cause.message ?? cause)));
    const sync = () => { if (!pending.current) void load().catch(() => {}); };
    window.addEventListener(SHELL_PROFILES_CHANGED, sync); window.addEventListener("focus", sync);
    return () => { window.removeEventListener(SHELL_PROFILES_CHANGED, sync); window.removeEventListener("focus", sync); };
  }, [load, revision]);
  useEffect(() => {
    if (!adding) return;
    const stopFocus = focusModalPanel(document, panel.current);
    const stopEscape = listenForStackedDialogEscape(document, () => { if (!pending.current) setAdding(false); });
    return () => { stopEscape(); stopFocus(); };
  }, [adding]);
  const save = async (change: ShellProfileChange) => {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); onBusy?.(true); setError(""); setSaved(false); setMenu(null);
    try {
      const response = await fetch("/api/shell-profiles", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
      setData(value); setSaved(true);
      if (change.action === "custom" || change.action === "add") { setAdding(false); setLabel(""); setPath(""); }
      window.dispatchEvent(new Event(SHELL_PROFILES_CHANGED));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); onBusy?.(false); }
  };
  const move = (id: string, target: number) => {
    const order = data?.profiles.map(item => item.id) ?? [], from = order.indexOf(id);
    if (from < 0 || target < 0 || target >= order.length || from === target) return;
    order.splice(from, 1); order.splice(target, 0, id); void save({ action: "order", order });
  };
  const current = data?.profiles.find(item => item.id === menu?.id), index = data?.profiles.findIndex(item => item.id === menu?.id) ?? -1;
  const items: SidebarMenuItem[] = current ? [
    { type: "item", id: "up", label: t("shell.moveUp"), icon: <TerminalIcon name="up" />, disabled: index === 0 || busy, onSelect: () => move(current.id, index - 1) },
    { type: "item", id: "down", label: t("shell.moveDown"), icon: <TerminalIcon name="down" />, disabled: index === data!.profiles.length - 1 || busy, onSelect: () => move(current.id, index + 1) },
    { type: "item", id: "path", label: t("shell.showPath"), onSelect: () => setDetail(value => value === current.id ? null : current.id) },
    ...(!current.builtin ? [{ type: "separator" as const, id: "remove-divider" }, { type: "item" as const, id: "remove", label: t("shell.remove"), danger: true, disabled: busy, onSelect: () => void save({ action: "remove", id: current.id }) }] : []),
  ] : [];
  return <section className="settings-general-section shell-settings" ref={section}>
    <h3 className="settings-general-heading">{t("shell.title")}</h3>
    <p className="settings-general-description">{t("shell.description")}</p>
    <PiCommandSettings disabled={disabled || busy} />
    <ol className="shell-profile-list" aria-label={t("shell.title")}>
      {data?.profiles.map((profile, i) => <li key={profile.id} data-shell-id={profile.id} className={`shell-profile-row${over === profile.id ? " is-drop-target" : ""}${!profile.available ? " is-unavailable" : ""}`} draggable={!disabled && !busy}
        onDragStart={event => { if ((event.target as HTMLElement).closest(".shell-profile-more,.shell-profile-path")) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", profile.id); setDragging(profile.id); setMenu(null); }} onDragEnd={() => { setDragging(null); setOver(null); }}
        onDragOver={event => { if (dragging && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(profile.id); } }}
        onDrop={event => { event.preventDefault(); if (dragging) move(dragging, i); setDragging(null); setOver(null); }}>
        <div className="shell-profile-main">
          <button type="button" className="shell-profile-drag" disabled={disabled || busy} aria-label={t("shell.reorder", { name: profile.label })} title={t("shell.reorderHint")}
            onKeyDown={event => { if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); move(profile.id, i + (event.key === "ArrowUp" ? -1 : 1)); } }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{[4, 8, 12].flatMap(y => [6, 10].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />))}</svg>
          </button>
          <span className="shell-profile-icon"><TerminalIcon name={icon(profile.kind)} /></span>
          <div className="shell-profile-name"><span>{profile.label}</span><span className="shell-profile-meta">{t(profile.builtin ? "shell.builtin" : "shell.added")}{!profile.modelSupported && ` · ${t("shell.manualOnly")}`}</span></div>
          {profile.id === data.selectedId && <span className="shell-profile-priority">{t("shell.preferred")}</span>}
          <button type="button" className="shell-profile-more" disabled={disabled || busy} aria-label={t("shell.actions", { name: profile.label })} aria-haspopup="menu" aria-expanded={menu?.id === profile.id}
            onClick={event => { const opener = event.currentTarget; setMenu(value => value?.id === profile.id ? null : { id: profile.id, opener, rect: opener.getBoundingClientRect() }); }}><TerminalIcon name="more" /></button>
        </div>
        {!profile.available && <p className="shell-profile-note">{t("shell.unavailable")}</p>}
        {detail === profile.id && <code className="shell-profile-path">{profile.path || t("shell.pathMissing")}</code>}
      </li>)}
    </ol>
    {!data && !error && <p className="settings-general-description" role="status">{t("shell.loading")}</p>}
    {error && !adding && <div role="alert" className="settings-general-error">{t("shell.failed")} {error} <ConfigButton size="small" variant="ghost" onClick={() => void load().then(() => setError("")).catch(cause => setError(String(cause.message)))}>{t("shell.refresh")}</ConfigButton></div>}
    <div className="shell-settings-footer"><p role="status" className="settings-general-description">{t(saved ? "shell.saved" : "shell.scope")}</p><ConfigButton size="small" variant="secondary" disabled={disabled || busy || !data} onClick={() => { setError(""); setMenu(null); setAdding(true); }}><TerminalIcon name="plus" />{t("shell.add")}</ConfigButton></div>
    <SidebarMenu open={Boolean(menu)} sheet={false} anchor={menu ? { kind: "rect", rect: menu.rect, align: "end" } : null} width={200} ariaLabel={t("shell.title")} cancelLabel={t("i18n.cancel")} returnFocusTo={menu?.opener} items={items} onClose={() => setMenu(null)} />
    {adding && createPortal(<ConfigPanelShell embedded={false} title={t("shell.add")} width={560} height="auto" onClose={() => { if (!busy) setAdding(false); }} closeLabel={t("i18n.cancel")}>
      <div className="shell-add-panel" ref={panel} tabIndex={-1}>
        <p className="settings-general-description">{t("shell.addDescription")}</p>
        <h4>{t("shell.detected")}</h4>
        <div className="shell-detected-list">{data?.detected.filter(item => !item.builtin).map(profile => {
          const included = data.profiles.some(item => item.id === profile.id || item.path === profile.path);
          return <button key={profile.id} type="button" disabled={busy || included} onClick={() => void save({ action: "add", id: profile.id })}><TerminalIcon name={icon(profile.kind)} /><span>{profile.label}</span><small>{included ? t("terminal.added") : t("shell.add")}</small></button>;
        })}{!data?.detected.some(item => !item.builtin) && <p className="settings-general-description">{t("shell.noDetected")}</p>}</div>
        <ConfigButton size="small" variant="ghost" disabled={busy} onClick={() => void load().catch(cause => setError(String(cause.message)))}>{t("shell.refresh")}</ConfigButton>
        <form className="shell-custom-form" onSubmit={event => { event.preventDefault(); void save({ action: "custom", label, path, kind }); }}>
          <h4>{t("shell.custom")}</h4>
          <label>{t("shell.name")}<input value={label} maxLength={64} required disabled={busy} onChange={event => setLabel(event.target.value)} /></label>
          <label>{t("shell.syntax")}<select value={kind} disabled={busy} onChange={event => setKind(event.target.value as ShellKind)}>{(["bash", "powershell", "cmd", "zsh", "sh", "wsl"] as ShellKind[]).map(value => <option key={value} value={value}>{value === "powershell" ? "PowerShell" : value === "cmd" ? "CMD" : value === "wsl" ? "WSL" : value}</option>)}</select></label>
          <label className="shell-custom-path">{t("shell.path")}<span><input value={path} required disabled={busy} placeholder={t("shell.pathPlaceholder")} onChange={event => setPath(event.target.value)} />{typeof window !== "undefined" && window.piImaginDesktop?.chooseExecutable && <ConfigButton type="button" variant="secondary" size="small" disabled={busy} onClick={() => void chooseDesktopExecutable().then(value => { if (value) setPath(value); }).catch(cause => setError(String(cause.message)))}>{t("project.browse")}</ConfigButton>}</span></label>
          <p className="settings-general-description">{t("shell.validateHint")}</p>
          {kind === "wsl" && <p className="settings-general-description">{t("shell.wslHint")}</p>}
          {error && <p role="alert" className="settings-general-error">{t("shell.failed")} {error}</p>}
          <div className="shell-add-actions"><ConfigButton type="button" variant="ghost" disabled={busy} onClick={() => setAdding(false)}>{t("i18n.cancel")}</ConfigButton><ConfigButton type="submit" disabled={busy || !label.trim() || !path.trim()}>{t(busy ? "shell.validating" : "shell.validateAdd")}</ConfigButton></div>
        </form>
      </div>
    </ConfigPanelShell>, document.body)}
  </section>;
}
