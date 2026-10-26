/** 项目身份独立于路径；历史目录记录不冻结项目当前的关联范围。 */
export interface ProjectFolder { id: string; name: string; path: string }
export interface ManagedProject {
  id: string;
  name: string;
  revision: number;
  folders: ProjectFolder[];
  /** 兼容旧数据的内部启动／资源定位点，不是 Agent 的默认操作目标。 */
  defaultFolderId: string;
  /** 未关联文件夹时的独立工作区；预留路径在首次使用时才创建。 */
  workspace?: ProjectFolder & { initialized: boolean };
}
export interface ProjectSessionScope {
  projectId: string;
  projectName: string;
  folders: ProjectFolder[];
  cwd: string;
  projectRevision?: number;
  /** 仅保留本会话明确创建或选择的工作树，不授权其父目录。 */
  worktreeRoot?: string;
  isolatedWorktree?: boolean;
}
export interface ManagedProjectState {
  version: 1;
  revision: number;
  projects: ManagedProject[];
  sessions: Record<string, ProjectSessionScope>;
  removedRoots?: string[];
}
export type ProjectChange =
  | { action: "save"; id?: string; revision?: number; name: string; folders: { path: string; name?: string }[]; defaultPath?: string }
  | { action: "remove"; id: string; revision: number };

export function emptyManagedProjects(): ManagedProjectState {
  return { version: 1, revision: 0, projects: [], sessions: {} };
}

/** 内部工作区不计入用户关联的文件夹，但与关联目录使用相同的执行边界。 */
export function projectExecutionFolders(project: { folders: ProjectFolder[]; workspace?: ProjectFolder }): ProjectFolder[] {
  return project.workspace ? [...project.folders, project.workspace] : project.folders;
}

export function defaultProjectFolder(project: ManagedProject): ProjectFolder | undefined {
  return project.folders.length ? project.folders.find(folder => folder.id === project.defaultFolderId) : project.workspace;
}

function comparableProjectPath(path: string): string {
  return /^[a-z]:[\\/]|^[\\/]{2}/i.test(path)
    ? path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
    : path.replace(/\/+$/, "");
}

/** 浏览器仅用于展示匹配；服务端仍重新验证真实路径，不以此前端判断授权。 */
export function projectContainsCwd(project: { folders: { path: string }[]; workspace?: { path: string } }, cwd: string): boolean {
  const target = comparableProjectPath(cwd);
  return [...project.folders, ...(project.workspace ? [project.workspace] : [])].some(folder => {
    const root = comparableProjectPath(folder.path);
    return target === root || target.startsWith(root + "/");
  });
}

/** 每轮列表转换建立一次索引，避免每个会话都重新扫描、规范化全部项目路径。 */
export function createProjectSessionResolver(state: ManagedProjectState) {
  const byId = new Map(state.projects.map(project => [project.id, project]));
  const roots = new Map<string, ManagedProject>();
  for (const project of state.projects) for (const folder of projectExecutionFolders(project)) {
    const path = comparableProjectPath(folder.path);
    if (!roots.has(path)) roots.set(path, project);
  }
  const cache = new Map<string, ManagedProject | undefined>();
  const byPath = (cwd: string): ManagedProject | undefined => {
    const target = comparableProjectPath(cwd);
    if (cache.has(target)) return cache.get(target);
    let path = target;
    let owner: ManagedProject | undefined;
    while (true) {
      owner = roots.get(path);
      if (owner) break;
      const slash = path.lastIndexOf("/");
      if (slash < 0) break;
      path = path.slice(0, slash);
    }
    cache.set(target, owner);
    return owner;
  };
  return { byPath, forSession(session: { id: string; cwd: string; projectRoot?: string; isWorktree?: boolean }) {
    const binding = Object.hasOwn(state.sessions, session.id) ? state.sessions[session.id] : undefined;
    return binding ? byId.get(binding.projectId)
      : byPath(session.cwd) ?? (session.isWorktree && session.projectRoot ? byPath(session.projectRoot) : undefined);
  }, hasProject: (id: string) => byId.has(id) };
}

export function projectForSession(state: ManagedProjectState, session: { id: string; cwd: string; projectRoot?: string; isWorktree?: boolean }): ManagedProject | undefined {
  const binding = Object.hasOwn(state.sessions, session.id) ? state.sessions[session.id] : undefined;
  // 已有快照的会话不因新增同路径项目而被静默转移。
  return binding ? state.projects.find(project => project.id === binding.projectId)
    : state.projects.find(project => projectContainsCwd(project, session.cwd)
      || (session.isWorktree && session.projectRoot && projectContainsCwd(project, session.projectRoot)));
}
