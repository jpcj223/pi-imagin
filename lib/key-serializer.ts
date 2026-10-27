// 按 storeKey 在 globalThis 保存各键的串行队列，使独立路由包与热更新共享同一队列。

/**
 * Runs `task` after every earlier task for the same key under `storeKey` has
 * settled, whether it resolved or threw. A chain that ran out is removed.
 */
export function serializeByKey<T>(storeKey: symbol, key: string, task: () => Promise<T>): Promise<T> {
  const store = globalThis as Record<symbol, Map<string, Promise<void>> | undefined>;
  const chains = (store[storeKey] ??= new Map());
  const run = (chains.get(key) ?? Promise.resolve()).then(task);
  const tail = run.then(() => undefined, () => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}
