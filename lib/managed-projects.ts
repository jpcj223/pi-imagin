import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "./agent-dir";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { readRegularFileText } from "./regular-file";
import { serializeByKey } from "./key-serializer";
import { hasParentDirectorySegment, isPathWithinRoots } from "./path-security";
import { projectIdentityKey } from "./project-identity";
import { resolveProject } from "./worktree";
import { emptyManagedProjects, projectExecutionFolders, type ManagedProjectState, type ProjectChange, type ProjectSessionScope } from "./managed-projects-shared";

const QUEUE = Symbol.for("pi-imagin:managed-project-writes");
const MAX_BYTES = 4 * 1024 * 1024;
export class ProjectStateError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
/** 区分真正的范围拒绝与路径格式、文件缺失等可纠正输入错误。 */
export class ProjectScopeAccessError extends ProjectStateError {
  constructor(message: string) { super(message, 403); }
}
export function managedProjectPath(): string { return join(getAgentDir(), "pi-imagin-projects.json"); }

// 只从项目身份推导私有路径，不接受前端指定内部工作区或共享父目录。
function projectWorkspacePath(id: string, file: string): string {
  return join(realpathSync(dirname(file)), "project-workspaces", createHash("sha256").update(id).digest("hex"));
}

/** 损坏或未知版本不覆盖；项目元数据不能按临时缓存重建。 */
export function readManagedProjects(file = managedProjectPath()): ManagedProjectState {
  const text = readRegularFileText(file, MAX_BYTES);
  if (text === undefined) return emptyManagedProjects();
  const state = JSON.parse(text) as ManagedProjectState;
  const validFolder = (folder: unknown): boolean => {
    if (!folder || typeof folder !== "object") return false;
    const f = folder as { id?: unknown; name?: unknown; path?: unknown };
    return typeof f.id === "string" && typeof f.name === "string" && typeof f.path === "string" && isAbsolute(f.path);
  };
  if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.projects)
    || !state.sessions || typeof state.sessions !== "object" || Array.isArray(state.sessions)
    || state.projects.some(p => !p || typeof p.id !== "string" || typeof p.name !== "string" || !Number.isSafeInteger(p.revision) || !Array.isArray(p.folders) || !p.folders.every(validFolder)
      || (p.workspace !== undefined && (!validFolder(p.workspace) || p.workspace.id !== "workspace" || typeof p.workspace.initialized !== "boolean" || p.workspace.path !== projectWorkspacePath(p.id, file)))
      || (p.folders.length ? !p.folders.some(f => f.id === p.defaultFolderId) : !p.workspace || p.defaultFolderId !== p.workspace.id))
    || Object.entries(state.sessions).some(([id, scope]) => ["__proto__", "constructor", "prototype"].includes(id) || !scope || typeof scope.projectId !== "string" || typeof scope.projectName !== "string" || typeof scope.cwd !== "string" || !isAbsolute(scope.cwd) || !Array.isArray(scope.folders) || !scope.folders.length || !scope.folders.every(validFolder)
      || (scope.worktreeRoot !== undefined && (typeof scope.worktreeRoot !== "string" || !isAbsolute(scope.worktreeRoot)))
      || (scope.isolatedWorktree !== undefined && typeof scope.isolatedWorktree !== "boolean"))
    || (state.removedRoots !== undefined && (!Array.isArray(state.removedRoots) || !state.removedRoots.every(root => typeof root === "string")))) {
    throw new ProjectStateError("项目数据格式无法读取，请保留原文件后检查。", 500);
  }
  return state;
}

export function canonicalProjectFolder(path: string): string {
  if (typeof path !== "string" || path.length > 4096 || !isAbsolute(path) || hasParentDirectorySegment(path)) {
    throw new ProjectStateError("请选择完整目录路径，不能包含上级目录跳转。");
  }
  try {
    const canonical = realpathSync(path);
    if (!statSync(canonical).isDirectory()) throw new Error();
    return canonical;
  } catch { throw new ProjectStateError(`目录不存在或无法访问：${path}`); }
}

