import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";
const { WORKSPACE_LAYOUT_INIT_SCRIPT } = await createJiti(import.meta.url).import("./workspace-layout-bootstrap.ts");
function boot(width, preferences = {}, search = "") {
  const properties = new Map(), dataset = {};
  vm.runInNewContext(WORKSPACE_LAYOUT_INIT_SCRIPT, { innerWidth: width, URLSearchParams, location: { search }, localStorage: { getItem: key => preferences[key] ?? null }, document: { documentElement: { style: { setProperty: (key, value) => properties.set(key, value) }, dataset } } });
  return { properties, dataset };
}
test("首帧恢复已存栏宽，超界尺寸按聊天最小宽度限制，移动端默认隐藏右栏", () => {
  const desktop = boot(1440, { "pi-sidebar-width": "220", "pi-right-panel-width": "560" });
  assert.equal(desktop.properties.get("--workspace-initial-right-width"), "560px");
  const narrow = boot(1000, { "pi-sidebar-width": "480", "pi-right-panel-width": "760" });
  assert.equal(parseInt(narrow.properties.get("--workspace-initial-sidebar-width")) + parseInt(narrow.properties.get("--workspace-initial-right-width")), 540);
  assert.equal(boot(390).dataset.workspaceRightOpen, "false");
  assert.equal(boot(1440, { "pi-workspace-right-open": "false" }).dataset.workspaceRightOpen, "false");
  assert.equal(boot(1440, { "pi-right-panel-width": "invalid" }).properties.get("--workspace-initial-right-width"), "330px");
});
