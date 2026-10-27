import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "./models-cache";
import { getAgentDir } from "./agent-dir";
import { readModelsConfig } from "./models-config-store";

type RuntimeModel = Awaited<ReturnType<ModelRuntime["getAvailable"]>>[number];

/**
 * 按服务商缓存本进程各 ModelRuntime 曾见过的模型。
 * 每次列表查询建立新运行时，但部分扩展仅首次注册，并将后续注册推迟到 session_start。
 * 列表不启动会话，此缓存避免模型在第一次查询之后从选择器消失。
 */
interface DeferredCatalog {
  agentDir: string;
  models: Map<string, RuntimeModel[]>;
  customProviders: Set<string>;
}

declare global {
  var __piImaginDeferredProviderCatalog: DeferredCatalog | undefined;
}

function catalog(): Map<string, RuntimeModel[]> {
  const agentDir = getAgentDir();
  let state = globalThis.__piImaginDeferredProviderCatalog;
  if (!state || state.agentDir !== agentDir) {
    state = { agentDir, models: new Map(), customProviders: new Set() };
    globalThis.__piImaginDeferredProviderCatalog = state;
  }
  try {
    const providers = readModelsConfig().providers;
    if (providers && typeof providers === "object" && !Array.isArray(providers)) {
      for (const provider of Object.keys(providers)) state.customProviders.add(provider);
    }
  } catch {
    // 配置损坏时保留已知来源，不能把旧自定义模型伪装为延迟注册的扩展模型。
  }
  for (const provider of state.customProviders) state.models.delete(provider);
  return state.models;
}

/** Record what a runtime offers, so later runtimes can show a provider they have not registered yet. */
export async function rememberProviderModels(runtime: ModelRuntime): Promise<void> {
  const remembered = catalog();
  const customProviders = globalThis.__piImaginDeferredProviderCatalog!.customProviders;
  const byProvider = new Map<string, RuntimeModel[]>();
  for (const model of await runtime.getAvailable()) {
    // models.json 每次由 SDK 重新读取，不需要延迟补回；旧会话也不能复活已改名的服务商。
    if (customProviders.has(model.provider)) continue;
    byProvider.set(model.provider, [...(byProvider.get(model.provider) ?? []), model]);
  }
  const added = [...byProvider.keys()].some((provider) => !remembered.has(provider));
  for (const [provider, models] of byProvider) remembered.set(provider, models);
  // A listing cached before this provider was known would hide it for the cache lifetime.
  if (added) invalidateModelsCache();
}

/**
 * Remembered models of providers this runtime does not know at all. A provider the runtime
 * registered but cannot use (signed out, no key) is never added back: only a registration that
 * has not happened yet in this runtime is filled in.
 */
export function deferredProviderModels(runtime: ModelRuntime): RuntimeModel[] {
  const registered = new Set(runtime.getModels().map((model) => model.provider));
  return [...catalog()].flatMap(([provider, models]) => (registered.has(provider) ? [] : models));
}

/** The runtime as a model listing should see it: its own available models plus deferred ones. */
export function withDeferredProviderModels(runtime: ModelRuntime): ModelRuntime {
  return new Proxy(runtime, {
    get(target, property, receiver) {
      if (property === "getAvailable") {
        return async (...args: Parameters<ModelRuntime["getAvailable"]>) => {
          const [providerId] = args;
          const deferred = deferredProviderModels(target).filter((model) => !providerId || model.provider === providerId);
          return [...await target.getAvailable(...args), ...deferred];
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** A remembered model whose provider this runtime has not registered yet. */
export function findDeferredModel(runtime: ModelRuntime, provider: string, modelId: string): RuntimeModel | undefined {
  return deferredProviderModels(runtime).find((model) => model.provider === provider && model.id === modelId);
}
