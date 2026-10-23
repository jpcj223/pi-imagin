import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { loadPluginPage, peekPluginPage, loadBrowserPluginDetail } = await createJiti(import.meta.url).import("./plugin-browser-cache.ts");
const page = (n = 1) => ({ items: [{ name: "pi-unit", source: "npm:pi-unit", description: "Original", types: ["extension"] }], page: n, total: 100, hasNext: true });

test("预取和打开复用请求，缓存成功结果，刷新失败保留缓存", async () => {
  const original = globalThis.fetch;
  let finish, calls = 0;
  globalThis.fetch = async () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  try {
    const warm = loadPluginPage("prefetch-unit"), open = loadPluginPage("prefetch-unit");
    await Promise.resolve(); assert.equal(calls, 1);
    finish(Response.json(page()));
    assert.deepEqual(await warm, await open);
    await loadPluginPage("prefetch-unit"); assert.equal(calls, 1);
    globalThis.fetch = async () => new Response("error", { status: 502 });
    await assert.rejects(loadPluginPage("prefetch-unit", 1, undefined, true), /502/);
    assert.equal(peekPluginPage("prefetch-unit").items[0].name, "pi-unit");
  } finally { globalThis.fetch = original; }
});

test("过时搜索取消，不能取消仍由页面使用的预取请求", async () => {
  const original = globalThis.fetch;
  let finish, requestSignal;
  globalThis.fetch = async (_url, { signal }) => { requestSignal = signal; return new Promise((resolve, reject) => { finish = resolve; signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }); };
  try {
    const a = new AbortController(), b = new AbortController();
    const first = loadPluginPage("abort-unit", 2, a.signal), second = loadPluginPage("abort-unit", 2, b.signal);
    await Promise.resolve(); a.abort(); await assert.rejects(first);
    assert.equal(requestSignal.aborted, false);
    finish(Response.json(page(2))); await second;
    const c = new AbortController(), last = loadPluginPage("cancel-only", 1, c.signal);
    await Promise.resolve(); c.abort(); await assert.rejects(last);
    assert.equal(requestSignal.aborted, true);
  } finally { globalThis.fetch = original; }
});

test("详情缓存按包隔离，取消和失败不会污染另一插件", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => { calls++; const name = new URL(url, "http://local").searchParams.get("name"); return Response.json({ name, partial: false, version: "1.0" }); };
  try {
    await loadBrowserPluginDetail("pi-a"); await loadBrowserPluginDetail("pi-a");
    assert.equal(calls, 1); assert.equal((await loadBrowserPluginDetail("pi-b")).name, "pi-b");
  } finally { globalThis.fetch = original; }
});

test("过期首页快照可立即显示，网络失败仍保留原列表", async () => {
  const original = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => JSON.stringify({ at: Date.now() - 120000, data: page() }) } });
  globalThis.fetch = async () => new Response("offline", { status: 502 });
  try {
    assert.equal(peekPluginPage().items[0].name, "pi-unit");
    await assert.rejects(loadPluginPage(), /502/);
    assert.equal(peekPluginPage().items.length, 1);
  } finally { globalThis.fetch = original; if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor); else delete globalThis.sessionStorage; }
});
