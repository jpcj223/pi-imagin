import assert from "node:assert/strict";
import test from "node:test";
import { newTerminalTab, restoreTerminalTabs } from "./terminal-tab-state.ts";

test("restored workspace tabs retain terminal identity and never request a new shell", () => {
  const first = newTerminalTab("/repo/worktree-a");
  const second = newTerminalTab("/repo/worktree-b");
  assert.notEqual(first.id, second.id);
  const saved = restoreTerminalTabs(JSON.stringify({ tabs: [first, second], activeId: second.id, open: true }));
  assert.deepEqual(saved, {
    tabs: [{ ...first, restored: true }, { ...second, restored: true }],
    activeId: second.id,
    open: true,
  });
});

test("storage corruption cannot create invalid or duplicate terminal tabs", () => {
  assert.deepEqual(restoreTerminalTabs("broken"), { tabs: [], activeId: null, open: false });
  assert.deepEqual(restoreTerminalTabs(null), { tabs: [], activeId: null, open: false });
  const tab = newTerminalTab("/repo");
  const saved = restoreTerminalTabs(JSON.stringify({
    tabs: [null, {}, tab, tab, { ...tab, id: "../../bad" }, { ...tab, cwd: null }],
    activeId: "missing",
  }));
  assert.deepEqual(saved, { tabs: [{ ...tab, restored: true }], activeId: null, open: false });
});

test("同目录多个 Shell 刷新后保留独立终端及首选 Shell", () => {
  const first = newTerminalTab("/repo", "powershell");
  const second = newTerminalTab("/repo", "cmd");
  const restored = restoreTerminalTabs(JSON.stringify({ tabs: [first, second], activeId: second.id, open: true }));
  assert.equal(restored.tabs.length, 2);
  assert.equal(restored.tabs[0].shell, "powershell");
  assert.equal(restored.tabs[1].shell, "cmd");
  assert.equal(restored.activeId, second.id);
  assert.equal(newTerminalTab("/repo", "../bad.exe").shell, undefined);
});

test("新建沿用最后手动选择，复制指定 Shell 不被当前偏好覆盖", t => {
  const previous = globalThis.localStorage;
  let preferred = null;
  globalThis.localStorage = { getItem: () => preferred };
  t.after(() => { globalThis.localStorage = previous; });
  assert.equal(newTerminalTab("/repo").shell, undefined, "首次由服务端系统默认 Shell 决定");
  preferred = "powershell";
  assert.equal(newTerminalTab("/repo").shell, "powershell");
  preferred = "cmd";
  assert.equal(newTerminalTab("/repo").shell, "cmd");
  assert.equal(newTerminalTab("/repo", "powershell").shell, "powershell");
});
