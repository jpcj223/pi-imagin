"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SidebarMenu, type SidebarMenuItem } from "./SidebarMenu";
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

const SHELLS_CHANGED = "pi-shell-profiles-changed";
const shellIcon = (id: string) => id === "cmd" ? "cmd" : id === "powershell" || id === "pwsh" ? "powershell" : id === "wsl" ? "linux" : "bash";

export function TerminalToolbar(props: Props) {
  const { t } = useI18n();
  const { onRefreshShells } = props;
  const [menu, setMenu] = useState<{ kind: "shell" | "more"; opener: HTMLButtonElement; rect: DOMRect } | null>(null);
  useEffect(() => {
    const sync = () => { void onRefreshShells().catch(() => {}); };
    window.addEventListener(SHELLS_CHANGED, sync); window.addEventListener("focus", sync);
    return () => { window.removeEventListener(SHELLS_CHANGED, sync); window.removeEventListener("focus", sync); };
  }, [onRefreshShells]);
  useEffect(() => { setMenu(null); }, [props.layoutKey]);
  const openMenu = (kind: "shell" | "more", opener: HTMLButtonElement) => {
    if (kind === "shell") void onRefreshShells().catch(() => {});
    setMenu(current => current?.kind === kind ? null : { kind, opener, rect: opener.getBoundingClientRect() });
  };
  // 环境列表及顺序只由设置管理；这里只选择已配置的环境来新建终端。
  const visibleShells = props.shells;
  const items: SidebarMenuItem[] = menu?.kind === "shell" ? [
    ...(visibleShells.length ? visibleShells.map(shell => ({
    type: "item" as const, id: shell.id, label: shell.label, icon: <TerminalIcon name={shellIcon(shell.id)} />,
    note: shell.id === props.preferredShell ? t("terminal.preferred") : undefined,
    disabled: props.disabled,
    onSelect: () => props.onNew?.(shell.id),
  })) : [{ type: "item" as const, id: "unavailable", label: t("terminal.shellsUnavailable"), disabled: true, onSelect() {} }]),
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
    {props.onNew && <button type="button" aria-label={t("terminal.new")} title={t("terminal.new")} aria-haspopup="menu" aria-expanded={menu?.kind === "shell"} onClick={event => openMenu("shell", event.currentTarget)}><TerminalIcon name="down" /></button>}
    <button type="button" aria-label={t("terminal.search")} title={t("terminal.search")} onClick={() => { setMenu(null); props.onSearch(); }}><TerminalIcon name="search" /></button>
    {props.status === "error" && <button type="button" aria-label={t("terminal.reconnect")} title={t("terminal.reconnect")} disabled={props.disabled} onClick={() => { setMenu(null); props.onReconnect(); }}><TerminalIcon name="restart" /></button>}
    <button type="button" aria-label={t("terminal.more")} title={t("terminal.more")} aria-haspopup="menu" aria-expanded={menu?.kind === "more"} onClick={event => openMenu("more", event.currentTarget)}><TerminalIcon name="more" /></button>
    <SidebarMenu open={menu !== null} sheet={false} anchor={menu ? { kind: "rect", rect: menu.rect, align: "end" } : null} width={224} focusKey={menu?.kind} ariaLabel={t(menu?.kind === "shell" ? "terminal.new" : "terminal.more")} cancelLabel={t("i18n.cancel")} returnFocusTo={menu?.opener} items={items} onClose={() => setMenu(null)} />
  </>;
}
