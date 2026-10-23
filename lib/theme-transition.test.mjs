import assert from "node:assert/strict";
import test from "node:test";
import { cancelThemeTransition, runThemeTransition } from "./theme-transition.ts";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("主题快照完成前保留同步标记，快速切换时只有最新选择生效", async () => {
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  const transitions = [], animations = [], applied = [];
  const root = { dataset: {}, animate: (frames, options) => {
    const animation = { frames, options, cancel() { this.cancelled = true; } };
    animations.push(animation); return animation;
  } };
  globalThis.window = { innerWidth: 1200, innerHeight: 800, matchMedia: () => ({ matches: false }) };
  globalThis.document = { documentElement: root, startViewTransition: update => {
    const ready = deferred(), finished = deferred();
    const transition = { ready: ready.promise, finished: finished.promise, update,
      show() { update(); ready.resolve(); }, finish: finished.resolve,
      skipTransition() { this.skipped = true; ready.reject(new Error("skipped")); finished.resolve(); },
    };
    transitions.push(transition); return transition;
  } };
  try {
    runThemeTransition(() => applied.push("obsolete"));
    assert.equal(root.dataset.themeTransition, "true");
    runThemeTransition(() => applied.push("dark"));
    transitions[0].update();
    transitions[1].show(); await Promise.resolve();
    assert.deepEqual(applied, ["dark"]);
    assert.equal(root.dataset.themeTransition, "true", "旧动画结束不得清除新动画标记");
    assert.equal(animations[0].frames.clipPath[0], "circle(0% at 50% 50%)");
    assert.equal(animations[0].options.pseudoElement, "::view-transition-new(root)");
    assert.equal(animations[0].options.duration, 450);
    transitions[1].finish(); await Promise.resolve();
    assert.equal(root.dataset.themeTransition, undefined);

    runThemeTransition(() => applied.push("light"), { x: 25, y: 40 });
    transitions[2].show(); await Promise.resolve();
    assert.equal(animations[1].frames.clipPath[0], `circle(0% at ${25 / 1200 * 100}% 5%)`);
    cancelThemeTransition(); await Promise.resolve();
    assert.equal(animations[1].cancelled, true);
    assert.equal(root.dataset.themeTransition, undefined);

    window.matchMedia = () => ({ matches: true });
    runThemeTransition(() => applied.push("reduce"));
    assert.equal(transitions.length, 3);
    assert.equal(applied.at(-1), "reduce");
    window.matchMedia = () => ({ matches: false });
    document.startViewTransition = () => { throw new Error("not available"); };
    runThemeTransition(() => applied.push("fallback"));
    assert.equal(applied.at(-1), "fallback");
    assert.equal(root.dataset.themeTransition, undefined);
    delete document.startViewTransition;
    runThemeTransition(() => applied.push("legacy"));
    assert.equal(applied.at(-1), "legacy");
  } finally {
    cancelThemeTransition();
    globalThis.document = oldDocument; globalThis.window = oldWindow;
  }
});