function title(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProjectStateError(`${label}需为 1–80 字的单行文字。`);
  }
  return value.trim();
}

async function edit<T>(file: string, update: (state: ManagedProjectState) => T): Promise<T> {
  return serializeByKey(QUEUE, file, async () => {
    mkdirSync(dirname(file), { recursive: true });
    const release = await lockfile.lock(file, { realpath: false, stale: 10_000,
      retries: { retries: 8, minTimeout: 25, maxTimeout: 300 },
      onCompromised: error => console.error("[pi-imagin] 项目数据锁失效", error.message) });
    try {
      const state = readManagedProjects(file);
      const result = update(state);
      state.revision++;
      const text = JSON.stringify(state, null, 2) + "\n";
      if (Buffer.byteLength(text) > MAX_BYTES) throw new ProjectStateError("项目元数据已达到容量上限。", 409);
      writePrivateFileAtomicSync(file, text);
      return result;
    } finally { await release(); }
  });
}

export async function changeManagedProject(change: ProjectChange, file = managedProjectPath()): Promise<ManagedProjectState> {
  await edit(file, state => {
    if (!change || typeof change !== "object") throw new ProjectStateError("无效的项目请求。");
    const existing = "id" in change && change.id ? state.projects.find(p => p.id === change.id) : undefined;
    if (("id" in change && change.id) && !existing) throw new ProjectStateError("项目已不存在，请刷新列表。", 404);
    if (existing && change.revision !== existing.revision) throw new ProjectStateError("项目已被另一个窗口更新，请重新打开后编辑。", 409);
    if (change.action === "remove") {
      state.removedRoots = [...new Set([...(state.removedRoots ?? []), ...projectExecutionFolders(existing!).map(f => f.path)])].slice(-4096);
      state.projects = state.projects.filter(p => p.id !== change.id);
      // 会话快照仍保留：移除展示关系不改变历史会话的执行目录与运行权限。
      return;
    }
    if (change.action !== "save") throw new ProjectStateError("未知项目操作。");
    const rawName = change.name;
    if (!Array.isArray(change.folders) || change.folders.length > 16) throw new ProjectStateError("每个项目最多关联 16 个文件夹。");
    if (!existing && state.projects.length >= 1000) throw new ProjectStateError("项目数量已达到上限。", 409);
    const folders = change.folders.map(folder => {
      const path = canonicalProjectFolder(folder?.path);
      const previous = existing?.folders.find(f => projectIdentityKey(f.path) === projectIdentityKey(path));
      return { id: previous?.id ?? randomUUID(), name: title(typeof folder.name === "string" && !folder.name.trim() || folder.name == null ? (basename(path) || path) : folder.name, "文件夹名称"), path };
    });
    const name = title(typeof rawName === "string" && !rawName.trim() && folders.length ? (basename(folders.find(folder => folder.path === change.defaultPath)?.path || folders[0].path) || folders[0].path) : rawName, "项目名称");
    if (new Set(folders.map(f => projectIdentityKey(f.path))).size !== folders.length) throw new ProjectStateError("不能重复关联同一个真实目录。");
    const id = existing?.id ?? randomUUID();
    const workspace = existing?.workspace ?? (!folders.length ? { id: "workspace", name: "项目工作区", path: projectWorkspacePath(id, file), initialized: false } : undefined);
    if (workspace && folders.some(folder => isPathWithinRoots(folder.path, new Set([workspace.path])) || isPathWithinRoots(workspace.path, new Set([folder.path])))) throw new ProjectStateError("项目工作区无需重复关联，也不能关联它的父目录。");
    for (const other of state.projects.filter(p => p.id !== existing?.id)) {
      if ([...folders, ...(workspace ? [workspace] : [])].some(f => projectExecutionFolders(other).some(o => isPathWithinRoots(f.path, new Set([o.path])) || isPathWithinRoots(o.path, new Set([f.path]))))) {
        throw new ProjectStateError(`目录已属于项目“${other.name}”，请先解除原有关联。`, 409);
      }
    }
    // 旧客户端仍可提交 defaultPath；新客户端不需要配置，重排保留既有资源定位。
    const previousStart = folders.find(folder => folder.id === existing?.defaultFolderId);
    const defaultPath = folders.length ? (change.defaultPath ? canonicalProjectFolder(change.defaultPath) : (previousStart ?? folders[0]).path) : workspace!.path;
    const defaultFolder = folders.length ? folders.find(f => projectIdentityKey(f.path) === projectIdentityKey(defaultPath)) : workspace;
    if (!defaultFolder) throw new ProjectStateError("默认目录必须来自关联文件夹。");
    const project = { id, revision: (existing?.revision ?? 0) + 1, name, folders, defaultFolderId: defaultFolder.id, ...(workspace ? { workspace } : {}) };
    state.projects = existing ? state.projects.map(p => p.id === existing.id ? project : p) : [...state.projects, project];
    state.removedRoots = state.removedRoots?.filter(root => !folders.some(f => projectIdentityKey(f.path) === projectIdentityKey(root)));
  });
  const saved = readManagedProjects(file);
  // 已有会话解除最后一个关联目录后可继续使用原项目，无需重建会话。
  if (change.action === "save" && change.id) {
    const project = saved.projects.find(item => item.id === change.id);
    if (project && !project.folders.length && project.workspace && !project.workspace.initialized
      && Object.values(saved.sessions).some(scope => scope.projectId === project.id)) {
      await prepareProjectWorkspace(project.id, project.workspace.path, file);
      return readManagedProjects(file);
    }
  }
  return saved;
}

