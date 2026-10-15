import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { fetchSessionSearch } = await createJiti(import.meta.url).import("./session-search-client.ts");
const result = { results: [], truncated: false };

test("中文单字完整编码，短暂服务错误只重试一次", async () => {
  const calls = [];
  const data = await fetchSessionSearch("我", new AbortController().signal, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response("暂时不可用", { status: 503 }) : Response.json(result);
  });
  assert.deepEqual(data, result);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url, "http://localhost").searchParams.get("q"), "我");
  assert.equal(calls[0].options.cache, "no-store");
});

test("网络恢复可重试，持续失败有界，参数错误不反复请求", async () => {
  for (const [status, expected] of [[500, 2], [400, 1]]) {
    let calls = 0;
    await assert.rejects(fetchSessionSearch("我", new AbortController().signal, async () => {
      calls++; return new Response("失败", { status });
    }));
    assert.equal(calls, expected);
  }
  let calls = 0;
  assert.deepEqual(await fetchSessionSearch("我", new AbortController().signal, async () => {
    if (++calls === 1) throw new TypeError("断网");
    return Response.json(result);
  }), result);
  assert.equal(calls, 2);
});

test("被新查询取消的请求不会重试或交付旧结果", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(fetchSessionSearch("旧词", controller.signal, async () => {
    calls++; controller.abort(); return Response.json(result);
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});
