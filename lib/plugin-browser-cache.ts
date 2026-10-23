import type { PluginCatalogPage } from "./plugin-catalog";
import type { PluginSourceDetail } from "./plugin-detail";

// 公共目录缓存与项目配置无关；有界内存缓存、请求复用及最后一个订阅者取消。
type Entry<T> = { value: T; expires: number };
type Pending<T> = { promise: Promise<T>; controller: AbortController; users: number };
class ResourceCache<T> {
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
const pages = new ResourceCache<PluginCatalogPage>(40, 60000);
const details = new ResourceCache<PluginSourceDetail>(20, 300000);
const logos = new ResourceCache<Record<string, string>>(40, 300000);
const HOME_KEY = "pi-plugin-catalog-home-v1";
let restored = false;
function pageKey(query: string, page: number) { return JSON.stringify([query.trim(), page]); }
function validPage(value: PluginCatalogPage, page: number) {
  return value?.page === page && Number.isSafeInteger(value.total) && value.total >= 0 && typeof value.hasNext === "boolean"
    && Array.isArray(value.items) && value.items.length <= 50 && value.items.every(item =>
      typeof item.name === "string" && /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(item.name) && item.name.length <= 214
      && item.source === `npm:${item.name}` && typeof item.description === "string" && item.description.length <= 2000
      && Array.isArray(item.types) && item.types.every(type => typeof type === "string")
      && (item.author === undefined || typeof item.author === "string"));
}
function restoreHome() {
  if (restored || typeof sessionStorage === "undefined") return;
  restored = true;
  try {
    const raw = sessionStorage.getItem(HOME_KEY);
    if (!raw || raw.length > 150000) return;
    const saved = JSON.parse(raw) as { at: number; data: PluginCatalogPage };
    if (Number.isFinite(saved.at) && saved.at <= Date.now() && Date.now() - saved.at < 86400000 && validPage(saved.data, 1)) pages.put(pageKey("", 1), saved.data, saved.at + 60000);
  } catch { /* 存储不可用时仍正常联网。 */ }
}
export function peekPluginPage(query = "", page = 1) { restoreHome(); return pages.peek(pageKey(query, page)); }
async function json<T>(url: string, signal: AbortSignal): Promise<T> {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try {
    if (signal.aborted) controller.abort();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Plugin request HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
export function loadPluginPage(query = "", page = 1, signal?: AbortSignal, force = false) {
  restoreHome();
  return pages.load(pageKey(query, page), async signal => {
    const data = await json<PluginCatalogPage>("/api/plugins/search?" + new URLSearchParams({ q: query.trim(), page: String(page) }), signal);
    if (!validPage(data, page)) throw new Error("Invalid plugin page");
    if (!query.trim() && page === 1) try { sessionStorage.setItem(HOME_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* 缓存不影响浏览。 */ }
    return data;
  }, signal, force);
}
export function peekPluginDetail(name: string) { return details.peek(name); }
export function loadBrowserPluginDetail(name: string, signal?: AbortSignal, force = false) {
  return details.load(name, async signal => {
    const data = await json<PluginSourceDetail>("/api/plugins/detail?" + new URLSearchParams({ name }), signal);
    if (data.name !== name) throw new Error("Invalid plugin detail");
    return data;
  }, signal, force);
}
let warmingDetail = false;
export function warmPluginDetail(name: string) {
  if (warmingDetail) return;
  warmingDetail = true;
  void loadBrowserPluginDetail(name).catch(() => {}).finally(() => { warmingDetail = false; });
}
export function loadBrowserPluginLogos(names: string[], signal?: AbortSignal) {
  const key = JSON.stringify(names);
  return logos.load(key, signal => {
    const params = new URLSearchParams(); for (const name of names) params.append("name", name);
    return json<Record<string, string>>("/api/plugins/logos?" + params, signal);
  }, signal);
}
