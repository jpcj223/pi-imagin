import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { AUXILIARY_TABS, normalizeAuxiliaryTabOrder, moveAuxiliaryTab } = await createJiti(import.meta.url).import("./auxiliary-tabs.ts");
test("标签偏好恢复丢失项，忽略未知值和重复值", () => {
  assert.deepEqual(normalizeAuxiliaryTabOrder(null), [...AUXILIARY_TABS]);
  assert.deepEqual(normalizeAuxiliaryTabOrder(["tools", "tools", "unknown", {}, "outline"]), ["tools", "outline", "files", "history", "system", "session"]);
});
test("标签双向重排保持当前集合，不修改原偏好", () => {
  const order = [...AUXILIARY_TABS];
  assert.deepEqual(moveAuxiliaryTab(order, "tools", "outline"), ["tools", "outline", "files", "history", "system", "session"]);
  assert.deepEqual(moveAuxiliaryTab(order, "outline", "tools"), ["files", "history", "system", "tools", "outline", "session"]);
  assert.deepEqual(order, [...AUXILIARY_TABS]);
});
