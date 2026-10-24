import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { resourceGroup, resourceSidebarPreference, moveResourceGroup } = await jiti.import("./resource-sidebar.ts");
const { findInstalledCatalogPlugin } = await jiti.import("./plugin-selection.ts");
const { findInstalledCatalogSkill } = await jiti.import("./skill-selection.ts");
const { compactDisplayPath } = await jiti.import("./display-path.ts");

test("初始顺序及折叠；损坏偏好仍补齐分组，排序不改变折叠", () => {
  const initial = resourceSidebarPreference();
  assert.deepEqual(initial, { order: ["global", "external", "project"], collapsed: { global: false, external: true, project: true } });
  const saved = resourceSidebarPreference({ order: ["project", "invalid", "project"], collapsed: { external: false } });
  assert.deepEqual(saved.order, ["project", "global", "external"]);
  assert.equal(saved.collapsed.external, false);
  assert.deepEqual(moveResourceGroup(initial.order, "project", "global"), ["project", "global", "external"]);
  assert.deepEqual(moveResourceGroup(initial.order, "global", "project", true), ["external", "project", "global"]);
  assert.deepEqual(initial.collapsed, { global: false, external: true, project: true });
});

test("来源与项目范围各自识别，项目不会因为应用安装被放到全局", () => {
  assert.equal(resourceGroup("project", "app"), "project");
  assert.equal(resourceGroup("project", "external"), "project");
  assert.equal(resourceGroup("global", "app"), "global");
  assert.equal(resourceGroup("path"), "external");
});

test("插件与技能项目继承全局，优先当前项目；全局不会继承项目且不同身份不混淆", () => {
  const globalPlugin = { scope: "global", source: "npm:demo@1.0", packageName: "demo", status: "installed" };
  const projectPlugin = { ...globalPlugin, scope: "project" };
  assert.equal(findInstalledCatalogPlugin([globalPlugin], "demo", "project"), globalPlugin);
  assert.equal(findInstalledCatalogPlugin([globalPlugin, projectPlugin], "demo", "project"), projectPlugin);
  assert.equal(findInstalledCatalogPlugin([projectPlugin], "demo", "global"), undefined);
  assert.equal(findInstalledCatalogPlugin([{ ...globalPlugin, status: "missing" }], "demo", "project"), undefined);
  assert.equal(findInstalledCatalogPlugin([globalPlugin], "other", "global"), undefined);
  const globalSkill = { name: "demo", install: { scope: "global", package: "owner/a@demo" } };
  const projectSkill = { ...globalSkill, install: { ...globalSkill.install, scope: "project" } };
  assert.equal(findInstalledCatalogSkill([globalSkill], "owner/a@demo", "project"), globalSkill);
  assert.equal(findInstalledCatalogSkill([globalSkill, projectSkill], "owner/a@demo", "project"), projectSkill);
  assert.equal(findInstalledCatalogSkill([projectSkill], "owner/a@demo", "global"), undefined);
  assert.equal(findInstalledCatalogSkill([globalSkill], "owner/b@demo", "project"), undefined);
});

test("路径保留前后，资源路径保留项目名与后缀，窄容器不裁掉末尾", () => {
  const windows = String.raw`D:\Work\02_study\vue3-web\.pi\skills`;
  assert.equal(compactDisplayPath(windows, 30), String.raw`D:\Work\…\vue3-web\.pi\skills`);
  assert.equal(compactDisplayPath("/short/path"), "/short/path");
  for (const path of [windows, "/some/very/long/folder/project/.pi/skills", String.raw`C:\Users\person\very-long-folder-name-for-test\.pi\skills`]) {
    const compact = compactDisplayPath(path, 28);
    assert.ok(compact.includes("…"));
    assert.ok(compact.endsWith("skills"));
    assert.ok(compact.length <= 28, compact);
  }
});

test("极窄路径容器仍遵守预算", () => {
  for (const path of ["/folder/other/very-long-project/.pi/skills", String.raw`\\server\share\very-long-project\.pi\skills`]) {
    assert.ok(compactDisplayPath(path, 12).length <= 12);
  }
});
