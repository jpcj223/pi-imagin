import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isAppDefaultWorkspace } = await jiti.import("./default-workspace.ts");
const { getProjectTrustStatus, projectTrustReloadOptions, mayReadProjectConfigNow } = await jiti.import("./project-trust.ts");

test("默认日期工作区免授权，公共插件技能跨日期加载，普通项目仍受信任控制", async t => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), "pi-default-resources-")));
  const parent = join(root, "workspaces"), agentDir = join(root, "agent");
  const saved = [process.env.PI_IMAGIN_DESKTOP_DEV, process.env.PI_IMAGIN_DESKTOP_DEV_WORKSPACE];
  process.env.PI_IMAGIN_DESKTOP_DEV = "1";
  process.env.PI_IMAGIN_DESKTOP_DEV_WORKSPACE = parent;
  t.after(async () => {
    for (const [i, key] of ["PI_IMAGIN_DESKTOP_DEV", "PI_IMAGIN_DESKTOP_DEV_WORKSPACE"].entries()) {
      if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
    }
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(agentDir, "skills", "shared"), { recursive: true });
  await mkdir(join(agentDir, "extensions"));
  await writeFile(join(agentDir, "skills", "shared", "SKILL.md"), "---\nname: shared\ndescription: Shared skill\n---\n# Shared instructions\n");
  await writeFile(join(agentDir, "extensions", "shared.js"), "export default () => {};\n");
  for (const name of ["20261024", "20261025"]) {
    const cwd = join(parent, name);
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi", "settings.json"), "{}");
    await mkdir(join(cwd, ".pi", "skills", "shared"), { recursive: true });
    await writeFile(join(cwd, ".pi", "skills", "shared", "SKILL.md"), "---\nname: shared\ndescription: Stale daily copy\n---\nOld instructions");
    assert.equal(isAppDefaultWorkspace(cwd, agentDir), true);
    assert.deepEqual(getProjectTrustStatus(cwd, agentDir), { requiresTrust: false, trusted: true, decision: null, inherited: false, defaultWorkspace: true });
    assert.equal(mayReadProjectConfigNow(cwd, agentDir), false);
    const loader = new DefaultResourceLoader({ cwd, agentDir });
    await loader.reload(projectTrustReloadOptions(cwd, agentDir));
    assert.equal(loader.getSkills().skills.find(skill => skill.name === "shared").filePath, join(agentDir, "skills", "shared", "SKILL.md"));
    assert.equal(loader.getExtensions().extensions.some(extension => extension.path.endsWith("shared.js")), true);
  }
  assert.equal(existsSync(join(agentDir, "trust.json")), false, "默认工作区不写信任授权记录");
  const other = join(root, "other-project");
  await mkdir(join(other, ".pi"), { recursive: true });
  await writeFile(join(other, ".pi", "settings.json"), "{}");
  assert.equal(getProjectTrustStatus(other, agentDir).trusted, false);
  assert.equal(await projectTrustReloadOptions(other, agentDir).resolveProjectTrust(), false);
  for (const cwd of [parent, join(parent, "20260230"), join(parent, "20261024", "nested")]) {
    await mkdir(cwd, { recursive: true });
    assert.equal(isAppDefaultWorkspace(cwd, agentDir), false);
  }
  const link = join(parent, "20261026");
  await symlink(other, link, process.platform === "win32" ? "junction" : "dir");
  assert.equal(isAppDefaultWorkspace(link, agentDir), false, "链接到其他项目不能免授权");
  const registered = join(parent, "20261024");
  await writeFile(join(agentDir, "pi-web-session-state.json"), JSON.stringify({ projects: { [registered]: {} } }));
  assert.equal(isAppDefaultWorkspace(registered, agentDir), false, "用户添加的项目仍使用项目规则");
  assert.equal(getProjectTrustStatus(registered, agentDir).trusted, false);
});
