import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { defaultCwdParent, localDateStamp } from "./default-cwd";
import { samePath } from "./paths";
import type { ManagedProjectState } from "./managed-projects-shared";
import { readRegularFileText } from "./regular-file";

/** 仅应用默认目录下真实的日期工作区免于授权，不扩展到子目录、链接或用户项目。 */
export function isAppDefaultWorkspace(cwd: string, agentDir: string): boolean {
  if (!cwd) return false;
  try {
    const name = basename(resolve(cwd));
    if (!/^\d{8}$/.test(name)) return false;
    const date = new Date(Number(name.slice(0, 4)), Number(name.slice(4, 6)) - 1, Number(name.slice(6)));
    const stat = lstatSync(cwd);
    if (localDateStamp(date) !== name || !stat.isDirectory() || stat.isSymbolicLink()) return false;
    const real = realpathSync(cwd);
    if (!samePath(dirname(real), realpathSync(defaultCwdParent()))) return false;
    const saved = readRegularFileText(join(agentDir, "pi-imagin-projects.json"), 4 * 1024 * 1024);
    if (saved) {
      const state = JSON.parse(saved) as ManagedProjectState;
      if (!Array.isArray(state.projects) || state.projects.some(project => [...project.folders, ...(project.workspace ? [project.workspace] : [])].some(folder => samePath(folder.path, real)))) return false;
    }
    const text = readRegularFileText(join(agentDir, "pi-web-session-state.json"), 4 * 1024 * 1024);
    if (text) {
      const state = JSON.parse(text);
      if ([...Object.keys(state.projects ?? {}), ...Object.keys(state.projectNames ?? {})].some(path => samePath(path, real))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
