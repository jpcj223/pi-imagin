// 公共目录缓存与项目配置无关；有界内存缓存、请求复用及最后一个订阅者取消。
type Entry<T> = { value: T; expires: number };
type Pending<T> = { promise: Promise<T>; controller: AbortController; users: number };
export class ResourceCache<T> {
  entries = new Map<string, Entry<T>>();
  pending = new Map<string, Pending<T>>();
  constructor(private limit: number, private ttl: number) {}
  peek(key: string) { return this.entries.get(key)?.value; }
  put(key: string, value: T, expires = Date.now() + this.ttl) {
    this.entries.delete(key);
    if (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, expires });
  }
  load(key: string, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, force = false): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const cached = this.entries.get(key);
    if (!force && cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
    let task = this.pending.get(key);
    if (!task || task.controller.signal.aborted) {
      const controller = new AbortController();
      task = { controller, users: 0, promise: Promise.resolve().then(() => run(controller.signal)).then(value => { if (!controller.signal.aborted) this.put(key, value); return value; }).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); }) };
      this.pending.set(key, task);
    }
    const current = task;
    current.users++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = (callback: () => void) => {
        if (finished) return;
        finished = true; signal?.removeEventListener("abort", cancel);
        if (--current.users === 0) current.controller.abort();
        callback();
      };
      const cancel = () => finish(() => reject(signal?.reason));
      signal?.addEventListener("abort", cancel, { once: true });
      current.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    });
  }
}
