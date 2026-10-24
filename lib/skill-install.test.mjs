import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-skill-publish-test-"));
const agent = join(root, "app-agent"), home = join(root, "home");
const old = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
Object.assign(process.env, { PI_CODING_AGENT_DIR: agent, USERPROFILE: home, HOME: home });
mkdirSync(home, { recursive: true });
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { installSkillPackage } = await jiti.import("./skill-install.ts");
const { loadSkillsWithInstallInfo } = await jiti.import("./skills-service.ts");
const { removeSkillFiles, skillRemovalTarget } = await jiti.import("./skill-removal.ts");

after(() => {
  for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(root, { recursive: true, force: true });
});

function produce(cwd, name, legacy = false) {
  const folder = join(cwd, legacy ? ".pi" : ".agents", "skills", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), `---\nname: ${name}\ndescription: Fixture ${name}\n---\n# ${name}\n`);
  writeFileSync(join(cwd, "skills-lock.json"), JSON.stringify({ version: 1, skills: { [name]: { source: "fixture/catalog", sourceType: "github", skillFolderHash: name } } }));
}

test("A/B/C 下载同时进行，发布后文件和安装记录完整且立即可发现", async () => {
  const started = [], stages = [];
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const run = async (args, { cwd }) => {
    started.push(args[2]); stages.push(cwd);
    if (started.length === 3) release();
    await barrier;
    const name = args[2].split("@")[1];
    produce(cwd, name);
    return { stdout: "Installation complete", stderr: "" };
  };
  await Promise.all(["a", "b", "c"].map(name => installSkillPackage(`fixture/catalog@${name}`, "global", undefined, run)));
  assert.equal(started.length, 3);
  assert.equal(new Set(stages).size, 3);
  assert.ok(stages.every(path => !existsSync(path)), "临时下载目录已经清理");
  const record = JSON.parse(readFileSync(join(agent, "skills-lock.json"), "utf8"));
  assert.deepEqual(Object.keys(record.skills).sort(), ["a", "b", "c"]);
  const result = await loadSkillsWithInstallInfo(null);
  for (const name of ["a", "b", "c"]) {
    const skill = result.skills.find(skill => skill.name === name);
    assert.ok(skill, `${name} 出现在已安装列表`);
    assert.equal(skill.install.package, `fixture/catalog@${name}`);
    assert.equal(skill.installOrigin, "app");
    assert.equal(skill.canRemove, true);
  }
});

test("重复目标不覆盖已存在文件，失败不删除其他任务的成果", async () => {
  const path = join(agent, "skills", "a", "SKILL.md");
  const before = readFileSync(path, "utf8");
  await assert.rejects(installSkillPackage("fixture/catalog@a", "global", undefined, async (_args, { cwd }) => {
    produce(cwd, "a", true); return { stdout: "", stderr: "" };
  }), /already exists/);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.ok(existsSync(join(agent, "skills", "b", "SKILL.md")));
});

test("自定义应用目录仍能发现旧 CLI 全局目录中的技能", async () => {
  const folder = join(home, ".pi", "agent", "skills", "legacy");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), "---\nname: legacy\ndescription: Legacy CLI skill\n---\n# Legacy");
  const result = await loadSkillsWithInstallInfo(null);
  const skill = result.skills.find(item => item.name === "legacy");
  assert.ok(skill);
  assert.equal(skill.sourceInfo.scope, "user");
});

test("项目安装独立合并记录，不改写全局目录", async () => {
  const project = join(root, "project"); mkdirSync(project);
  await installSkillPackage("fixture/catalog@local", "project", project, async (_args, { cwd }) => {
    produce(cwd, "local"); return { stdout: "", stderr: "" };
  });
  assert.ok(existsSync(join(project, ".pi", "skills", "local", "SKILL.md")));
  assert.ok(!existsSync(join(agent, "skills", "local")));
  assert.equal(JSON.parse(readFileSync(join(project, "skills-lock.json"), "utf8")).skills.local.source, "fixture/catalog");
});

test("删除独立技能只移除所选目录，插件和任意外部文件不能当成独立技能删除", async () => {
  const data = await loadSkillsWithInstallInfo(null);
  const a = data.skills.find(skill => skill.name === "a");
  removeSkillFiles(a, agent);
  assert.ok(!existsSync(a.filePath));
  assert.ok(existsSync(join(agent, "skills", "b", "SKILL.md")));
  assert.equal(skillRemovalTarget({ ...a, filePath: join(root, "outside", "SKILL.md") }, agent), null);
  assert.equal(skillRemovalTarget({ ...a, sourceInfo: { source: "npm:fixture-plugin" } }, agent), null);
});

test("删除接口校验来源和精确发现路径，成功后返回最新列表", async () => {
  const { DELETE } = await jiti.import("../app/api/skills/route.ts");
  const request = (body, origin) => new Request("http://localhost/api/skills", {
    method: "DELETE", headers: { host: "localhost", "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
  });
  assert.equal((await DELETE(request({ filePath: join(root, "outside.md") }))).status, 404);
  assert.equal((await DELETE(request({ filePath: join(agent, "skills", "b", "SKILL.md") }, "https://untrusted.invalid"))).status, 403);
  const response = await DELETE(request({ filePath: join(agent, "skills", "c", "SKILL.md") }));
  assert.equal(response.status, 200);
  assert.ok(!(await response.json()).skills.some(skill => skill.name === "c"));
  assert.equal(JSON.parse(readFileSync(join(agent, "skills-lock.json"), "utf8")).skills.c, undefined);
  assert.ok(existsSync(join(agent, "skills", "b", "SKILL.md")));
});

test("更新复用隔离下载并替换目标，保留其他技能的安装记录", async () => {
  await installSkillPackage("fixture/catalog@b", "global", undefined, async (_args, { cwd }) => {
    produce(cwd, "b");
    writeFileSync(join(cwd, ".agents", "skills", "b", "SKILL.md"), "---\nname: b\ndescription: Updated B\n---\nUpdated instructions");
    return { stdout: "", stderr: "" };
  }, { replace: true });
  assert.match(readFileSync(join(agent, "skills", "b", "SKILL.md"), "utf8"), /Updated instructions/);
  const record = JSON.parse(readFileSync(join(agent, "skills-lock.json"), "utf8"));
  assert.ok(record.skills.b);
  assert.ok(record.skills.a, "更新不能清空其他来源的记录");
});
