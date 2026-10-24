import { randomUUID } from "node:crypto";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { getGlobalSettingsPath, readGlobalSettings, updateGlobalSettings } from "./global-settings-file";
import { defaultToolEntries } from "./global-settings-file";
import { replaceShellTool, resolveDefaultToolEntries } from "./powershell-settings";
import { samePath } from "./paths";
import type { ShellKind, ShellProfile, ShellProfileChange, ShellProfileSettings } from "./shell-profile-types";

const KEY = "piImaginShells";
interface StoredShells { version: 1; added: string[]; custom: { id: string; label: string; path: string; kind: ShellKind }[]; order: string[] }
const KINDS: ShellKind[] = ["powershell", "cmd", "bash", "zsh", "sh", "wsl"];
export class ShellProfileError extends Error {}

function executable(path: string | undefined): path is string {
  try { if (!path || !isAbsolute(path) || !statSync(path).isFile()) return false; accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK); return true; } catch { return false; }
}
function find(name: string): string | undefined {
  return (process.env.PATH ?? process.env.Path ?? "").split(delimiter).map(dir => join(dir.replace(/^"|"$/g, ""), name)).find(executable);
}
export function discoverShellProfiles(): ShellProfile[] {
  const windows = process.platform === "win32";
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const profiles: ShellProfile[] = [];
  const add = (id: string, label: string, path: string | undefined, kind: ShellKind, builtin = false) => {
    if (path && (builtin || executable(path))) profiles.push({ id, label, path, kind, builtin, available: executable(path), modelSupported: kind !== "wsl" });
  };
  if (windows) {
    add("powershell", "Windows PowerShell", join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), "powershell", true);
    add("cmd", "CMD", process.env.ComSpec ?? join(systemRoot, "System32", "cmd.exe"), "cmd", true);
    add("pwsh", "PowerShell 7", find("pwsh.exe") ?? join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe"), "powershell");
    const git = find("git.exe");
    const roots = [git && dirname(dirname(git)), process.env.ProgramFiles && join(process.env.ProgramFiles, "Git"), process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Git"), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Git")];
    add("gitbash", "Git Bash", roots.filter((root): root is string => Boolean(root)).map(root => join(root, "bin", "bash.exe")).find(executable), "bash");
    add("wsl", "WSL", find("wsl.exe") ?? join(systemRoot, "System32", "wsl.exe"), "wsl");
  } else {
    const system = process.env.SHELL || "/bin/sh";
    const kind: ShellKind = basename(system) === "zsh" ? "zsh" : basename(system) === "bash" ? "bash" : "sh";
    add("system", basename(system), system, kind, true);
    add("sh", "Shell", "/bin/sh", "sh", true);
    add("bash", "Bash", find("bash"), "bash");
    add("zsh", "Zsh", find("zsh"), "zsh");
  }
  return profiles.filter((profile, index) => !profiles.slice(0, index).some(item => samePath(item.path, profile.path)));
}
function stored(settings: Record<string, unknown>): StoredShells {
  if (settings[KEY] === undefined) return { version: 1, added: [], custom: [], order: [] };
  const value = settings[KEY] as StoredShells;
  if (!value || value.version !== 1 || !Array.isArray(value.added) || !Array.isArray(value.order) || !Array.isArray(value.custom)
    || value.added.some(id => typeof id !== "string") || value.order.some(id => typeof id !== "string")
    || value.custom.length > 16 || value.custom.some(item => !item || !/^custom-[a-f0-9-]+$/.test(item.id) || typeof item.label !== "string" || typeof item.path !== "string" || !isAbsolute(item.path) || !KINDS.includes(item.kind))) throw new ShellProfileError("Invalid command environment settings");
  return structuredClone(value);
}
export function shellProfileSettings(settings: Record<string, unknown>, detected = discoverShellProfiles()): ShellProfileSettings {
  const value = stored(settings);
  const custom: ShellProfile[] = value.custom.map(item => ({ ...item, builtin: false, available: executable(item.path), modelSupported: item.kind !== "wsl" }));
  const profiles = [...detected.filter(item => item.builtin || value.added.includes(item.id)), ...custom];
  // 已添加的检测项失效后仍留在列表，便于重装、改路径或移除；不伪装成可用。
  for (const id of value.added) if (!profiles.some(item => item.id === id)) profiles.push({ id, label: id, path: "", kind: id === "pwsh" ? "powershell" : id === "wsl" ? "wsl" : "bash", builtin: false, available: false, modelSupported: id !== "wsl" });
  profiles.sort((a, b) => { const rank = (id: string) => { const index = value.order.indexOf(id); return index < 0 ? value.order.length : index; }; return rank(a.id) - rank(b.id); });
  return { profiles, detected, selectedId: profiles.find(item => item.available && item.modelSupported)?.id };
}
export function selectedShellProfile(settings: Record<string, unknown>): ShellProfile {
  const value = shellProfileSettings(settings);
  const selected = value.profiles.find(item => item.id === value.selectedId);
  if (!selected) throw new ShellProfileError("No available command environment. Check Settings > Command environments.");
  return selected;
}
export function resolveEnvironmentTools(names: readonly string[], settings: { getGlobalSettings(): unknown }): string[] {
  if (!names.some(name => name === "bash" || name === "powershell")) return [...names];
  const profile = selectedShellProfile(settings.getGlobalSettings() as Record<string, unknown>);
  return replaceShellTool(names, profile.kind === "powershell");
}
export function readShellProfilesSync(settingsPath = getGlobalSettingsPath()): ShellProfileSettings {
  let settings: Record<string, unknown>;
  try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return shellProfileSettings({}); throw error; }
  return shellProfileSettings(settings);
}
export function readShellProfiles(settingsPath = getGlobalSettingsPath()) {
  return readGlobalSettings(settingsPath, settings => shellProfileSettings(settings));
}

