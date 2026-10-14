export interface ModelsData {
  models: Record<string, string>;
  modelList: { id: string; name: string; provider: string; input?: string[] }[];
  defaultModel: { provider: string; modelId: string } | null;
  /**
 * 用户未选择推理级别时，新会话实际采用的已解析级别。
 */
  defaultThinkingLevel: string | null;
  /**
 * 全局设置中保存的 defaultThinkingLevel，推理菜单的星标对应此值。
 */
  savedDefaultThinkingLevel: string | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  /**
 * provider/modelId 对应的 enabledModels 推理后缀固定值。
 */
  thinkingLevelPins: Record<string, string>;
  modelError?: string;
  /**
 * 解析 enabledModels 范围时的警告，例如模式没有匹配到模型。
 */
  modelScopeWarnings?: string[];
}

interface ModelsCacheState {
  entries: Map<string, { data: ModelsData; expiresAt: number }>;
  inFlight: Map<string, Promise<ModelsData>>;
  generation: number;
}

declare global {
  var __piModelsCacheState: ModelsCacheState | undefined;
}

const MODELS_CACHE_TTL_MS = 60_000;
const MAX_MODELS_CACHE_ENTRIES = 32;
// 不要直接拼接捕获错误，SDK 错误可能包含路径和服务商细节。
const SAFE_MODEL_LOAD_FAILURE_MESSAGE = "Model list is temporarily unavailable. Check your configuration and try again.";

function getModelsCacheState(): ModelsCacheState {
  if (!globalThis.__piModelsCacheState) {
    globalThis.__piModelsCacheState = {
      entries: new Map(),
      inFlight: new Map(),
      generation: 0,
    };
  }
  return globalThis.__piModelsCacheState;
}

export function invalidateModelsCache(): void {
  const state = getModelsCacheState();
  state.generation += 1;
  state.entries.clear();
  state.inFlight.clear();
}

export function withModelRuntimeError(data: ModelsData, modelError: string | undefined): ModelsData {
  return modelError ? { ...data, modelError } : data;
}

export function withSafeModelLoadFailure(data: ModelsData): ModelsData {
  return { ...data, modelError: SAFE_MODEL_LOAD_FAILURE_MESSAGE };
}

export function loadModelsWithCache(cwd: string, loader: () => Promise<ModelsData>): Promise<ModelsData> {
  const state = getModelsCacheState();
  const cached = state.entries.get(cwd);
  if (cached) {
    if (cached.expiresAt > Date.now()) return Promise.resolve(cached.data);
    state.entries.delete(cwd);
  }

  const existingLoad = state.inFlight.get(cwd);
  if (existingLoad) return existingLoad;

  const generation = state.generation;
  const loadPromise: Promise<ModelsData> = Promise.resolve()
    .then(loader)
    .then((data) => {
      if (state.generation === generation && state.inFlight.get(cwd) === loadPromise) {
        const now = Date.now();
        for (const [key, entry] of state.entries) {
          if (entry.expiresAt <= now) state.entries.delete(key);
        }
        while (state.entries.size >= MAX_MODELS_CACHE_ENTRIES) {
          const oldestKey = state.entries.keys().next().value;
          if (oldestKey === undefined) break;
          state.entries.delete(oldestKey);
        }
        state.entries.set(cwd, { data, expiresAt: now + MODELS_CACHE_TTL_MS });
      }
      return data;
    })
    .finally(() => {
      if (state.inFlight.get(cwd) === loadPromise) state.inFlight.delete(cwd);
    });

  state.inFlight.set(cwd, loadPromise);
  return loadPromise;
}