/** 首次选择或执行时准备工作区；已使用后若被移走或改成链接，拒绝静默重建。 */
export async function prepareProjectWorkspace(projectId: string, cwd: string, file = managedProjectPath()): Promise<void> {
  const project = readManagedProjects(file).projects.find(item => item.id === projectId);
  if (!project) throw new ProjectStateError("所选项目不存在。", 404);
  const workspace = project.workspace;
  if (!workspace || projectIdentityKey(cwd) !== projectIdentityKey(workspace.path)) return;
  if (workspace.initialized) {
    if (projectIdentityKey(canonicalProjectFolder(workspace.path)) !== projectIdentityKey(workspace.path)) throw new ProjectStateError("项目工作区已改变，请检查原目录。", 409);
    return;
  }
  await edit(file, state => {
    const latest = state.projects.find(item => item.id === projectId)?.workspace;
    if (!latest) throw new ProjectStateError("项目已更新，请重新选择。", 409);
    if (!latest.initialized) {
      const parent = dirname(latest.path);
      mkdirSync(parent, { recursive: true });
      if (projectIdentityKey(realpathSync(parent)) !== projectIdentityKey(parent)) throw new ProjectStateError("项目工作区父目录已改变。", 409);
      mkdirSync(latest.path, { recursive: true });
    }
    if (projectIdentityKey(canonicalProjectFolder(latest.path)) !== projectIdentityKey(latest.path)) throw new ProjectStateError("项目工作区已改变，请检查原目录。", 409);
    latest.initialized = true;
  });
}

