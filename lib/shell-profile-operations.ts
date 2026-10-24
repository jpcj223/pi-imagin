import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getPackageDir, type BashOperations } from "@earendil-works/pi-coding-agent";
import { selectedShellProfile } from "./shell-profiles";
import type { ShellKind, ShellProfile } from "./shell-profile-types";

type LocalFactory = (name: string, config: () => { shell: string; args: string[] }) => BashOperations;
let factory: Promise<LocalFactory> | undefined;
function localFactory() {
  // 复用同一 SDK 的进程树取消、超时、输出和退出状态；不复制进程执行器。
  return factory ??= import(/* webpackIgnore: true */ pathToFileURL(join(getPackageDir(), "dist/core/tools/bash.js")).href).then(module => {
    if (typeof module.createLocalShellOperations !== "function") throw new Error("SDK shell execution is unavailable");
    return module.createLocalShellOperations as LocalFactory;
  });
}
export function shellCommandArguments(profile: ShellProfile): string[] {
  return profile.kind === "powershell" ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"] : profile.kind === "cmd" ? ["/d", "/s", "/c"] : ["-c"];
}
export function createEnvironmentOperations(settings: { getGlobalSettings(): unknown } | ShellProfile, expectedKind?: ShellKind): BashOperations {
  // 在会话/扩展加载时确定环境。运行中程序失效应报错，不能换语法执行已经生成的命令。
  const profile = "getGlobalSettings" in settings ? selectedShellProfile(settings.getGlobalSettings() as Record<string, unknown>) : settings;
  return { async exec(command, cwd, options) {
    if (expectedKind && profile.kind !== expectedKind) throw new Error("Command environment changed. Reload the session before running commands.");
    if (!profile.available || !profile.modelSupported) throw new Error("Selected environment is unavailable for model commands");
    const createLocal = await localFactory();
    const local = createLocal(profile.label, () => ({ shell: profile.path, args: shellCommandArguments(profile) }));
    if (profile.kind === "powershell") {
      const key = `PI_IMAGIN_PS_SOURCE_${randomUUID().replaceAll("-", "")}`;
      // 在解析命令前设置编码，原文通过单次子进程环境传递，避免引号和语法错误破坏编码。
      const wrapper = `try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n$piSource=[Environment]::GetEnvironmentVariable('${key}'); [Environment]::SetEnvironmentVariable('${key}',$null); & ([scriptblock]::Create($piSource))`;
      return local.exec(wrapper, cwd, { ...options, env: { ...(options.env ?? process.env), [key]: command } });
    }
    // 执行后报错不跨环境重试，避免命令副作用被重复执行。
    return local.exec(profile.kind === "cmd" ? `chcp 65001>nul & ${command}` : command, cwd, options);
  } };
}
