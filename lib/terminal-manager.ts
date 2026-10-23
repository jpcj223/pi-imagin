import { randomUUID } from "crypto";
import { homedir } from "os";
import { existsSync, statSync } from "fs";
import { delimiter, join, basename, dirname } from "path";
import type { IPty } from "node-pty";
import { samePath } from "./paths";
import { readTerminalDirectory } from "./terminal-directory";

export type TerminalEvent =
  | { type: "output"; data: string; offset: number; reset?: boolean }
  | { type: "exit"; exitCode: number }
  | { type: "closed" };

type TerminalListener = (event: TerminalEvent) => void;

interface TerminalRecord {
  pty: IPty;
  cwd: string;
  shellLabel: string;
  shellId?: string;
  currentCwd?: string;
  directorySequence?: string;
  listeners: Set<TerminalListener>;
  backlog: string;
  offset: number;
  exited: boolean;
  exitCode: number | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

declare global {
  var __piImaginTerminals: Map<string, TerminalRecord> | undefined;
}

// ponytail: bounded replay; use terminal serialization if full-screen snapshots become necessary.
const MAX_BACKLOG = 128 * 1024;
export const TERMINAL_RECONNECT_MS = 120_000;

function registry(): Map<string, TerminalRecord> {
  if (!globalThis.__piImaginTerminals) {
    globalThis.__piImaginTerminals = new Map();
    const shutdown = () => {
      for (const id of globalThis.__piImaginTerminals!.keys()) killTerminal(id, true);
    };
    process.once("exit", shutdown);
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
  return globalThis.__piImaginTerminals;
}

function shellEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // The browser login password guards this server, not the shells it starts.
    const comparableKey = process.platform === "win32" ? key.toUpperCase() : key;
    if (value !== undefined && comparableKey !== "PI_WEB_PASSWORD") env[key] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  // Windows shells (Git Bash / MSYS2, cmd, PowerShell) otherwise inherit the
  // system ANSI codepage (e.g. GBK on zh-CN) and mangle non-ASCII filenames.
  if (!process.env.LANG && !process.env.LC_ALL && !process.env.LC_CTYPE) env.LANG = "C.UTF-8";
  return env;
}

function emit(record: TerminalRecord, event: TerminalEvent): void {
  for (const listener of record.listeners) listener(event);
}

function scheduleCleanup(id: string, record: TerminalRecord): void {
  if (record.cleanupTimer || record.listeners.size || registry().get(id) !== record) return;
  record.cleanupTimer = setTimeout(() => killTerminal(id), TERMINAL_RECONNECT_MS);
  record.cleanupTimer.unref?.();
}

function dimension(value: number, fallback: number): number {
  return Math.min(1000, Math.max(2, Number.isFinite(value) ? Math.floor(value) : fallback));
}

// 只提供已安装的固定 Shell，客户端不能指定任意可执行路径或启动参数。
function terminalShells() {
  const installed = (path: string | undefined) => {
    try { return path && existsSync(path) && statSync(path).isFile() ? path : undefined; } catch { return undefined; }
  };
  const find = (name: string) => (process.env.PATH ?? process.env.Path ?? "").split(delimiter).map(dir => join(dir.replace(/^"|"$/g, ""), name)).find(path => {
    try { return existsSync(path) && statSync(path).isFile(); } catch { return false; }
  });
  const windows = process.platform === "win32";
  const profiles = windows
    ? [{ id: "cmd", label: "CMD", path: process.env.ComSpec ?? find("cmd.exe") }, { id: "powershell", label: "Windows PowerShell", path: find("powershell.exe") }, { id: "pwsh", label: "PowerShell", path: find("pwsh.exe") ?? installed(join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe")) }]
    : [{ id: "bash", label: "Bash", path: find("bash") }, { id: "zsh", label: "Zsh", path: find("zsh") }];
  if (windows) {
    // Git 自带的 Bash 与 WSL 使用各自固定参数，不套用 PowerShell 初始化命令。
    const gitExe = find("git.exe");
    const gitRoots = [process.env.ProgramFiles && join(process.env.ProgramFiles, "Git"), process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Git"), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Git"), gitExe && dirname(dirname(gitExe))].filter((root): root is string => Boolean(root));
    const gitBash = gitRoots.map(root => installed(join(root, "bin", "bash.exe"))).find(Boolean);
    profiles.push({ id: "gitbash", label: "Git Bash", path: gitBash }, { id: "wsl", label: "WSL", path: find("wsl.exe") ?? installed(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wsl.exe")) });
  }
  const system = windows ? process.env.ComSpec ?? find("cmd.exe") : process.env.SHELL || "/bin/sh";
  if (system && !profiles.some(item => item.path && samePath(item.path, system))) profiles.push({ id: "system", label: basename(system), path: system });
  return profiles.filter((item): item is typeof item & { path: string } => Boolean(item.path));
}

export function listTerminalShells() {
  return terminalShells().map(({ id, label }) => ({ id, label }));
}

export function getDefaultTerminalShellId(): string | undefined {
  const system = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : process.env.SHELL || "/bin/sh";
  return terminalShells().find(item => samePath(item.path, system) || basename(item.path).toLowerCase() === basename(system).toLowerCase())?.id;
}

export function createTerminal(cwd: string, cols: number, rows: number, id: string = randomUUID(), shellId?: string): string {
  const existing = registry().get(id);
  if (existing) {
    if (!samePath(existing.cwd, cwd)) throw new Error("Terminal belongs to a different workspace");
    return id;
  }
  let spawn: typeof import("node-pty").spawn;
  try {
    // Load inside creation so native module failures reach the API's JSON error handler.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ spawn } = require("node-pty") as typeof import("node-pty"));
  } catch (error) {
    throw new Error(
      `Cannot load the node-pty native terminal module for ${process.platform}-${process.arch}. ` +
      "The binary may be missing or incompatible. In the pi-imagin installation directory " +
      "(the npx cache directory when using npx), run: npm rebuild node-pty --build-from-source --ignore-scripts=false --foreground-scripts. " +
      "On Debian/Ubuntu, install build tools first: sudo apt-get install -y python3 build-essential. " +
      `Then restart pi-imagin. Original error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const profile = terminalShells().find(item => item.id === (shellId ?? getDefaultTerminalShellId()));
  if (shellId && !profile) throw new Error("Shell is not available on this server");
  const shell = profile?.path ?? (process.platform === "win32"
    ? process.env.ComSpec ?? "cmd.exe"
    : process.env.SHELL || "/bin/sh");
  const shellLabel = profile?.label ?? (process.platform === "win32" ? "CMD" : basename(shell));
  // 仅在提示符处通知真实目录，不向正在运行的程序注入查询命令；PowerShell 保留原提示符。
  const args = profile?.id === "gitbash" ? ["--login", "-i"] : profile?.id === "wsl" ? ["--cd", cwd || homedir()]
    : process.platform !== "win32" ? ["-l"] : shellLabel === "CMD" ? ["/K", "chcp 65001>nul & prompt $E]9;9;$P$E\\$P$G"]
    : ["-NoLogo", "-NoExit", "-Command", "$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; $global:__piImaginOriginalPrompt = $function:prompt; function global:prompt { try { [Console]::Write(([char]27) + ']7;' + ([uri]$executioncontext.SessionState.Path.CurrentFileSystemLocation.Path).AbsoluteUri + [char]7) } catch {}; if ($global:__piImaginOriginalPrompt) { & $global:__piImaginOriginalPrompt } else { 'PS ' + (Get-Location) + '> ' } }"];
  const pty = spawn(shell, args, {
    name: "xterm-256color",
    cols: dimension(cols, 80),
    rows: dimension(rows, 24),
    cwd: cwd || homedir(),
    env: shellEnvironment(),
  });
  const record: TerminalRecord = {
    pty,
    cwd,
    shellLabel,
    shellId: profile?.id,
    currentCwd: cwd,
    listeners: new Set(),
    backlog: "",
    offset: 0,
    exited: false,
    exitCode: null,
    cleanupTimer: null,
  };
  registry().set(id, record);
  // Includes creations whose response or initial SSE connection never arrives.
  scheduleCleanup(id, record);

  pty.onData((data) => {
    const directory = readTerminalDirectory(record.directorySequence ?? "", data);
    record.directorySequence = directory.pending;
    if (directory.cwd) record.currentCwd = directory.cwd;
    record.backlog = (record.backlog + data).slice(-MAX_BACKLOG);
    record.offset += data.length;
    emit(record, { type: "output", data, offset: record.offset });
  });
  pty.onExit(({ exitCode }) => {
    if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
    record.cleanupTimer = null;
    record.exited = true;
    record.exitCode = exitCode;
    emit(record, { type: "exit", exitCode });
    scheduleCleanup(id, record);
  });
  return id;
}

export function hasTerminal(id: string): boolean {
  return registry().has(id);
}

export function shutdownAllTerminals(): void {
  for (const id of registry().keys()) killTerminal(id, true);
}

export function getTerminalCwd(id: string): string | undefined {
  return registry().get(id)?.cwd;
}

export function getTerminalShell(id: string): string | undefined {
  return registry().get(id)?.shellLabel;
}

export function getTerminalProfile(id: string): { shellId?: string; currentCwd: string } | undefined {
  const record = registry().get(id);
  return record ? { shellId: record.shellId ?? terminalShells().find(shell => shell.label === record.shellLabel)?.id, currentCwd: record.currentCwd ?? record.cwd } : undefined;
}

export function subscribeTerminal(
  id: string,
  listener: TerminalListener,
  after?: number,
): { output: Extract<TerminalEvent, { type: "output" }>; exited: boolean; exitCode: number | null; unsubscribe: () => void } | null {
  const record = registry().get(id);
  if (!record) return null;
  record.listeners.add(listener);
  if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
  record.cleanupTimer = null;
  const start = record.offset - record.backlog.length;
  const reset = after === undefined || after < start || after > record.offset;
  return {
    output: {
      type: "output",
      data: reset ? record.backlog : record.backlog.slice(after - start),
      offset: record.offset,
      reset,
    },
    exited: record.exited,
    exitCode: record.exitCode,
    unsubscribe: () => {
      record.listeners.delete(listener);
      scheduleCleanup(id, record);
    },
  };
}

export function writeTerminal(id: string, data: string): boolean {
  const record = registry().get(id);
  if (!record || record.exited) return false;
  record.pty.write(data);
  return true;
}

export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const record = registry().get(id);
  if (!record || record.exited) return false;
  record.pty.resize(dimension(cols, 80), dimension(rows, 24));
  return true;
}

export function killTerminal(id: string, force = false): boolean {
  const record = registry().get(id);
  if (!record) return false;
  if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
  registry().delete(id);
  if (!record.exited) {
    // Windows ConPTY 不接受信号名称，由原生 kill 回收控制台进程。
    record.pty.kill(force && process.platform !== "win32" ? "SIGKILL" : undefined);
    // A shell may trap SIGHUP; explicit close and lease expiry must still finish.
    if (!force && process.platform !== "win32") {
      record.cleanupTimer = setTimeout(() => {
        if (!record.exited) record.pty.kill("SIGKILL");
      }, 2000);
      record.cleanupTimer.unref?.();
    }
  }
  emit(record, { type: "closed" });
  record.listeners.clear();
  return true;
}
