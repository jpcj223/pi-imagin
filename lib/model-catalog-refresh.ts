import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createModelRuntimeWithExtensions } from "@/lib/model-runtime";
import { invalidateModelsCache } from "@/lib/models-cache";

/**
 * 用户按需刷新远程服务商目录。
 * SDK 内置列表固定在发布版本，pi.dev 叠加目录通过 ModelRuntime.refresh 保存到 models-store.json。
 * 普通服务创建、模型选择和用量查询只恢复本地数据；刷新按钮才执行网络请求。
 * 成功后普通模型列表和启用范围查询读取新缓存。
 * 不要在保存凭据或其他无关请求中等待目录网络刷新。
 */

/** Bounded like the background refresh the CLI starts in RPC mode. */
const CATALOG_REFRESH_TIMEOUT_MS = 15_000;

/** The parts of a model that decide whether the Models panel has something new to show. */
export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
}

export interface CatalogRefreshResult {
  /** Every provider either refreshed or was skipped cleanly — nothing failed or was aborted. */
  completed: boolean;
  /** The visible model list moved, so cached `/api/models` payloads were dropped. */
  changed: boolean;
  /** Set when the pass could not run at all. `offline` means `PI_OFFLINE` is set. */
  reason?: "offline" | "runtime";
}

export interface CatalogRefreshOptions {
  /** Restrict the pass to these provider ids. Defaults to every refreshable provider. */
  providers?: readonly string[];
  signal?: AbortSignal;
}

/**
 * Compare catalogs by what the model list actually exposes.
 *
 * A successful revalidation rewrites `checkedAt` and `etag` in the store on
 * every pass, so comparing stored bytes would report a change each time.
 */
export function modelCatalogSignature(models: readonly CatalogModel[]): string {
  return models
    .map((model) => `${model.provider}\u0000${model.id}\u0000${model.name}`)
    .sort()
    .join("\n");
}

/** pi reads any `PI_OFFLINE` value, empty included, as "never touch the network". */
export function isModelNetworkDisabled(): boolean {
  return process.env.PI_OFFLINE !== undefined;
}

/**
 * 执行一次远程目录刷新并保存。
 * 不主动覆盖 allowNetwork，由 SDK 的 PI_OFFLINE 规则决定；force 为 true，跳过目录的新鲜度窗口。
 * 不可达服务商作为结果返回，不抛出整批异常。
 */
export async function refreshModelCatalogs(
  options: CatalogRefreshOptions = {},
): Promise<CatalogRefreshResult> {
  if (isModelNetworkDisabled()) return { completed: false, changed: false, reason: "offline" };

  const timeout = AbortSignal.timeout(CATALOG_REFRESH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let runtime: ModelRuntime;
  try {
    runtime = await createModelRuntimeWithExtensions();
  } catch {
    return { completed: false, changed: false, reason: "runtime" };
  }

  // `createAgentSessionServices()` has already restored the stored overlay, so
  // this is exactly the list the panel is showing right now.
  const before = modelCatalogSignature(runtime.getModels());
  let completed = false;
  try {
    const result = await runtime.refresh({
      ...(options.providers ? { providers: options.providers } : {}),
      force: true,
      signal,
    });
    completed = !result.aborted && result.errors.size === 0;
  } catch {
    completed = false;
  }

  // A pass that failed for one provider can still have persisted another's
  // catalog, so compare regardless of the outcome.
  const changed = modelCatalogSignature(runtime.getModels()) !== before;
  if (changed) invalidateModelsCache();
  return { completed, changed };
}

declare global {
  var __piModelCatalogRefreshPasses: Map<string, Promise<CatalogRefreshResult>> | undefined;
}

function getPasses(): Map<string, Promise<CatalogRefreshResult>> {
  if (!globalThis.__piModelCatalogRefreshPasses) globalThis.__piModelCatalogRefreshPasses = new Map();
  return globalThis.__piModelCatalogRefreshPasses;
}

/**
 * Run a pass, or join the one already running for the same providers.
 *
 * A double-click, or two browser tabs on the same panel, must not start two
 * passes racing over the same store file. Passes for different providers are
 * independent, so they are keyed rather than globally serialized.
 */
export function shareModelCatalogRefresh(
  options: CatalogRefreshOptions = {},
): Promise<CatalogRefreshResult> {
  const key = options.providers ? [...options.providers].sort().join(",") : "";
  const passes = getPasses();
  const running = passes.get(key);
  if (running) return running;

  // Deliberately without the caller's signal: a viewer who navigated away must
  // not abort the pass a second viewer is now waiting on.
  const pass = refreshModelCatalogs({ ...options, signal: undefined }).finally(() => {
    if (passes.get(key) === pass) passes.delete(key);
  });
  passes.set(key, pass);
  return pass;
}
