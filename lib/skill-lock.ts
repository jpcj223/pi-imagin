import { existsSync, lstatSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, relative, resolve, sep } from "path";
import type { SkillInfo, SkillInstallInfo, SkillInstallScope } from "@/lib/api-types";
import { cliGlobalSkillsRoot } from "./skill-locations";
import { defaultCwdParent } from "./default-cwd";

interface SkillLockEntry {
  piImaginInstalled?: unknown;
  source?: unknown;
  sourceType?: unknown;
  skillPath?: unknown;
  ref?: unknown;
  skillFolderHash?: unknown;
  computedHash?: unknown;
}

interface SkillLockFile {
  skills?: Record<string, SkillLockEntry>;
}

interface GlobalLockPathOptions {
  homeDir?: string;
  xdgStateHome?: string;
}

interface AnnotateSkillOptions {
  cwd: string;
  agentDir: string;
  globalLockPath?: string;
  projectLockPath?: string;
  legacyWorkspaceRoot?: string;
  globalSkillRoots?: string[];
}

export function getGlobalSkillsLockPath({
  homeDir = homedir(),
  xdgStateHome = process.env.XDG_STATE_HOME,
}: GlobalLockPathOptions = {}): string {
  return xdgStateHome
    ? join(xdgStateHome, "skills", ".skill-lock.json")
    : join(homeDir, ".agents", ".skill-lock.json");
}

function readSkillLock(path: string): Record<string, SkillLockEntry> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SkillLockFile;
    return parsed.skills && typeof parsed.skills === "object" ? parsed.skills : {};
  } catch {
    return {};
  }
}

function isWithin(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function findLockEntry(
  entries: Record<string, SkillLockEntry>,
  skillName: string,
): SkillLockEntry | undefined {
  if (entries[skillName]) return entries[skillName];
  const normalizedName = skillName.toLowerCase();
  const key = Object.keys(entries).find((name) => name.toLowerCase() === normalizedName);
  return key ? entries[key] : undefined;
}

function normalizeSource(source: string, sourceType?: string): string {
  if (sourceType !== "github") return source.replace(/\/$/, "");
  return source
    .replace(/^git\+/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

function buildSkillsShUrl(source: string, skillName: string): string | undefined {
  if (!source || source.includes("://") || source.startsWith("git@")) return undefined;
  const sourcePath = source
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  if (!sourcePath) return undefined;
  return `https://skills.sh/${sourcePath}/${encodeURIComponent(skillName)}`;
}

function getInstallInfo(
  entries: Record<string, SkillLockEntry>,
  skillName: string,
  scope: SkillInstallScope,
): SkillInstallInfo | undefined {
  const entry = findLockEntry(entries, skillName);
  if (!entry || typeof entry.source !== "string" || !entry.source.trim()) return undefined;

  const sourceType = typeof entry.sourceType === "string" ? entry.sourceType : undefined;
  const source = normalizeSource(entry.source.trim(), sourceType);
  if (!source) return undefined;
  const skillPath = typeof entry.skillPath === "string" ? entry.skillPath : undefined;
  const ref = typeof entry.ref === "string" ? entry.ref : undefined;
  const rawVersionHash = scope === "global" ? entry.skillFolderHash : entry.computedHash;
  const versionHash = typeof rawVersionHash === "string" && rawVersionHash
    ? rawVersionHash
    : undefined;
  const isGitHubSource =
    sourceType === "github" && /^[\w.-]+\/[\w.-]+$/.test(source);
  const hasComparableVersion = scope === "global" || !ref;

  return {
    package: `${source}@${skillName}`,
    scope,
    source,
    sourceType,
    skillsShUrl: sourceType === "local" ? undefined : buildSkillsShUrl(source, skillName),
    ...(skillPath && { skillPath }),
    ...(ref && { ref }),
    ...(versionHash && { versionHash }),
    canCheckForUpdates: Boolean(
      isGitHubSource && skillPath && versionHash && hasComparableVersion,
    ),
  };
}

export function annotateSkillsWithInstallInfo(
  skills: SkillInfo[],
  {
    cwd,
    agentDir,
    globalLockPath = getGlobalSkillsLockPath(),
    projectLockPath = join(cwd, "skills-lock.json"),
    legacyWorkspaceRoot = defaultCwdParent(),
    globalSkillRoots = [cliGlobalSkillsRoot(), join(homedir(), ".agents", "skills")],
  }: AnnotateSkillOptions,
): SkillInfo[] {
  const globalEntries = readSkillLock(globalLockPath);
  const appLockEntries = readSkillLock(join(agentDir, "skills-lock.json"));
  const appEntries = { ...globalEntries, ...appLockEntries };
  const projectEntries = readSkillLock(projectLockPath);
  const globalSkillsRoot = join(agentDir, "skills");
  const projectSkillsRoot = join(cwd, ".pi", "skills");
  // 旧版应用调用全局 CLI，却将来源锁保存在应用日期工作区。
  // 只读已知日期目录，必须同时匹配来源、文档路径与版本哈希，不能靠同名归类。
  const legacyLocks: Record<string, SkillLockEntry>[] = [];
  if (skills.some(skill => globalSkillRoots.some(root => isWithin(skill.filePath, root)))) {
    try {
      for (const directory of readdirSync(legacyWorkspaceRoot, { withFileTypes: true })) {
        if (!directory.isDirectory() || !/^\d{8}$/.test(directory.name)) continue;
        const lock = join(legacyWorkspaceRoot, directory.name, "skills-lock.json");
        if (existsSync(lock) && lstatSync(lock).isFile()) legacyLocks.push(readSkillLock(lock));
      }
    } catch { /* 无旧工作区时不影响正常发现。 */ }
  }

  return skills.map((skill) => {
    if (!existsSync(skill.filePath)) return skill;

    const install = isWithin(skill.filePath, globalSkillsRoot)
      ? getInstallInfo(appEntries, skill.name, "global")
      : globalSkillRoots.some(root => isWithin(skill.filePath, root))
        ? getInstallInfo(globalEntries, skill.name, "global")
      : isWithin(skill.filePath, projectSkillsRoot)
        ? getInstallInfo(projectEntries, skill.name, "project")
        : undefined;

    const globalEntry = findLockEntry(globalEntries, skill.name);
    const legacyRecorded = globalSkillRoots.some(root => {
      const parts = relative(root, skill.filePath).split(sep);
      return parts.length === 2 && parts[1] === "SKILL.md" && parts[0].toLowerCase() === skill.name.toLowerCase();
    }) && globalEntry && legacyLocks.some(entries => {
      const entry = findLockEntry(entries, skill.name);
      return entry && typeof globalEntry.skillFolderHash === "string" && globalEntry.skillFolderHash.length > 0
        && entry.computedHash === globalEntry.skillFolderHash
        && typeof entry.skillPath === "string" && entry.skillPath === globalEntry.skillPath
        && typeof entry.source === "string" && typeof globalEntry.source === "string"
        && normalizeSource(entry.source, String(entry.sourceType)) === normalizeSource(globalEntry.source, String(globalEntry.sourceType));
    });
    const appRecorded = legacyRecorded || isWithin(skill.filePath, globalSkillsRoot) && Boolean(findLockEntry(appLockEntries, skill.name))
      || isWithin(skill.filePath, projectSkillsRoot) && findLockEntry(projectEntries, skill.name)?.piImaginInstalled === true;
    return { ...skill, ...(install ? { install } : {}), installOrigin: appRecorded ? "app" : "external" };
  });
}
