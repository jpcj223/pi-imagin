import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { parseSkillCatalog, parseCatalogSkillDetail, loadSkillCatalog } = await createJiti(import.meta.url).import("./skill-catalog.ts");
const item = { source: "owner/repo", skillId: "useful-skill", name: "Useful skill", installs: 1234 };
test("真实分页、去重及有限搜索保留上游顺序", () => {
  const page = parseSkillCatalog({ skills: [item, item], page: 1, total: 400, hasMore: true }, "", 1);
  assert.equal(page.items.length, 1); assert.equal(page.hasNext, true); assert.equal(page.total, 400);
  assert.equal(page.items[0].package, "owner/repo@useful-skill");
  const search = parseSkillCatalog({ query: "react", count: 2, skills: [item, { ...item, skillId: "another", installs: 50000 }] }, "react", 0);
  assert.equal(search.hasNext, false); assert.equal(search.items[0].installs, 1234);
  assert.throws(() => parseSkillCatalog({ skills: [], page: 0, total: 10, hasMore: true }, "", 1), /pagination/);
  assert.throws(() => parseSkillCatalog({ query: "old", skills: [], count: 0 }, "new", 0), /search/);
});
test("格式异常和恶意包来源不能伪装成空目录或安装目标", () => {
  assert.throws(() => parseSkillCatalog({}, "", 0), /catalog/);
  for (const source of ["../repo", "https://evil.test", "--flag/repo", "owner/repo@branch"]) assert.throws(() => parseSkillCatalog({ skills: [{ ...item, source }], page: 0, hasMore: false, total: 1 }, "", 0), /entry/);
});
test("详情只提取匹配身份的 SKILL.md，保留嵌套内容供客户端净化", () => {
  const html = '<link rel="canonical" href="https://www.skills.sh/owner/repo/useful-skill"/><meta name="description" content="A &amp; B"/><span>SKILL.md</span><div><div class="prose prose-invert"><h1>Skill</h1><div>Nested</div><p>End</p></div></div><script>outside()</script>';
  const detail = parseCatalogSkillDetail(html, "owner/repo", "useful-skill");
  assert.equal(detail.description, "A & B"); assert.match(detail.readmeHtml, /<div>Nested<\/div><p>End<\/p>$/); assert.ok(!detail.readmeHtml.includes("outside"));
  assert.throws(() => parseCatalogSkillDetail(html, "other/repo", "useful-skill"), /identity/);
  assert.throws(() => parseCatalogSkillDetail(html.replace("SKILL.md", "missing"), "owner/repo", "useful-skill"), /unavailable/);
});
test("目录查询为有界只读 HTTP 请求，不使用 CLI 回退", async () => {
  const original = globalThis.fetch, offline = process.env.PI_OFFLINE; delete process.env.PI_OFFLINE;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return Response.json({ skills: [item], page: 8, total: 2000, hasMore: true }); };
  try {
    await loadSkillCatalog("", 8); await loadSkillCatalog("", 8); assert.equal(calls.length, 1); assert.ok(calls[0].url.endsWith("/api/skills/all-time/8")); assert.equal(calls[0].options.method, undefined);
    globalThis.fetch = async () => new Response("offline", { status: 502 }); await assert.rejects(loadSkillCatalog("unique-failure", 0), /502/);
  } finally { globalThis.fetch = original; if (offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = offline; }
});
