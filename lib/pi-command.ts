import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { getGlobalSettingsPath, readGlobalSettings, updateGlobalSettings } from "./global-settings-file";

const KEY = "piImaginExternalPi";
const MARKER = "Pi Imagin managed command";
const run = promisify(execFile);

export interface PiCommandSettings { supported: boolean; enabled: boolean; registered: boolean }

/** 只增删应用自己的用户 PATH 项，保留原始变量引用、类型、顺序和其他项。 */
export const USER_PATH_SCRIPT = `
$ErrorActionPreference = 'Stop'
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:PI_IMAGIN_PATH_DATA)) | ConvertFrom-Json
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
  $original = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $entries = @($original -split ';')
  $target = $data.directory.TrimEnd('\\')
  $matches = @($entries | Where-Object { $_.Trim().Trim('"').TrimEnd('\\') -ieq $target })
  if ($data.action -eq 'read') { if ($matches.Count -gt 0) { 'true' } else { 'false' }; exit }
  if ($data.action -eq 'enable' -and $matches.Count -eq 0) {
    $next = if ($original) { $original.TrimEnd(';') + ';' + $data.directory } else { $data.directory }
  } elseif ($data.action -eq 'disable' -and $matches.Count -gt 0) {
    $next = (@($entries | Where-Object { $_.Trim().Trim('"').TrimEnd('\\') -ine $target }) -join ';')
  } else { exit }
  $kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
  $key.SetValue('Path', $next, $kind)
} finally { $key.Dispose() }
Add-Type -Namespace PiImagin -Name EnvironmentNotice -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr window, uint message, System.UIntPtr wParam, string lParam, uint flags, uint timeout, out System.UIntPtr result);'
$result = [UIntPtr]::Zero
[void][PiImagin.EnvironmentNotice]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$result)
`;

function commandPaths() {
  const manifestPath = findPackageJSON("@earendil-works/pi-coding-agent", pathToFileURL(join(process.cwd(), "package.json")).href);
  if (!manifestPath) throw new Error("Pi CLI package is unavailable.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bin?: { pi?: string } };
  if (!manifest.bin?.pi) throw new Error("Pi CLI entry is unavailable.");
  const cli = join(dirname(manifestPath), manifest.bin.pi);
  if (!existsSync(cli)) throw new Error("Pi CLI is missing. Repair the application installation.");
  return { node: process.execPath, cli };
}

export function writePiLaunchers(directory: string, node: string, cli: string): void {
  // CMD 禁用延迟展开，百分号使用批处理转义；Git Bash 使用标准单引号转义。
  const cmdQuote = (value: string) => `"${value.replace(/%/g, "%%")}"`;
  const shQuote = (value: string) => `'${value.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
  const files = {
    "pi.cmd": `@rem ${MARKER}\r\n@echo off\r\nsetlocal DisableDelayedExpansion\r\n${cmdQuote(node)} ${cmdQuote(cli)} %*\r\nexit /b %errorlevel%\r\n`,
    pi: `#!/bin/sh\n# ${MARKER}\nexec ${shQuote(node)} ${shQuote(cli)} "$@"\n`,
  };
  for (const name of Object.keys(files)) {
    const path = join(directory, name);
    if (existsSync(path) && !readFileSync(path, "utf8").includes(MARKER)) throw new Error("The command location contains an unmanaged Pi command.");
  }
  mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    const path = join(directory, name);
    if (!existsSync(path) || readFileSync(path, "utf8") !== value) writeFileSync(path, value, { mode: 0o755 });
  }
}

export function removePiLaunchers(directory: string): void {
  for (const name of ["pi.cmd", "pi"]) {
    const path = join(directory, name);
    if (existsSync(path) && readFileSync(path, "utf8").includes(MARKER)) unlinkSync(path);
  }
}

function externalDirectory(): string {
  if (!process.env.LOCALAPPDATA) throw new Error("The Windows user application directory is unavailable.");
  return join(process.env.LOCALAPPDATA, "Pi Imagin", "command-bin");
}

async function userPath(action: "read" | "enable" | "disable", directory: string): Promise<boolean> {
  const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const { stdout } = await run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(USER_PATH_SCRIPT, "utf16le").toString("base64")], {
    windowsHide: true, timeout: 10000, maxBuffer: 16384,
    env: { ...process.env, PI_IMAGIN_PATH_DATA: Buffer.from(JSON.stringify({ action, directory })).toString("base64") },
  });
  return stdout.trim() === "true";
}

export async function readPiCommandSettings(): Promise<PiCommandSettings> {
  const enabled = await readGlobalSettings(getGlobalSettingsPath(), settings => settings[KEY] !== false);
  if (process.platform !== "win32") return { supported: false, enabled, registered: false };
  const directory = externalDirectory();
  return { supported: true, enabled, registered: existsSync(join(directory, "pi.cmd")) && await userPath("read", directory) };
}

async function applyExternalCommand(enabled: boolean): Promise<void> {
  const directory = externalDirectory();
  if (enabled) {
    const { node, cli } = commandPaths();
    writePiLaunchers(directory, node, cli);
    await userPath("enable", directory);
  } else {
    await userPath("disable", directory);
    removePiLaunchers(directory);
  }
}

let pending: Promise<unknown> = Promise.resolve();
export function changePiCommandSettings(enabled: boolean): Promise<PiCommandSettings> {
  const task = pending.catch(() => {}).then(async () => {
    if (process.platform !== "win32") throw new Error("External Pi command registration is currently available on Windows.");
    const previous = await readGlobalSettings(getGlobalSettingsPath(), settings => settings[KEY] !== false);
    await applyExternalCommand(enabled);
    try { await updateGlobalSettings(getGlobalSettingsPath(), settings => { settings[KEY] = enabled; }); }
    catch (error) { await applyExternalCommand(previous); throw error; }
    return { supported: true, enabled, registered: enabled };
  });
  pending = task;
  return task;
}

/** 桌面启动修复自身入口的运行时位置，关闭状态不会在更新后被重新开启。 */
export async function initializeExternalPiCommand(): Promise<void> {
  if (process.platform !== "win32" || process.env.PI_IMAGIN_DESKTOP !== "1") return;
  const enabled = await readGlobalSettings(getGlobalSettingsPath(), settings => settings[KEY] !== false);
  await applyExternalCommand(enabled);
}

/** 应用终端使用独立入口；关闭对外注册仍能在应用内执行 Pi。 */
export function internalPiCommandDirectory(): string | undefined {
  if (process.platform !== "win32") return undefined;
  const directory = join(dirname(getGlobalSettingsPath()), "terminal-bin");
  const { node, cli } = commandPaths();
  writePiLaunchers(directory, node, cli);
  return directory;
}
