import test from "node:test";
import assert from "node:assert/strict";
import { observeChatViewport } from "./chat-viewport-resize.ts";

test("终端打开、拖动和全屏还原保持底部或历史阅读位置", t => {
  let resize, scroll, stopped = false;
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() { stopped = true; } };
  t.after(() => { globalThis.ResizeObserver = previous; });
  const container = { clientHeight: 600, clientWidth: 800, scrollHeight: 2000, scrollTop: 1400,
    addEventListener(_, callback) { scroll = callback; }, removeEventListener() {} };
  let adjusted = 0;
  const stop = observeChatViewport(container, () => adjusted++);
  container.clientHeight = 350; resize();
  assert.equal(container.scrollTop, 1650);
  container.scrollTop = 420; scroll();
  container.clientHeight = 250; resize();
  assert.equal(container.scrollTop, 420);
  container.clientHeight = 0; resize();
  container.scrollTop = 0; scroll();
  container.clientHeight = 350; resize();
  assert.equal(container.scrollTop, 420);
  container.scrollTop = 1650; scroll();
  container.clientHeight = 600; resize();
  assert.equal(container.scrollTop, 1400);
  assert.equal(adjusted, 4);
  stop(); assert.equal(stopped, true);
});
