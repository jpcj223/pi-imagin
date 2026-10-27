import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-imagin-skill-content-"));
const agentDir = join(root, "agent");
const skillsDir = join(agentDir, "skills");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const skillPath = join(skillsDir, "preview", "SKILL.md");
const skillContent = "---\nname: preview\ndescription: Preview skill\n---\n\n# Preview\n\n- formatted\n";
await mkdir(join(skillsDir, "preview"), { recursive: true });
await writeFile(skillPath, skillContent);

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
allowFileRoot(process.cwd());
const { GET } = await jiti.import("./route.ts");

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

function getContent(filePath, cwd = process.cwd()) {
  const url = new URL("http://localhost/api/skills/content");
  url.searchParams.set("cwd", cwd);
  url.searchParams.set("filePath", filePath);
  return GET(new Request(url));
}

test("returns the complete file for a skill loaded by the runtime resource loader", async () => {
  const response = await getContent(skillPath);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { content: skillContent });
});

test("refuses a Markdown file that is not a loaded skill", async () => {
  const outsidePath = join(root, "outside.md");
  await writeFile(outsidePath, "# not a skill\n");

  const response = await getContent(outsidePath);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Skill not found" });
});

test("无项目时可读取已发现的全局技能，文件路径仍必填", async () => {
  const withoutCwd = await GET(new Request(`http://localhost/api/skills/content?filePath=${encodeURIComponent(skillPath)}`));
  const withoutFile = await GET(new Request(`http://localhost/api/skills/content?cwd=${encodeURIComponent(process.cwd())}`));
  assert.equal(withoutCwd.status, 200);
  assert.equal(withoutFile.status, 400);
});

test("无项目模式不能加载 agentDir 的项目技能或读取任意 Markdown", async () => {
  const hidden = join(agentDir, ".pi", "skills", "hidden", "SKILL.md");
  await mkdir(join(agentDir, ".pi", "skills", "hidden"), { recursive: true });
  await writeFile(hidden, "---\nname: hidden\ndescription: Must not load\n---\nPRIVATE");
  const response = await GET(new Request(`http://localhost/api/skills/content?filePath=${encodeURIComponent(hidden)}`));
  assert.equal(response.status, 404);
});

test("技能引用可打开嵌套文档，拒绝路径跳转、非 Markdown 和越界链接", async () => {
  const skillDir = join(skillsDir, "preview");
  await mkdir(join(skillDir, "references"), { recursive: true });
  await writeFile(join(skillDir, "references", "说明.md"), "# 引用正文");
  const request = document => GET(new Request("http://localhost/api/skills/content?" + new URLSearchParams({ filePath: skillPath, document })));
  const response = await request("references/说明.md");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { content: "# 引用正文" });
  for (const document of ["../outside.md", "/outside.md", "C:/outside.md", "references\\说明.md"]) {
    assert.equal((await request(document)).status, 400, document);
  }
  assert.equal((await request("missing.md")).status, 404);
  assert.equal((await request("references/说明.txt")).status, 415);
  const outside = join(root, "outside-docs");
  await mkdir(outside);
  await writeFile(join(outside, "private.md"), "PRIVATE");
  await symlink(outside, join(skillDir, "escape"), process.platform === "win32" ? "junction" : "dir");
  assert.equal((await request("escape/private.md")).status, 403);
});
