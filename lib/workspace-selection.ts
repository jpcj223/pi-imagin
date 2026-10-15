import type { SessionUiState } from "./session-ui-state-shared";

// 仅比较已经登记的路径，实际访问始终由服务端校验。
function pathKey(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}

export function registeredWorkspace(cwd: string, projects: SessionUiState["projects"]): { key: string; root: string } | null {
  const key = pathKey(cwd);
  const entry = Object.entries(projects).find(([, project]) => pathKey(project.root) === key);
  return entry ? { key: entry[0], root: entry[1].root } : null;
}

export async function validateWorkspaceSelection(cwd: string, request: typeof fetch = fetch, signal?: AbortSignal): Promise<{ cwd: string; root: string; key: string }> {
  const response = await request("/api/cwd/validate", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd }), signal,
  });
  const data = await response.json() as { cwd?: string; projectRoot?: string; projectKey?: string; error?: string };
  if (!response.ok || !data.cwd || !data.projectRoot || !data.projectKey) throw new Error(data.error ?? `HTTP ${response.status}`);
  return { cwd: data.cwd, root: data.projectRoot, key: data.projectKey };
}
