import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { updateGlobalSettings } from "./global-settings-file";

/** 独立安装记录，不以包名或 npm 目录猜测安装入口。旧版无记录项标为外置。 */
function file(agentDir: string, cwd?: string | null) { return join(cwd ? join(cwd, ".pi") : agentDir, "plugin-installs.json"); }
export function appPluginSources(agentDir: string, cwd?: string | null): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file(agentDir, cwd), "utf8"));
    const sources = (parsed as { sources?: unknown } | null)?.sources;
    return new Set(Array.isArray(sources) ? sources.filter((value): value is string => typeof value === "string") : []);
  } catch { return new Set(); }
}
export async function recordAppPlugin(agentDir: string, cwd: string | null, source: string, installed: boolean) {
  const target = file(agentDir, cwd);
  if (!installed && !existsSync(target)) return;
  await updateGlobalSettings(target, value => {
    const sources = new Set(Array.isArray(value.sources) ? value.sources.filter((entry): entry is string => typeof entry === "string") : []);
    if (installed) sources.add(source); else sources.delete(source);
    value.version = 1; value.sources = [...sources];
  });
}
