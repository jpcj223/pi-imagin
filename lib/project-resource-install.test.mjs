import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { installProjectResource } = await jiti.import("./project-resource-install.ts");
const { getProjectTrustStatus } = await jiti.import("./project-trust.ts");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-resource-install-"));
  const cwd = join(root, "project"), agentDir = join(root, "agent");
  await mkdir(cwd); await mkdir(agentDir);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { cwd, agentDir };
}

test("空白项目首次安装后仍可加载，安装失败撤回本次信任", async t => {
  const { cwd, agentDir } = await fixture(t);
  await assert.rejects(installProjectResource(cwd, agentDir, async () => { throw new Error("download failed"); }), /download failed/);
  assert.equal(getProjectTrustStatus(cwd, agentDir).decision, null);
  const value = await installProjectResource(cwd, agentDir, async () => {
    await mkdir(join(cwd, ".pi", "skills", "fixture"), { recursive: true });
    await writeFile(join(cwd, ".pi", "skills", "fixture", "SKILL.md"), "---\nname: fixture\ndescription: test\n---\nInstructions");
    return "installed";
  });
  assert.equal(value, "installed");
  assert.equal(getProjectTrustStatus(cwd, agentDir).trusted, true);
  assert.equal(getProjectTrustStatus(cwd, agentDir).decision, true);
});

test("已有未信任项目不因点击安装而自动授权", async t => {
  const { cwd, agentDir } = await fixture(t);
  await mkdir(join(cwd, ".pi")); await writeFile(join(cwd, ".pi", "settings.json"), "{}");
  let writes = 0;
  await assert.rejects(installProjectResource(cwd, agentDir, async () => { writes++; }), /must be trusted/);
  assert.equal(writes, 0);
  assert.equal(await readFile(join(cwd, ".pi", "settings.json"), "utf8"), "{}");
});

test("首次安装不能连带信任项目中的其他未授权仓库", async t => {
  const { cwd, agentDir } = await fixture(t);
  const nested = join(cwd, "nested");
  await mkdir(join(nested, ".pi", "extensions"), { recursive: true });
  await writeFile(join(nested, ".pi", "extensions", "probe.js"), "export default () => {};\n");
  await assert.rejects(installProjectResource(cwd, agentDir, async () => {}), /would also trust/);
  assert.equal(getProjectTrustStatus(nested, agentDir).trusted, false);
});
