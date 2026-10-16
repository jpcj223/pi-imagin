import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 与 SDK getAgentDir 保持一致；读取目录配置不加载智能体运行时。 */
export function getAgentDir(): string {
  let configured = process.env.PI_CODING_AGENT_DIR;
  if (!configured) return join(homedir(), ".pi", "agent");
  if (process.platform === "win32" && configured.startsWith("/") && !configured.startsWith("//") && !configured.includes("\\")) {
    const match = configured.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
    if (match) configured = `${match[1].toUpperCase()}:\\${match[2]?.replaceAll("/", "\\") ?? ""}`;
  }
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || (process.platform === "win32" && configured.startsWith("~\\"))) return join(homedir(), configured.slice(2));
  if (/^file:\/\//.test(configured)) return fileURLToPath(configured);
  return configured;
}