/** 添加前用固定的无副作用指令验证环境；不接收用户提供的启动参数或测试命令。 */
export async function validateShellProfile(profile: ShellProfile): Promise<void> {
  if (!executable(profile.path)) throw new ShellProfileError("Executable not found or not executable");
  const marker = "PI_IMAGIN_SHELL_READY";
  const args = profile.kind === "powershell" ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `[Console]::Write('${marker}')`]
    : profile.kind === "cmd" ? ["/d", "/s", "/c", `echo ${marker}`]
    : profile.kind === "wsl" ? ["--exec", "sh", "-c", `printf ${marker}`] : ["-c", `printf ${marker}`];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(profile.path, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new ShellProfileError("Environment did not respond within 5 seconds")); }, 5000);
    child.stdout.on("data", data => { output = (output + data.toString()).slice(-2048); });
    child.stderr.resume();
    child.once("error", () => { clearTimeout(timer); reject(new ShellProfileError("Could not start this environment")); });
    child.once("close", code => { clearTimeout(timer); if (code === 0 && output.includes(marker)) resolve(); else reject(new ShellProfileError("Environment validation failed; check the executable and syntax type")); });
  });
}
export async function changeShellProfiles(input: unknown, settingsPath = getGlobalSettingsPath()): Promise<ShellProfileSettings> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ShellProfileError("Invalid environment change");
  const change = input as ShellProfileChange;
  const detected = discoverShellProfiles();
  let custom: StoredShells["custom"][number] | undefined;
  if (change.action === "custom") {
    if (typeof change.path !== "string" || change.path.length > 4096 || !isAbsolute(change.path) || /[\x00-\x1f]/.test(change.path) || typeof change.label !== "string" || !change.label.trim() || change.label.length > 64 || /[\x00-\x1f]/.test(change.label) || !KINDS.includes(change.kind)) throw new ShellProfileError("Enter a valid name, absolute executable path and syntax type");
    custom = { id: `custom-${randomUUID()}`, label: change.label.trim(), path: change.path.trim(), kind: change.kind };
    await validateShellProfile({ ...custom, builtin: false, available: true, modelSupported: custom.kind !== "wsl" });
  } else if (change.action === "add") {
    const profile = detected.find(item => item.id === change.id);
    if (!profile || profile.builtin) throw new ShellProfileError("Environment is not available to add");
    await validateShellProfile(profile);
  }
  await updateGlobalSettings(settingsPath, settings => {
    const value = stored(settings), current = shellProfileSettings(settings, detected).profiles;
    if (change.action === "reset") { value.order = []; }
    else if (change.action === "order") {
      if (!Array.isArray(change.order) || change.order.length !== current.length || new Set(change.order).size !== current.length || change.order.some(id => !current.some(item => item.id === id))) throw new ShellProfileError("Environment list changed. Refresh and try again.");
      value.order = change.order;
    } else if (change.action === "remove") {
      const profile = current.find(item => item.id === change.id);
      if (!profile || profile.builtin) throw new ShellProfileError("System environments cannot be removed");
      value.added = value.added.filter(id => id !== change.id); value.custom = value.custom.filter(item => item.id !== change.id); value.order = value.order.filter(id => id !== change.id);
    } else if (change.action === "add" || custom) {
      if (current.length >= 24) throw new ShellProfileError("Too many environments");
      const profile = custom ?? detected.find(item => item.id === (change as { id: string }).id)!;
      if (current.some(item => item.id === profile.id || (item.path && samePath(item.path, profile.path)))) throw new ShellProfileError("This environment is already in the list");
      if (!value.order.length) value.order = current.map(item => item.id);
      if (custom) value.custom.push(custom); else value.added.push(profile.id);
      value.order.push(profile.id);
    } else throw new ShellProfileError("Unknown environment action");
    settings[KEY] = value;
    // 同一把锁只更新 Shell 选择，保留 Code mode 及其他工具条目。
    const selected = selectedShellProfile(settings);
    const tools = replaceShellTool(resolveDefaultToolEntries(defaultToolEntries(settings) ?? ["read", "bash", "edit", "write"]), selected.kind === "powershell");
    settings.defaultTools = tools;
  });
  return readShellProfiles(settingsPath);
}
