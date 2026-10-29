import { createProjectSessionResolver, defaultProjectFolder, projectContainsCwd, type ManagedProject } from "./managed-projects-shared";
import type { NewSessionContext, NewSessionTarget } from "./new-session-context";

export interface NewSessionProjectOption { key: string; name: string; folderCount: number; target: NewSessionTarget }

/** 新会话只选择正式项目；历史会话的 cwd 仍保留，但不能因此成为项目选项。 */
export function newSessionProjectOptions(context: NewSessionContext): NewSessionProjectOption[] {
  const projects = context.managedProjects ?? [];
  const result: NewSessionProjectOption[] = [];
  for (const project of projects) {
    const folder = defaultProjectFolder(project);
    if (folder) result.push({ key: `managed:${project.id}`, name: project.name,
      // 返回结构数据，由界面按当前语言显示，避免纯逻辑层写死中文说明。
      folderCount: project.folders.length, target: { cwd: folder.path, managedProjectId: project.id } });
  }
  // context.projects 含从历史会话收集的目录，供旧会话及文件浏览兼容使用。
  // 不在此拼接它，也不注入当前未登记目录；加载中或无正式项目时保持空列表。
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
  currentWorktreeRoot?: string,
): NewSessionTarget | null {
  const current = currentProjectId ? projects.find(project => project.id === currentProjectId)
    : currentCwd ? createProjectSessionResolver({ version: 1, revision: 0, projects, sessions: {} }).byPath(currentCwd) : undefined;
  if (current && currentCwd) return { cwd: projectContainsCwd(current, currentCwd) || (currentWorktreeRoot && projectContainsCwd(current, currentWorktreeRoot)) ? currentCwd : defaultProjectFolder(current)!.path, managedProjectId: current.id };
  const previous = remembered && projects.find(project => project.id === remembered.projectId);
  const chosen = previous || (projects.length === 1 ? projects[0] : undefined);
  if (!chosen) return null;
  const defaultFolder = defaultProjectFolder(chosen);
  if (!defaultFolder) return null;
  // 已移除的关联目录不从记忆中复活；项目仍在时退回它当前的默认目录。
  const cwd = previous && remembered && projectContainsCwd(chosen, remembered.cwd) ? remembered.cwd : defaultFolder.path;
  return { cwd, managedProjectId: chosen.id };
}
