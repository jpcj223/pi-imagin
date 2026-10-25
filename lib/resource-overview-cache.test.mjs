import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { readResourceOverview, prepareResourceOverview, peekResourceOverview, invalidateResourceOverviews } = await createJiti(import.meta.url).import("./resource-overview-cache.ts");

test("概览按功能和目录隔离，预读后不重复请求，写入后失效", async t => {
  for (const kind of ["skills", "plugins", "agents", "mcp"]) invalidateResourceOverviews(kind);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push(url); assert.equal(init.cache, "no-store"); return Response.json({ url }); });
  for (const kind of ["skills", "plugins", "agents", "mcp"]) {
    await prepareResourceOverview(kind, "C:/A", new AbortController().signal);
    assert.equal(calls.length, ["skills", "plugins", "agents", "mcp"].indexOf(kind) + 1);
    assert.ok(peekResourceOverview(kind, "C:/A"));
    assert.equal(peekResourceOverview(kind, "C:/B"), undefined);
    assert.equal(peekResourceOverview(kind, null), undefined);
    await readResourceOverview(kind, "C:/A", undefined, true);
  }
  assert.equal(calls.length, 4);
  await prepareResourceOverview("plugins", "C:/A", new AbortController().signal);
  assert.equal(calls.length, 4, "返回已访问范围不阻塞等待网络");
  await readResourceOverview("plugins", "C:/A", undefined, true);
  assert.equal(calls.length, 5, "一次性预读消费后，返回时仍重新获取最新概览");
  invalidateResourceOverviews("skills");
  assert.equal(peekResourceOverview("skills", "C:/A"), undefined);
  assert.ok(peekResourceOverview("plugins", "C:/A"));
  await readResourceOverview("skills", "C:/A"); assert.equal(calls.length, 6);
});

test("失败、中止及落后的响应不能写入概览缓存", async t => {
  invalidateResourceOverviews("skills");
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Access denied" }, { status: 403 }));
  await prepareResourceOverview("skills", "denied", new AbortController().signal);
  assert.equal(peekResourceOverview("skills", "denied"), undefined);
  const replies = [];
  t.mock.method(globalThis, "fetch", () => new Promise(resolve => replies.push(resolve)));
  const old = readResourceOverview("skills", "race");
  const fresh = readResourceOverview("skills", "race");
  replies[1](Response.json({ value: "new" })); await fresh;
  replies[0](Response.json({ value: "old" })); await old;
  assert.deepEqual(peekResourceOverview("skills", "race"), { value: "new" });
  const controller = new AbortController();
  const aborted = readResourceOverview("skills", "aborted", controller.signal);
  controller.abort(); replies[2](Response.json({ value: "ignored" }));
  await assert.rejects(aborted);
  assert.equal(peekResourceOverview("skills", "aborted"), undefined);
});
