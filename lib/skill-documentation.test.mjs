import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { loadRepositorySkillDoc } = await jiti.import("./skill-documentation.ts");
const { loadCatalogSkillDetail } = await jiti.import("./skill-catalog.ts");
const { findInstalledCatalogSkill } = await jiti.import("./skill-selection.ts");
const { compactDisplayPath } = await jiti.import("./display-path.ts");
const sha = "a".repeat(40);

async function network(run) {
  const previous = globalThis.fetch, offline = process.env.PI_OFFLINE;
  delete process.env.PI_OFFLINE;
  try { await run(); }
  finally { globalThis.fetch = previous; if (offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = offline; }
}
const tree = paths => ({ sha, tree: paths.map(path => ({ type: "blob", path, sha })) });
const markdown = name => `---\nname: ${name}\ndescription: Complete description\n---\n# Instructions\n\n## Usage\n\nFull instructions beyond the preview.\n`;
const preview = (source, slug) => `<link rel="canonical" href="https://skills.sh/${source}/${slug}"><span>SKILL.md</span><div class="prose prose-invert"><h1>Preview</h1></div><button>Show more</button>`;

test("完整说明通过真实树路径读取，并固定提交 SHA，不猜测 README", async () => network(async () => {
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return String(url).includes("api.github.com") ? Response.json(tree(["README.md", "skills/demo/SKILL.md"])) : new Response(markdown("demo"));
  };
  const result = await loadRepositorySkillDoc("fixture/full", "demo");
  assert.equal(result.documentPath, "skills/demo/SKILL.md");
  assert.match(result.markdown, /beyond the preview/);
  assert.ok(!result.markdown.includes("description:"));
  assert.ok(calls[1].includes(`/${sha}/skills/demo/SKILL.md`));
}));

test("同名文件路径冲突时不能随机展示另一份技能", async () => network(async () => {
  globalThis.fetch = async () => Response.json(tree(["one/demo/SKILL.md", "two/demo/SKILL.md"]));
  await assert.rejects(loadRepositorySkillDoc("fixture/ambiguous", "demo"), /ambiguous/);
}));

test("根目录 SKILL.md 必须匹配技能身份", async () => network(async () => {
  globalThis.fetch = async url => String(url).includes("api.github.com") ? Response.json(tree(["SKILL.md"])) : new Response(markdown("different"));
  await assert.rejects(loadRepositorySkillDoc("fixture/root", "demo"), /identity/);
}));

test("文件树截断或文档超限明确失败", async () => network(async () => {
  globalThis.fetch = async () => Response.json({ ...tree(["demo/SKILL.md"]), truncated: true });
  await assert.rejects(loadRepositorySkillDoc("fixture/truncated", "demo"), /Incomplete/);
  globalThis.fetch = async url => String(url).includes("api.github.com") ? Response.json(tree(["demo/SKILL.md"])) : new Response("x".repeat(1048577));
  await assert.rejects(loadRepositorySkillDoc("fixture/oversized", "demo"), /too large/);
}));

test("目录预览自动补齐全文，重试能绕过服务端详情缓存", async () => network(async () => {
  let version = "first";
  globalThis.fetch = async url => {
    if (String(url).includes("skills.sh")) return new Response(preview("fixture/enriched", "demo"));
    if (String(url).includes("api.github.com")) return Response.json(tree(["skills/demo/SKILL.md"]));
    return new Response(markdown("demo") + version);
  };
  const first = await loadCatalogSkillDetail("fixture/enriched", "demo");
  assert.equal(first.truncated, false); assert.match(first.markdown, /first$/);
  version = "second";
  assert.match((await loadCatalogSkillDetail("fixture/enriched", "demo", undefined, true)).markdown, /second$/);
}));

test("远程全文不可用时保留预览，标记失败而不返回空正文", async () => network(async () => {
  globalThis.fetch = async url => String(url).includes("skills.sh") ? new Response(preview("fixture/unavailable", "demo")) : new Response("Rate limited", { status: 429 });
  const result = await loadCatalogSkillDetail("fixture/unavailable", "demo");
  assert.equal(result.fullUnavailable, true); assert.equal(result.truncated, true); assert.match(result.readmeHtml, /Preview/);
}));

test("本地详情匹配来源，项目可继承全局但同名不同来源不能冒充", () => {
  const global = { name: "demo", filePath: "/global/demo/SKILL.md", install: { package: "owner/a@demo", scope: "global" } };
  const project = { ...global, filePath: "/project/demo/SKILL.md", install: { package: "owner/a@demo", scope: "project" } };
  assert.equal(findInstalledCatalogSkill([global, project], "owner/a@demo", "project"), project);
  assert.equal(findInstalledCatalogSkill([global], "owner/b@demo", "global"), undefined);
  assert.equal(findInstalledCatalogSkill([global], "owner/a@demo", "project"), global);
});

test("路径保留前后并紧凑展示，原路径保持完整", () => {
  const path = "C:\\Users\\someone\\AppData\\Roaming\\Pi Imagin\\agent\\skills";
  assert.match(compactDisplayPath(path), /^C:.*….*agent\\skills$/);
  assert.equal(compactDisplayPath("/short/path"), "/short/path");
  assert.ok(path.includes("AppData"));
});
