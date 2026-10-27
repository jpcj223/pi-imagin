import {
  createAgentSessionServices,
  getAgentDir,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { rememberProviderModels } from "./deferred-provider-models";
import { serializeByKey } from "./key-serializer";

/**
 * 构建包含扩展注册服务商的 ModelRuntime。
 * 单独创建运行时只知道内置服务商和 models.json，会漏掉资源加载阶段注册的模型。
 * 使用智能体目录作为 cwd，排除项目专用扩展并加载全局扩展。
 * 列表读取复用扩展注册，每次离线刷新凭据；登录和目录联网刷新仍使用独立实例。
 */
export async function createModelRuntimeWithExtensions(): Promise<ModelRuntime> {
  const agentDir = getAgentDir();
  const services = await createAgentSessionServices({ cwd: agentDir, agentDir });
  await rememberProviderModels(services.modelRuntime);
  return services.modelRuntime;
}

interface SharedModelRuntime {
  agentDir: string;
  runtime: Promise<ModelRuntime>;
  /** 每个缓存项使用独立刷新队列，避免旧扩展阻塞新缓存项。 */
  queueKey: string;
  /** 构建中使用无穷过期时间，让并发调用共享同次构建。 */
  expiresAt: number;
}

declare global {
  var __piWebSharedModelRuntime: SharedModelRuntime | undefined;
}

// 应用内插件修改和重载主动失效；TTL 兜底终端安装或外部编辑扩展的情况。
const SHARED_MODEL_RUNTIME_TTL_MS = 10 * 60_000;
const REFRESH_QUEUE_KEY: symbol = Symbol.for("pi-web:shared-model-runtime-refresh");

/** 每个智能体目录共享已加载扩展的列表运行时，减少重复导入；每次读取仍离线刷新模型和凭据。登录及联网目录刷新使用独立运行时。 */
export async function getModelRuntimeWithExtensions(): Promise<ModelRuntime> {
  const agentDir = getAgentDir();
  let entry = globalThis.__piWebSharedModelRuntime;
  if (!entry || entry.agentDir !== agentDir || entry.expiresAt <= Date.now()) {
    entry = buildSharedModelRuntime(agentDir);
    globalThis.__piWebSharedModelRuntime = entry;
  }
  // 在队列外等待扩展构建，避免卡住的旧构建阻塞失效后的新项。
  const shared = await entry.runtime;
  // 串行刷新，避免 SDK 并发刷新使先发请求读到旧认证状态。
  return serializeByKey(REFRESH_QUEUE_KEY, entry.queueKey, async () => {
    await shared.refresh({ allowNetwork: false });
    await rememberProviderModels(shared);
    return shared;
  });
}

function buildSharedModelRuntime(agentDir: string): SharedModelRuntime {
  const entry: SharedModelRuntime = {
    agentDir,
    runtime: createModelRuntimeWithExtensions(),
    // 扩展 refreshModels 无超时；独立队列可把阻塞限制在当前缓存项。
    queueKey: `${agentDir}\0${randomUUID()}`,
    expiresAt: Number.POSITIVE_INFINITY,
  };
  entry.runtime.then(
    () => {
      entry.expiresAt = Date.now() + SHARED_MODEL_RUNTIME_TTL_MS;
    },
    () => {
      // 构建失败不缓存，后续请求可重试。
      if (globalThis.__piWebSharedModelRuntime === entry) globalThis.__piWebSharedModelRuntime = undefined;
    },
  );
  return entry;
}

/** 扩展集合变化后，下次使用时重新构建共享运行时。 */
export function invalidateModelRuntimeWithExtensions(): void {
  globalThis.__piWebSharedModelRuntime = undefined;
}
