export interface TerminalTab {
  id: string;
  cwd: string;
  shell?: string;
  restored?: boolean;
  restartShell?: string;
  closing?: "close" | "restart";
}

export const TERMINAL_TABS_KEY = "pi-web:terminal-tabs";

export function newTerminalTab(cwd: string, shell?: string): TerminalTab {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!shell) {
    try { shell = localStorage.getItem("pi-terminal-shell") ?? undefined; } catch { /* 存储不可用时使用默认 Shell。 */ }
  }
  return { id, cwd, ...(shell && /^(cmd|powershell|pwsh|bash|zsh|system|gitbash|wsl)$/.test(shell) ? { shell } : {}) };
}

export function restoreTerminalTabs(raw: string | null): { tabs: TerminalTab[]; activeId: string | null; open: boolean } {
  try {
    const saved = JSON.parse(raw ?? "null");
    const tabs: TerminalTab[] = [];
    for (const tab of Array.isArray(saved?.tabs) ? saved.tabs : []) {
      if (tab && typeof tab.id === "string" && /^[a-f0-9]{32}$/.test(tab.id)
        && typeof tab.cwd === "string" && tab.cwd.trim()
        && !tabs.some((existing) => existing.id === tab.id)) {
        tabs.push({ id: tab.id, cwd: tab.cwd, ...(typeof tab.shell === "string" && /^(cmd|powershell|pwsh|bash|zsh|system|gitbash|wsl)$/.test(tab.shell) ? { shell: tab.shell } : {}), restored: true });
      }
    }
    return { tabs, activeId: tabs.some((tab) => tab.id === saved.activeId) ? saved.activeId : null, open: saved?.open === true };
  } catch {
    return { tabs: [], activeId: null, open: false };
  }
}
