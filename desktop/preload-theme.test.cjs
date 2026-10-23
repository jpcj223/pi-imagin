/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");

test("原生按钮颜色等待圆形扩散完成；无动画时立即同步", () => {
  const events = {}, observers = [], frames = new Map(), sent = [], heights = [];
  let nextFrame = 0;
  const root = { dataset: { theme: "light" }, style: { setProperty: (...args) => heights.push(args) } };
  const titlebar = { getBoundingClientRect: () => ({ height: 36 }) };
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(_node, options) { this.options = options; }
    disconnect() {}
  }
  runInNewContext(readFileSync(require.resolve("./preload.cjs"), "utf8"), {
    require: () => ({ contextBridge: { exposeInMainWorld() {} }, ipcRenderer: { send: (...args) => sent.push(args) } }),
    window: { location: { protocol: "http:" }, addEventListener: (name, callback) => { events[name] = callback; }, removeEventListener() {} },
    document: { documentElement: root, querySelector: name => name === ".workspace-titlebar" ? titlebar : null },
    ResizeObserver: Observer, MutationObserver: Observer,
    getComputedStyle: () => root.dataset.theme === "dark" ? { backgroundColor: "rgb(34, 34, 34)", color: "rgb(200, 200, 200)" } : { backgroundColor: "rgb(247, 248, 249)", color: "rgb(119, 129, 140)" },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id), setTimeout() {}, clearTimeout() {},
  });
  const draw = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  events.DOMContentLoaded(); draw();
  assert.equal(sent.at(-1)[1].color, "#f7f8f9");
  const observer = observers.find(item => item.options?.attributeFilter?.includes("data-theme"));
  assert.ok(observer.options.attributeFilter.includes("data-theme-transition"));
  const count = sent.length;
  root.dataset.themeTransition = "true"; root.dataset.theme = "dark";
  observer.callback(); draw();
  assert.equal(sent.length, count, "动画期间维持原生按钮旧色，仍更新真实高度");
  assert.equal(heights.at(-1)[1], "36px");
  delete root.dataset.themeTransition; observer.callback(); draw();
  assert.equal(sent.at(-1)[1].color, "#222222");
  assert.equal(sent.at(-1)[1].symbolColor, "#c8c8c8");
  root.dataset.theme = "light"; observer.callback(); draw();
  assert.equal(sent.at(-1)[1].color, "#f7f8f9");
});
