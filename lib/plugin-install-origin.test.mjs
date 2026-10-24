import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { appPluginSources, recordAppPlugin } = await jiti.import("./plugin-install-origin.ts");
const { folderDisplayKey, folderDisplayName } = await jiti.import("./project-folder-display.ts");

test("安装来源按精确来源和全局/项目隔离，并发写入不丢记录", async t => {
  const root = mkdtempSync(join(tmpdir(), "plugin-origins-")), project = join(root, "project");
  mkdirSync(project); t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(appPluginSources(root).size, 0);
  await Promise.all([recordAppPlugin(root, null, "npm:alpha", true), recordAppPlugin(root, null, "npm:beta", true)]);
  await recordAppPlugin(root, project, "npm:alpha", true);
  assert.deepEqual([...appPluginSources(root)].sort(), ["npm:alpha", "npm:beta"]);
  assert.deepEqual([...appPluginSources(root, project)], ["npm:alpha"]);
  await recordAppPlugin(root, null, "npm:alpha", false);
  assert.equal(appPluginSources(root).has("npm:alpha"), false);
  assert.equal(appPluginSources(root, project).has("npm:alpha"), true);
  writeFileSync(join(root, "plugin-installs.json"), "null");
  assert.equal(appPluginSources(root).size, 0);
});
test("最近路径匹配兼容 Windows 大小写和分隔符，保留 Unix 大小写", () => {
  assert.equal(folderDisplayKey("C:\\团队\\前端\\"), folderDisplayKey("c:/团队/前端"));
  assert.notEqual(folderDisplayKey("/srv/App"), folderDisplayKey("/srv/app"));
  assert.equal(folderDisplayName("C:\\团队\\前端\\"), "前端");
});
