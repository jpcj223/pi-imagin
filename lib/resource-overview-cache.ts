/** 仅缓存设置页的只读概览，供范围切换展示；不能作为授权或写入依据。 */
export type ResourceOverviewKind = "plugins" | "skills" | "agents" | "mcp";
type Snapshot = { data: unknown; updatedAt: number; prepared?: boolean };
const snapshots = new Map<string, Snapshot>();
const requests = new Map<string, object>();
const LIMIT = 24;
const MAX_AGE = 30_000;

export function resourceOverviewUrl(kind: ResourceOverviewKind, cwd: string | null): string {
  const path = kind === "agents" ? "/api/subagents/profiles" : `/api/${kind}`;
  return `${path}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : kind === "agents" ? "?scope=global" : ""}`;
}

export function peekResourceOverview<T>(kind: ResourceOverviewKind, cwd: string | null): T | undefined {
  const snapshot = snapshots.get(resourceOverviewUrl(kind, cwd));
  return snapshot && Date.now() - snapshot.updatedAt < MAX_AGE ? snapshot.data as T : undefined;
}

export function takePreparedResourceOverview<T>(kind: ResourceOverviewKind, cwd: string | null): T | undefined {
  const snapshot = snapshots.get(resourceOverviewUrl(kind, cwd));
  if (!snapshot?.prepared || peekResourceOverview(kind, cwd) === undefined) return;
  snapshot.prepared = false;
  return snapshot.data as T;
}

export function invalidateResourceOverviews(kind: ResourceOverviewKind): void {
  const prefix = resourceOverviewUrl(kind, null).split("?")[0];
  for (const key of snapshots.keys()) if (key.split("?")[0] === prefix) snapshots.delete(key);
  for (const key of requests.keys()) if (key.split("?")[0] === prefix) requests.delete(key);
}

export function rememberResourceOverview(kind: ResourceOverviewKind, cwd: string | null, data: unknown): void {
  const key = resourceOverviewUrl(kind, cwd);
  snapshots.delete(key);
  snapshots.set(key, { data, updatedAt: Date.now() });
  while (snapshots.size > LIMIT) snapshots.delete(snapshots.keys().next().value!);
}

export async function readResourceOverview<T>(kind: ResourceOverviewKind, cwd: string | null, signal?: AbortSignal, consumePrepared = false): Promise<T> {
  const key = resourceOverviewUrl(kind, cwd);
  // 刚为本次切换预读的响应直接消费，避免面板挂载后重复请求。
  const prepared = consumePrepared ? takePreparedResourceOverview<T>(kind, cwd) : undefined;
  if (prepared !== undefined) return prepared;
  const request = {};
  requests.set(key, request);
  try {
    const response = await fetch(key, { cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
    if (requests.get(key) === request) rememberResourceOverview(kind, cwd, data);
    return data as T;
  } finally {
    if (requests.get(key) === request) requests.delete(key);
  }
}

/** 首次访问先准备数据再提交选择；缓存返回立即展示，面板仍会重新校验数据。 */
export async function prepareResourceOverview(kind: ResourceOverviewKind, cwd: string | null, signal: AbortSignal): Promise<void> {
  if (peekResourceOverview(kind, cwd) !== undefined) return;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const data = await readResourceOverview(kind, cwd, controller.signal);
    const snapshot = snapshots.get(resourceOverviewUrl(kind, cwd));
    if (snapshot && snapshot.data === data && !controller.signal.aborted) snapshot.prepared = true;
  } catch {
    // 正式面板负责展示读取失败及 MCP 的全局回退，预读不改变错误含义。
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