/** 持久化会话所属项目和历史起点；当前执行范围由 resolveCurrentProjectScope 获取。 */
export async function bindProjectSession(sessionId: string, cwd: string, projectId?: string, file = managedProjectPath()): Promise<ProjectSessionScope | undefined> {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(sessionId) || ["__proto__", "constructor", "prototype"].includes(sessionId)) throw new ProjectStateError("无效的会话身份。");
  const current = readManagedProjects(file);
  if (Object.hasOwn(current.sessions, sessionId)) {
    if (projectId && current.sessions[sessionId].projectId !== projectId) throw new ProjectStateError("已有会话不能更换项目身份。", 409);
    let binding = current.sessions[sessionId];
    if (!binding.worktreeRoot && binding.folders.some(folder => folder.name === "当前工作树" && projectIdentityKey(folder.path) === projectIdentityKey(binding.cwd))) {
      const info = await resolveProject(binding.cwd);
      if (info.isWorktree) binding = { ...binding, worktreeRoot: info.projectRoot };
    }
    return resolveCurrentProjectScope(binding, file);
  }
  if (!projectId && !current.projects.length) return undefined;
  const owner = projectId ?? current.projects.find(project => project.workspace && projectIdentityKey(project.workspace.path) === projectIdentityKey(cwd))?.id;
  if (owner) {
    const workspace = current.projects.find(project => project.id === owner)?.workspace;
    await prepareProjectWorkspace(owner, workspace?.path ?? cwd, file);
  }
  const canonicalCwd = canonicalProjectFolder(cwd);
  let project = projectId ? current.projects.find(p => p.id === projectId)
    : current.projects.find(p => isPathWithinRoots(canonicalCwd, new Set(projectExecutionFolders(p).map(f => f.path))));
  if (projectId && !project) throw new ProjectStateError("所选项目不存在。", 404);
  let worktreeRoot: string | undefined;
  if (!project || !isPathWithinRoots(canonicalCwd, new Set(projectExecutionFolders(project).map(f => f.path)))) {
    const info = await resolveProject(canonicalCwd);
    if (info.isWorktree) {
      worktreeRoot = canonicalProjectFolder(info.projectRoot);
      project ??= current.projects.find(p => isPathWithinRoots(worktreeRoot!, new Set(projectExecutionFolders(p).map(f => f.path))));
    }
  }
  if (!project) {
    if (projectId) throw new ProjectStateError("所选项目不存在。", 404);
    return undefined;
  }
  return edit(file, state => {
    if (Object.hasOwn(state.sessions, sessionId)) return structuredClone(state.sessions[sessionId]);
    const latest = state.projects.find(p => p.id === project.id);
    if (!latest) throw new ProjectStateError("项目已移除，请重新选择。", 409);
    // 再次解析所有目录，拒绝目录链接在选择与启动之间改指向别处。
    for (const folder of projectExecutionFolders(latest)) {
      if (projectIdentityKey(canonicalProjectFolder(folder.path)) !== projectIdentityKey(folder.path)) throw new ProjectStateError("关联目录已改变，请重新编辑项目。", 409);
    }
    const projectRoots = new Set(projectExecutionFolders(latest).map(f => f.path));
    const inRoots = isPathWithinRoots(canonicalCwd, projectRoots);
    if (!inRoots && (!worktreeRoot || !isPathWithinRoots(worktreeRoot, projectRoots))) throw new ProjectStateError("会话工作目录不属于所选项目。", 403);
    const folders = structuredClone(projectExecutionFolders(latest));
    // linked worktree 仍属于原仓库，但只补入本会话实际选择的工作树，不开放其父目录。
    if (!inRoots) folders.push({ id: randomUUID(), name: "当前工作树", path: canonicalCwd });
    const snapshot = { projectId: latest.id, projectName: latest.name, cwd: canonicalCwd, folders, projectRevision: latest.revision, ...(!inRoots && worktreeRoot ? { worktreeRoot } : {}) };
    state.sessions[sessionId] = snapshot;
    return structuredClone(snapshot);
  });
}

/** 目录更新只影响执行范围，不更换 SDK cwd、项目配置或历史会话位置。 */
export function resolveCurrentProjectScope(binding: ProjectSessionScope, file = managedProjectPath(), state?: ManagedProjectState): ProjectSessionScope {
  const project = (state ?? readManagedProjects(file)).projects.find(item => item.id === binding.projectId);
  // 已移除整个项目的历史会话沿用既有兼容语义，不根据路径转移到其他项目。
  if (!project) return structuredClone(binding);
  let folders = structuredClone(projectExecutionFolders(project));
  // 兼容旧版已登记的 linked worktree；解除原仓库关联后不继续授权工作树。
  const legacyWorktree = binding.folders.find(folder => folder.name === "当前工作树" && projectIdentityKey(folder.path) === projectIdentityKey(binding.cwd));
  const source = binding.worktreeRoot;
  if (source && folders.some(folder => isPathWithinRoots(source, new Set([folder.path])))) {
    if (binding.isolatedWorktree) folders = folders.filter(folder => !isPathWithinRoots(source, new Set([folder.path])));
    folders.push({ id: legacyWorktree?.id ?? "session-worktree", name: "当前工作树", path: binding.cwd });
  }
  return { ...binding, projectName: project.name, folders, projectRevision: project.revision };
}

