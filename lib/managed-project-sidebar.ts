import { createProjectSessionResolver, defaultProjectFolder, projectContainsCwd, type ManagedProjectState } from "./managed-projects-shared";
import type { SessionUiState } from "./session-ui-state-shared";
import type { SessionInfo } from "./types";
import { workspaceKeyOf } from "./workspace-memory";

export const managedProjectKey = (id: string) => `managed:${id}`;

/** 只转换列表的展示副本；执行、工作树与文件标签继续使用原会话的真实身份。 */
export function managedProjectSidebar(state: ManagedProjectState, sessions: SessionInfo[], uiState: SessionUiState, current: { key: string; root: string } | null, currentCwd?: string) {
  const resolver = createProjectSessionResolver(state);
  const displaySessions = sessions.map(session => {
    const project = resolver.forSession(session);
    if (!project) return Object.hasOwn(state.sessions, session.id) || state.removedRoots?.some(root => projectContainsCwd({ folders: [{ path: root }] }, session.cwd))
      ? { ...session, projectKey: `removed-managed:${state.sessions[session.id]?.projectId ?? "legacy"}` } : session;
    const root = defaultProjectFolder(project)!.path;
    return { ...session, projectKey: managedProjectKey(project.id), projectRoot: root };
  });
  const projects: SessionUiState["projects"] = {};
  const names = { ...uiState.projectNames };
  for (const project of state.projects) {
    const root = defaultProjectFolder(project)!.path;
    projects[managedProjectKey(project.id)] = { root, pinnedAt: 0 };
    names[managedProjectKey(project.id)] = project.name;
    // 显式项目即使位于日期目录下，也不进入默认分组。
    names[root] ??= project.name;
  }
  // 目录不自动成为项目；借用已有默认区分组规则，保留原会话和持久化元数据。
  const removed = [...new Set([...(uiState.removedProjects ?? []), ...Object.keys(uiState.projects).filter(key => !Object.hasOwn(projects, key)),
    ...displaySessions.filter(session => !session.projectKey?.startsWith("managed:")).map(workspaceKeyOf), "removed-managed:legacy",
    ...Object.values(state.sessions).filter(scope => !resolver.hasProject(scope.projectId)).map(scope => `removed-managed:${scope.projectId}`)])];
  const selected = current && (resolver.byPath(currentCwd ?? current.root) ?? resolver.byPath(current.root));
  return { sessions: displaySessions, uiState: { ...uiState, projects, projectNames: names, removedProjects: removed },
    current: selected ? { key: managedProjectKey(selected.id), root: defaultProjectFolder(selected)!.path } : null };
}
