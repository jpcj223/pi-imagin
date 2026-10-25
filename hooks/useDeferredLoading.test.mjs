import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { renderHook } from "./__fixtures__/react-hook-shim.mjs";

const jiti = createJiti(import.meta.url, { alias: { react: fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url)) } });
const { useDeferredLoading } = await jiti.import("./useDeferredLoading.ts");

test("快速请求不闪提示；慢请求 200ms 后可见，完成立即清除，卸载取消计时", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hook = renderHook(({ pending }) => useDeferredLoading(pending), { pending: false });
  hook.rerender({ pending: true });
  t.mock.timers.tick(100); hook.flush(); assert.equal(hook.result, false);
  hook.rerender({ pending: false });
  t.mock.timers.tick(300); hook.flush(); assert.equal(hook.result, false);
  hook.rerender({ pending: true });
  t.mock.timers.tick(199); hook.flush(); assert.equal(hook.result, false);
  t.mock.timers.tick(1); hook.flush(); assert.equal(hook.result, true);
  hook.rerender({ pending: false }); assert.equal(hook.result, false);
  hook.rerender({ pending: true }); assert.equal(hook.result, false, "新请求重新计时");
  hook.unmount(); t.mock.timers.tick(300); hook.flush(); assert.equal(hook.result, false);
});