/** 失效根仅供模型定位时知情，不阻止其他有效根的操作。 */
export function unavailableProjectFolders(scope: ProjectSessionScope): { path: string; reason: string }[] {
  return scope.folders.flatMap(folder => {
    try {
      if (projectIdentityKey(canonicalProjectFolder(folder.path)) !== projectIdentityKey(folder.path)) throw new ProjectStateError("关联目录真实位置已改变。");
      return [];
    } catch (error) { return [{ path: folder.path, reason: error instanceof Error ? error.message : "目录不可用" }]; }
  });
}

/** 快照根必须仍然存在且指向原位置，不能把已删除的根当成待创建子目录。 */
export function assertProjectScopeDirectories(scope: ProjectSessionScope): void {
  for (const folder of scope.folders) {
    if (projectIdentityKey(canonicalProjectFolder(folder.path)) !== projectIdentityKey(folder.path)) {
      throw new ProjectStateError(`关联目录已改变，请检查：${folder.path}`, 409);
    }
  }
}

/** 新文件的父路径也必须在快照范围内，链接不能扩大项目权限。 */
export function resolveProjectToolPath(scope: ProjectSessionScope, candidate: string): string {
  // SDK 还支持 ~、@、file URL 和类 Unix 盘符等语法。项目边界仅接收标准路径，
  // 避免校验路径与 SDK 再次展开后的执行路径不一致。
  if (/^(?:~|@|file:)/i.test(candidate) || /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/.test(candidate)
    || (process.platform === "win32" && /^\/(?:mnt\/|cygdrive\/)?[a-z](?:\/|$)/i.test(candidate))) {
    throw new ProjectStateError("项目工具请使用标准绝对路径或工作目录相对路径。", 403);
  }
  if (hasParentDirectorySegment(candidate)) throw new ProjectStateError("项目路径不能包含上级目录跳转。", 403);
  if (!isAbsolute(candidate)) throw new ProjectStateError("项目操作必须明确完整绝对路径，不能回退到会话启动目录。", 403);
  const absolute = resolve(scope.cwd, candidate);
  const owners = scope.folders.filter(folder => isPathWithinRoots(absolute, new Set([folder.path])));
  if (!owners.length) throw new ProjectScopeAccessError("目标路径不在此会话当前的项目文件夹范围内。");
  assertProjectScopeDirectories({ ...scope, folders: owners });
  let parent = absolute;
  const suffix: string[] = [];
  while (true) {
    try { parent = realpathSync(parent); break; }
    catch {
      const next = dirname(parent);
      if (next === parent) throw new ProjectStateError("无法解析目标路径。", 403);
      suffix.unshift(basename(parent)); parent = next;
    }
  }
  const resolved = join(parent, ...suffix);
  if (!isPathWithinRoots(resolved, new Set(scope.folders.map(f => f.path)))) throw new ProjectScopeAccessError("目标路径不在此会话的项目文件夹范围内。");
  return resolved;
}

export async function inheritProjectSession(sourceId: string, targetId: string, file = managedProjectPath(), inherited?: ProjectSessionScope): Promise<void> {
  const sessions = readManagedProjects(file).sessions;
  const scope = inherited ?? (Object.hasOwn(sessions, sourceId) ? sessions[sourceId] : undefined);
  if (!scope) return;
  await edit(file, state => { state.sessions[targetId] ??= structuredClone(scope); });
}

export async function forgetProjectSessions(ids: Iterable<string>, file = managedProjectPath()): Promise<void> {
  const wanted = [...ids];
  if (!wanted.some(id => Object.hasOwn(readManagedProjects(file).sessions, id))) return;
  await edit(file, state => { for (const id of wanted) delete state.sessions[id]; });
}
