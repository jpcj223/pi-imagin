/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { installBackground } = require("./background.cjs");

function setup({ failingTray = false } = {}) {
  const trays = [];
  let quits = 0, quitting = false;
  class FakeTray extends EventEmitter {
    constructor() { super(); if (failingTray) throw new Error("托盘创建失败"); trays.push(this); }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(menu) { this.menu = menu; }
    destroy() { this.destroyed = true; }
  }
  const window = new EventEmitter();
  Object.assign(window, {
    visible: true, minimized: false, destroyed: false,
    isMinimized() { return this.minimized; },
    isDestroyed() { return this.destroyed; },
    isVisible() { return this.visible; },
    show() { this.visible = true; }, hide() { this.visible = false; },
    restore() { this.minimized = false; }, focus() { this.focused = true; },
    getChildWindows() { return this.children ?? []; },
  });
  const background = installBackground({ app: { quit() { quits++; } }, Tray: FakeTray, Menu: { buildFromTemplate: items => items }, window, icon: __filename, isQuitting: () => quitting });
  return { window, background, get tray() { return trays[0]; }, get quits() { return quits; }, quit: () => { quitting = true; } };
}

test("关闭隐藏窗口并保留同一页面，托盘点击与菜单立即恢复", () => {
  const testApp = setup();
  let prevented = false;
  testApp.window.emit("close", { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(testApp.window.visible, false);
  assert.equal(testApp.background.isHidden(), true);
  assert.equal(testApp.quits, 0);
  testApp.window.minimized = true;
  testApp.tray.emit("click");
  assert.equal(testApp.window.visible, true);
  assert.equal(testApp.window.minimized, false);
  assert.equal(testApp.window.focused, true);
  assert.equal(testApp.background.isHidden(), false);
  testApp.tray.menu[0].click();
  testApp.tray.menu[2].click();
  assert.equal(testApp.quits, 1);
});

test("退出和托盘失败时不拦截关闭，已销毁或退出中的窗口不恢复", () => {
  const testApp = setup();
  testApp.quit();
  testApp.window.emit("close", { preventDefault() { assert.fail("退出不能被隐藏替代"); } });
  testApp.window.hide();
  testApp.background.restore();
  assert.equal(testApp.window.visible, false);
  testApp.background.dispose();
  assert.equal(testApp.tray.destroyed, true);
  assert.equal(testApp.background.available(), false);
  const fallback = setup({ failingTray: true });
  fallback.window.emit("close", { preventDefault() { assert.fail("无托盘时必须允许退出"); } });
  assert.equal(fallback.background.available(), false);
  fallback.window.destroyed = true;
  fallback.window.hide();
  fallback.background.restore();
  assert.equal(fallback.window.visible, false);
});

test("后台同时隐藏子窗口，恢复时不误打开原本隐藏的子窗口", () => {
  const testApp = setup();
  const visible = setup().window, hidden = setup().window;
  hidden.hide();
  testApp.window.children = [visible, hidden];
  testApp.window.emit("close", { preventDefault() {} });
  assert.equal(visible.visible, false);
  testApp.tray.emit("double-click");
  assert.equal(visible.visible, true);
  assert.equal(hidden.visible, false);
});
