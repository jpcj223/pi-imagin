import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-skills-scope-")));
const agent = join(root, "agent"), home = join(root, "home"), parent = join(root, "workspaces");
const daily = join(parent, "20261024"), project = join(root, "project");
const keys = ["PI_CODING_AGENT_DIR", "USERPROFILE", "HOME", "PI_IMAGIN_DESKTOP_DEV", "PI_IMAGIN_DESKTOP_DEV_WORKSPACE"];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
Object.assign(process.env, { PI_CODING_AGENT_DIR: agent, USERPROFILE: home, HOME: home, PI_IMAGIN_DESKTOP_DEV: "1", PI_IMAGIN_DESKTOP_DEV_WORKSPACE: parent });
for (const folder of [agent, home, daily, project]) mkdirSync(folder, { recursive: true });
after(() => {
  for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  rmSync(root, { recursive: true, force: true });
});
function skill(base, name, description) {
  const folder = join(base, name); mkdirSync(folder, { recursive: true });
  const file = join(folder, "SKILL.md");
  writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\nInstructions\n`);
  return file;
}
const globalFile = skill(join(agent, "skills"), "find-skills", "Current global copy");
skill(join(home, ".pi/agent/skills"), "find-skills", "Old CLI copy");
const dailyFile = skill(join(daily, ".pi/skills"), "find-skills", "Old daily copy");
const projectFile = skill(join(project, ".pi/skills"), "project-only", "Real project skill");
writeFileSync(join(agent, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "find-skills": { source: "fixture/catalog", sourceType: "github", piImaginInstalled: true } } }));
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { loadSkillsWithInstallInfo } = await jiti.import("./skills-service.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
allowFileRoot(project); allowFileRoot(daily);

test("全局及默认日期列表都使用公共安装，不误认同名日期副本为全局技能", async () => {
  for (const cwd of [null, daily]) {
    const result = await loadSkillsWithInstallInfo(cwd);
    const skill = result.skills.find(skill => skill.name === "find-skills");
    assert.equal(skill.filePath, globalFile);
    assert.equal(skill.sourceInfo.scope, "user");
    assert.equal(skill.install.scope, "global");
    assert.equal(skill.installOrigin, "app");
    assert.equal(result.projectResourcesLoaded, false);
    assert.ok(!result.skills.some(skill => skill.filePath === dailyFile));
  }
});

test("真实项目技能保持项目范围，未授权时不加载", async () => {
  assert.ok(!(await loadSkillsWithInstallInfo(project)).skills.some(skill => skill.filePath === projectFile));
  new ProjectTrustStore(agent).set(project, true);
  const result = await loadSkillsWithInstallInfo(project);
  assert.equal(result.skills.find(skill => skill.filePath === projectFile).sourceInfo.scope, "project");
  assert.equal(result.skills.find(skill => skill.name === "find-skills").sourceInfo.scope, "user");
});

test("全局安装验证不受当前项目同名副本遮蔽，返回正确安装记录", async () => {
  skill(join(project, ".pi/skills"), "find-skills", "Separate project copy");
  const stub = join(root, "installed-skill.ts");
  // 只替换下载过程；服务端校验和实际资源发现沿用真实实现。
  writeFileSync(stub, 'export async function installSkillPackage() { return { stdout: "Installed", stderr: "", names: ["find-skills"] }; }');
  const routeJiti = createJiti(import.meta.url, { alias: { "@": process.cwd(), "@/lib/skill-install": stub } });
  const { POST } = await routeJiti.import("../app/api/skills/install/route.ts");
  const response = await POST(new Request("http://localhost/api/skills/install", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ package: "fixture/catalog@find-skills", scope: "global", cwd: project }),
  }));
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  const installed = data.skills.find(skill => skill.name === "find-skills");
  assert.equal(installed.filePath, globalFile);
  assert.equal(installed.install.scope, "global");
});
