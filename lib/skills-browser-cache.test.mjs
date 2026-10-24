import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { loadBrowserSkillPage, peekSkillPage, loadInstalledSkillContent, invalidateInstalledSkillContent } = await createJiti(import.meta.url).import("./skills-browser-cache.ts");
const data = { items: [{ name: "Skill", source: "owner/repo", slug: "skill", package: "owner/repo@skill", url: "https://skills.sh/owner/repo/skill", installs: 1, official: false }], page: 0, total: 1, hasNext: false, searchLimited: false };
test("预加载和页面共用请求，仅最后订阅者可取消，失败保留缓存", async () => {
  const original = globalThis.fetch; let complete, signal, calls = 0;
  globalThis.fetch = async (_url, options) => { signal = options.signal; calls++; return new Promise(resolve => { complete = resolve; }); };
  try {
    const controller = new AbortController(), warm = loadBrowserSkillPage("cache-test", 0, controller.signal), open = loadBrowserSkillPage("cache-test");
    await Promise.resolve(); controller.abort(); await assert.rejects(warm); assert.equal(signal.aborted, false); assert.equal(calls, 1);
    complete(Response.json(data)); await open; await loadBrowserSkillPage("cache-test"); assert.equal(calls, 1);
    globalThis.fetch = async () => new Response("error", { status: 502 }); await assert.rejects(loadBrowserSkillPage("cache-test", 0, undefined, true)); assert.equal(peekSkillPage("cache-test").items.length, 1);
  } finally { globalThis.fetch = original; }
});
test("已安装详情按项目和精确文件路径隔离，更新后能清除缓存", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ content: "# Skill" }); };
  try {
    await loadInstalledSkillContent("a", "/a/SKILL.md"); await loadInstalledSkillContent("a", "/a/SKILL.md"); assert.equal(calls, 1);
    await loadInstalledSkillContent("b", "/a/SKILL.md"); assert.equal(calls, 2);
    invalidateInstalledSkillContent("a", "/a/SKILL.md"); await loadInstalledSkillContent("a", "/a/SKILL.md"); assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});
