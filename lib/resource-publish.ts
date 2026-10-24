const queues = new Map<string, Promise<unknown>>();

/** 仅串行提交共享配置，下载与解析不占用此队列。 */
export async function publishResource<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  queues.set(key, current);
  try { return await current; }
  finally { if (queues.get(key) === current) queues.delete(key); }
}
