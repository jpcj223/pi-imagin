import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** skills CLI 使用固定的 Pi 目录；桌面开发的 agentDir 则可能在应用数据中。 */
export function cliGlobalSkillsRoot(home = homedir()): string {
  return join(home, ".pi", "agent", "skills");
}

export function additionalGlobalSkillPaths(agentDir: string): string[] {
  const root = cliGlobalSkillsRoot();
  return resolve(root) !== resolve(join(agentDir, "skills")) && existsSync(root) ? [root] : [];
}

/** 范围依据已知安装根判断，不通过名称或当前打开的目录推断。 */
export function globalSkillRoots(agentDir: string): string[] {
  return [join(agentDir, "skills"), cliGlobalSkillsRoot(), join(homedir(), ".agents", "skills")];
}
