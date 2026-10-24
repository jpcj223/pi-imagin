import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { runNpx } from "./npx";
import { updateGlobalSettings } from "./global-settings-file";
import type { SkillInstallScope } from "./api-types";

/** 各任务在独立目录下载；只在发布文件和合并安装记录时短暂持锁。 */
export async function installSkillPackage(pkg: string, scope: SkillInstallScope, cwd?: string, run = runNpx, options: { replace?: boolean; args?: string[] } = {}) {
  const stage = mkdtempSync(join(tmpdir(), "pi-skill-install-"));
  const destination = scope === "global" ? getAgentDir() : join(cwd!, ".pi");
  const lockPath = scope === "global" ? join(destination, "skills-lock.json") : join(cwd!, "skills-lock.json");
  try {
    const result = await run(options.args ?? ["skills", "add", pkg, "-y", "--agent", "pi", "--copy"], {
      cwd: stage, timeout: 180_000, env: { ...process.env, FORCE_COLOR: "0" },
    });
    // 新版 CLI 的 Pi 目标是 .agents/skills，兼容旧版 .pi/skills。
    const root = existsSync(join(stage, ".agents", "skills")) ? join(stage, ".agents", "skills") : join(stage, ".pi", "skills");
    const names = existsSync(root) ? readdirSync(root).filter(name => existsSync(join(root, name, "SKILL.md"))) : [];
    if (!names.length) throw new Error("The installer did not produce any Pi skills");
    const stagedLock = join(stage, "skills-lock.json");
    const entries = existsSync(stagedLock) ? JSON.parse(readFileSync(stagedLock, "utf8")).skills ?? {} : {};
    const published: string[] = [];
    const backups = new Map<string, string>();
    let committed = false;
    try { await updateGlobalSettings(lockPath, settings => {
      mkdirSync(join(destination, "skills"), { recursive: true });
      const recorded = (settings.skills ?? {}) as Record<string, unknown>;
      for (const name of names) {
        if (!options.replace && existsSync(join(destination, "skills", name))) throw new Error(`Skill already exists: ${name}`);
      }
      for (const name of names) {
        const target = join(destination, "skills", name);
        // 临时副本与目标同盘，发布失败不影响其余安装任务。
        const incoming = mkdtempSync(join(destination, "skills", ".install-"));
        try {
          cpSync(join(root, name), incoming, { recursive: true, dereference: true });
          if (existsSync(target)) {
            if (!options.replace) throw new Error(`Skill already exists: ${name}`);
            const backup = mkdtempSync(join(destination, ".skill-backup-"));
            const saved = join(backup, name);
            renameSync(target, saved); backups.set(target, saved);
          }
          renameSync(incoming, target);
          published.push(target);
          recorded[name] = { ...(entries[name] ?? { source: pkg.split("@")[0], sourceType: "github" }), piImaginInstalled: true };
        } finally {
          if (existsSync(incoming)) rmSync(incoming, { recursive: true, force: true });
        }
      }
      settings.version = 1;
      settings.skills = recorded;
    }); committed = true; } catch (error) {
      for (const target of published) rmSync(target, { recursive: true, force: true });
      for (const [target, backup] of backups) renameSync(backup, target);
      throw error;
    } finally {
      // 恢复失败时保留备份供恢复，绝不能在 finally 中清掉唯一的旧副本。
      for (const backup of backups.values()) {
        if (committed || !existsSync(backup)) rmSync(join(backup, ".."), { recursive: true, force: true });
      }
    }
    return { ...result, names };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
