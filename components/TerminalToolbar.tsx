"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SidebarMenu, type SidebarMenuItem, type SidebarMenuSelectEvent } from "./SidebarMenu";
import { TerminalIcon } from "./TerminalIcon";

interface Props {
  status: "connecting" | "ready" | "exited" | "error";
  shellLabel: string;
  cwd: string;
  shells: { id: string; label: string }[];
  preferredShell?: string;
  layoutKey?: string;
  disabled: boolean;
  onNew?: (shell: string) => void;
  onSearch: () => void;
  onClear: () => void;
  onDuplicate: () => void;
  onRestart: () => void;
  onReconnect: () => void;
  onRefreshShells: () => Promise<void>;
}

const ADDED_SHELLS_KEY = "pi-terminal-added-shells";
const SHELLS_CHANGED = "pi-terminal-shells-changed";
const shellIcon = (id: string) => id === "cmd" ? "cmd" : id === "powershell" || id === "pwsh" ? "powershell" : id === "wsl" ? "linux" : "bash";

export function TerminalToolbar(props: Props) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ kind: "shell" | "more" | "add"; opener: HTMLButtonElement; rect: DOMRect } | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  useEffect(() => {
    const sync = () => {
      try { const saved = JSON.parse(localStorage.getItem(ADDED_SHELLS_KEY) ?? "[]"); setAdded(Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []); } catch { /* 损坏存储不影响默认列表。 */ }
    };
    sync(); window.addEventListener("storage", sync); window.addEventListener(SHELLS_CHANGED, sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(SHELLS_CHANGED, sync); };
  }, []);
  useEffect(() => { setMenu(null); }, [props.layoutKey]);
  const openMenu = (kind: "shell" | "more", opener: HTMLButtonElement) => {
    setMenu(current => current?.kind === kind ? null : { kind, opener, rect: opener.getBoundingClientRect() });
  };
  // 保留原有默认类型；额外检测到的终端由用户加入，选择偏好中的类型始终可见。
  const visibleShells = props.shells.filter(shell => !["gitbash", "wsl"].includes(shell.id) || added.includes(shell.id) || shell.id === props.preferredShell);
  const addShell = (id: string) => {
    const next = [...new Set([...added, id])]; setAdded(next);
    try { localStorage.setItem(ADDED_SHELLS_KEY, JSON.stringify(next)); window.dispatchEvent(new Event(SHELLS_CHANGED)); } catch {}
    setMenu(current => current && ({ ...current, kind: "shell" }));
  };
  const items: SidebarMenuItem[] = menu?.kind === "shell" ? [
    ...(visibleShells.length ? visibleShells.map(shell => ({
    type: "item" as const, id: shell.id, label: shell.label, icon: <TerminalIcon name={shellIcon(shell.id)} />,
    note: shell.id === props.preferredShell ? t("terminal.preferred") : undefined,
    disabled: props.disabled,
    onSelect: () => props.onNew?.(shell.id),
  })) : [{ type: "item" as const, id: "unavailable", label: t("terminal.shellsUnavailable"), disabled: true, onSelect() {} }]),
    { type: "separator", id: "add-divider" },
    { type: "item", id: "add", label: t("terminal.addShell"), icon: <TerminalIcon name="plus" />, onSelect: event => { event.keepOpen(); setRefreshFailed(false); setMenu(current => current && ({ ...current, kind: "add" })); } },
  ] : menu?.kind === "add" ? [
    { type: "header", id: "installed-title", label: t("terminal.installedShells") },
    ...props.shells.map(shell => ({ type: "item" as const, id: shell.id, label: shell.label, icon: <TerminalIcon name={shellIcon(shell.id)} />,
      disabled: visibleShells.some(item => item.id === shell.id), note: visibleShells.some(item => item.id === shell.id) ? t("terminal.added") : undefined,
      onSelect: (event: SidebarMenuSelectEvent) => { event.keepOpen(); addShell(shell.id); },
    })),
    { type: "separator", id: "refresh-divider" },
    { type: "custom", id: "install-hint", content: <p className="terminal-shell-hint">{t("terminal.installShellHint")}</p> },
    ...(refreshFailed ? [{ type: "header" as const, id: "refresh-error", label: t("terminal.shellsUnavailable") }] : []),
    { type: "item", id: "refresh", label: t(refreshing ? "terminal.refreshingShells" : "terminal.refreshShells"), icon: <TerminalIcon name="restart" />, disabled: refreshing,
      onSelect: event => { event.keepOpen(); setRefreshing(true); setRefreshFailed(false); void props.onRefreshShells().catch(() => setRefreshFailed(true)).finally(() => setRefreshing(false)); } },
  ] : [
    { type: "item", id: "clear", label: t("terminal.clear"), icon: <TerminalIcon name="clear" />, onSelect: props.onClear },
    { type: "item", id: "duplicate", label: t("terminal.duplicate"), icon: <TerminalIcon name="duplicate" />, disabled: props.disabled, onSelect: props.onDuplicate },
    { type: "separator", id: "restart-divider" },
    { type: "item", id: "restart", label: t("terminal.restart"), icon: <TerminalIcon name="restart" />, disabled: props.disabled, onSelect: props.onRestart },
  ];
  return <>
    <div className="terminal-panel-path" title={`${props.shellLabel} · ${props.cwd}`}>
      <span className={`terminal-status-dot is-${props.status}`} title={t(`terminal.${props.status}`)} />
      <span>{props.shellLabel || t(`terminal.${props.status}`)}</span>
    </div>
    {props.onNew && <button type="button" aria-label={t("terminal.new")} title={t("terminal.new")} aria-haspopup="menu" aria-expanded={menu?.kind === "shell" || menu?.kind === "add"} onClick={event => menu?.kind === "add" ? setMenu(null) : openMenu("shell", event.currentTarget)}><TerminalIcon name="down" /></button>}
    <button type="button" aria-label={t("terminal.search")} title={t("terminal.search")} onClick={() => { setMenu(null); props.onSearch(); }}><TerminalIcon name="search" /></button>
    {props.status === "error" && <button type="button" aria-label={t("terminal.reconnect")} title={t("terminal.reconnect")} disabled={props.disabled} onClick={() => { setMenu(null); props.onReconnect(); }}><TerminalIcon name="restart" /></button>}
    <button type="button" aria-label={t("terminal.more")} title={t("terminal.more")} aria-haspopup="menu" aria-expanded={menu?.kind === "more"} onClick={event => openMenu("more", event.currentTarget)}><TerminalIcon name="more" /></button>
    <SidebarMenu open={menu !== null} sheet={false} anchor={menu ? { kind: "rect", rect: menu.rect, align: "end" } : null} width={224} focusKey={menu?.kind} ariaLabel={t(menu?.kind === "add" ? "terminal.addShell" : menu?.kind === "shell" ? "terminal.new" : "terminal.more")} cancelLabel={t("i18n.cancel")} returnFocusTo={menu?.opener} items={items} onClose={() => setMenu(null)} />
  </>;
}
