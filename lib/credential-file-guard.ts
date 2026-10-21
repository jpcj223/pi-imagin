import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { isPathWithinRoots } from "./path-security";
import { samePath } from "./paths";

const FILE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

function resolveToolPath(input: string, cwd: string): string {
  // 对齐 SDK 文件工具支持的 @、~、file URL 和 Windows Shell 路径，避免别名绕过比较。
  let value = input.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ").replace(/^@/, "");
  if (value === "~") value = homedir();
  else if (value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\"))) value = join(homedir(), value.slice(2));
  if (value.startsWith("file://")) value = fileURLToPath(value);
  if (process.platform === "win32") {
    value = value.replace(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i, (_match, drive, rest) => `${drive}:\\${(rest ?? "").replaceAll("/", "\\")}`);
    // NTFS 数据流不能成为读取同一凭证文件的另一入口。
    const stream = value.indexOf(":", /^[a-z]:/i.test(value) ? 2 : 0);
    if (stream >= 0) value = value.slice(0, stream);
  }
  return resolve(cwd, value);
}

function canonicalPath(path: string): string {
  try { return realpathSync(path); }
  catch {
    // 新文件尚不存在时仍解析父目录链接，避免写入别名下的凭证目标。
    const parent = dirname(path);
    return parent === path ? path : join(canonicalPath(parent), basename(path));
  }
}

function sameFile(left: string, right: string): boolean {
  if (samePath(left, right)) return true;
  try {
    // 真实路径不能识别硬链接；设备号和文件标识补充判断同一个落盘文件。
    const a = statSync(left, { bigint: true }), b = statSync(right, { bigint: true });
    return a.ino !== BigInt(0) && a.ino === b.ino && a.dev === b.dev;
  } catch { return false; }
}

/** 拦截常规文件工具；Shell、第三方工具及进程权限仍需独立的隔离机制。 */
export function isCredentialFileCall(toolName: string, input: Record<string, unknown>, cwd: string, agentDir: string): boolean {
  const paths = toolName === "project_copy_file" ? [input.source, input.destination]
    : FILE_TOOLS.has(toolName) ? [input.path ?? cwd] : [];
  if (paths.length === 0) return false;
  // 只保护应用智能体目录的凭证配置，项目内同名普通文件仍按原有权限访问。
  const protectedPaths = [join(agentDir, "auth.json"), join(agentDir, "models.json")].map(canonicalPath);
  return paths.some(path => {
    if (typeof path !== "string") return false;
    const target = canonicalPath(resolveToolPath(path, cwd));
    return protectedPaths.some(secret => sameFile(target, secret)
      // 目录内容搜索同样可能把凭证整行送入上下文；普通目录列表不读取正文。
      || (toolName === "grep" && isPathWithinRoots(secret, new Set([target]))));
  });
}

export function createCredentialFileGuardExtension(agentDir: string): InlineExtension {
  return {
    name: "pi-imagin-credential-file-guard",
    hidden: true,
    factory(pi) {
      pi.on("tool_call", (event, context) => {
        if (isCredentialFileCall(event.toolName, event.input, context.cwd, agentDir)) {
          return { block: true, reason: "应用凭证配置不向文件工具开放，认证和模型配置请通过应用设置管理。请勿改用 Shell 绕过此限制。" };
        }
      });
    },
  };
}
