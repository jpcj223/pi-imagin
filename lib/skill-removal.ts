import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SkillInfo } from "./api-types";
import { cliGlobalSkillsRoot } from "./skill-locations";
import { getGlobalSkillsLockPath } from "./skill-lock";
import { updateGlobalSettings } from "./global-settings-file";

/** 只能删除技能根的直属文件／技能目录，不把包资源目录当成独立技能目录。 */
export function skillRemovalTarget(skill: SkillInfo, agentDir: string, cwd?: string | null): string | null {
  const roots = [join(agentDir, "skills"), cliGlobalSkillsRoot(), join(homedir(), ".agents", "skills"),
    ...(cwd ? [join(cwd, ".pi", "skills"), join(cwd, ".agents", "skills")] : [])];
  const source = skill.sourceInfo?.source;
  if (skill.sourceInfo?.origin === "package" || (source && !["auto", "user", "project", "path"].includes(source))) return null;
  const file = resolve(skill.filePath);
  for (const root of roots) {
    const rel = relative(resolve(root), file);
    if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) continue;
    const parts = rel.split(sep);
    if (parts.length === 1 && file.toLowerCase().endsWith(".md")) return file;
    if (parts.length === 2 && parts[1] === "SKILL.md") return dirname(file);
  }
  return null;
}

export function removeSkillFiles(skill: SkillInfo, agentDir: string, cwd?: string | null): void {
  const target = skillRemovalTarget(skill, agentDir, cwd);
  if (!target) throw new Error("Manage this skill through its owning plugin or source directory");
  // 删除前重新校验父目录，不能经伪造的中间链接跨出已知技能根。
  const parent = dirname(target);
  if (resolve(realpathSync(parent)).toLowerCase() !== resolve(parent).toLowerCase()) {
    throw new Error("The skill root is a link; remove it through its source directory");
  }
  const stat = lstatSync(target);
  rmSync(target, { recursive: stat.isDirectory() && !stat.isSymbolicLink(), force: false });
}

/** 删除实际安装时同步移除对应记录，项目恢复安装不能把已删除技能装回来。 */
export async function removeSkillInstallation(skill: SkillInfo, agentDir: string, cwd?: string | null): Promise<void> {
  const within = (root: string) => {
    const rel = relative(resolve(root), resolve(skill.filePath));
    return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  const record = within(join(agentDir, "skills")) ? join(agentDir, "skills-lock.json")
    : cwd && (within(join(cwd, ".pi", "skills")) || within(join(cwd, ".agents", "skills"))) ? join(cwd, "skills-lock.json")
      : within(join(homedir(), ".agents", "skills")) ? getGlobalSkillsLockPath() : undefined;
  if (!record || !existsSync(record)) { removeSkillFiles(skill, agentDir, cwd); return; }
  await updateGlobalSettings(record, settings => {
    removeSkillFiles(skill, agentDir, cwd);
    if (settings.skills && typeof settings.skills === "object" && !Array.isArray(settings.skills)) {
      const entries = settings.skills as Record<string, unknown>;
      for (const name of Object.keys(entries)) if (name.toLowerCase() === skill.name.toLowerCase()) delete entries[name];
    }
  });
}
