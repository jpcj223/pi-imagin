import { createProjectSessionResolver, defaultProjectFolder, projectContainsCwd, type ManagedProject } from "./managed-projects-shared";
import type { NewSessionContext, NewSessionTarget } from "./new-session-context";

export interface NewSessionProjectOption { key: string; name: string; note?: string; target: NewSessionTarget }

/** 已登记项目按身份列出一次；旧项目保留，但已归属项目的文件夹不再单独冒充项目。 */
export function newSessionProjectOptions(context: NewSessionContext): NewSessionProjectOption[] {
  const projects = context.managedProjects ?? [];
  const resolver = createProjectSessionResolver({ version: 1, revision: 0, projects, sessions: {} });
  const result: NewSessionProjectOption[] = [];
  for (const project of projects) {
    const folder = defaultProjectFolder(project);
    if (folder) result.push({ key: `managed:${project.id}`, name: project.name,
      note: project.folders.length ? `${project.folders.length} 个文件夹` : "未关联文件夹", target: { cwd: folder.path, managedProjectId: project.id } });
  }
  const seen = new Set<string>();
  const legacyChoices = !context.defaultWorkspace && !context.managedProjectId && !context.projects.some(project => project.key === context.project.key)
    ? [context.project, ...context.projects] : context.projects;
  for (const project of legacyChoices) {
    if (seen.has(project.key) || resolver.byPath(project.root)) continue;
    seen.add(project.key);
    result.push({ key: project.key, name: project.alias ?? project.root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? project.root,
      target: { cwd: project.root, projectKey: project.key, projectRoot: project.root } });
  }
  return result;
}

const STORAGE_KEY = "pi-imagin:last-new-session-project";
export interface RememberedNewSessionProject { projectId: string; cwd: string }
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function loadNewSessionProject(storage: StorageLike | null = browserStorage()): RememberedNewSessionProject | null {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
    return value && typeof value.projectId === "string" && typeof value.cwd === "string" && value.cwd.trim()
      ? { projectId: value.projectId, cwd: value.cwd } : null;
  } catch { return null; }
}

export function rememberNewSessionProject(value: RememberedNewSessionProject, storage: StorageLike | null = browserStorage()): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* 浏览器禁用存储时，当前项目仍然可用。 */ }
}

/** 只确定候选项，实际路径和项目范围仍由原有服务端入口重新校验。 */
export function preferredNewSessionProject(
  projects: ManagedProject[], currentCwd: string | null, currentProjectId: string | null,
  remembered: RememberedNewSessionProject | null,
): NewSessionTarget | null {
  const current = currentProjectId ? projects.find(project => project.id === currentProjectId)
    : currentCwd ? createProjectSessionResolver({ version: 1, revision: 0, projects, sessions: {} }).byPath(currentCwd) : undefined;
  if (current && currentCwd) return { cwd: currentCwd, managedProjectId: current.id };
  const previous = remembered && projects.find(project => project.id === remembered.projectId);
  const chosen = previous || (projects.length === 1 ? projects[0] : undefined);
  if (!chosen) return null;
  const defaultFolder = defaultProjectFolder(chosen);
  if (!defaultFolder) return null;
  // 已移除的关联目录不从记忆中复活；项目仍在时退回它当前的默认目录。
  const cwd = previous && remembered && projectContainsCwd(chosen, remembered.cwd) ? remembered.cwd : defaultFolder.path;
  return { cwd, managedProjectId: chosen.id };
}
