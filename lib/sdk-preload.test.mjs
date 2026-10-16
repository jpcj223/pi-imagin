import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { scheduleSdkPreload } from "./sdk-preload.ts";

test("网页预热保持原行为，不添加进程消息监听", async () => {
  const events = new EventEmitter(); let calls = 0;
  scheduleSdkPreload(false, events, async () => { calls++; });
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(events.listenerCount("message"), 0);
});
test("桌面等待实际首屏消息，仅加载一次并移除监听", async () => {
  const events = new EventEmitter(); let calls = 0;
  scheduleSdkPreload(true, events, async () => { calls++; });
  for (const message of [null, {}, { type:"other" }]) events.emit("message", message);
  await Promise.resolve(); assert.equal(calls, 0);
  events.emit("message", { type:"pi-imagin:workspace-loaded" });
  events.emit("message", { type:"pi-imagin:workspace-loaded" });
  await Promise.resolve(); assert.equal(calls, 1);
  assert.equal(events.listenerCount("message"), 0);
  assert.equal(events.listenerCount("disconnect"), 0);
});
test("首屏前退出或 IPC 断开不启动预热；加载失败不会中断启动", async () => {
  for (const exit of ["message", "disconnect"]) {
    const events = new EventEmitter();
    scheduleSdkPreload(true, events, async () => assert.fail("退出不能启动预热"));
    events.emit(exit, { type:"pi-imagin:prepare-shutdown" });
    events.emit("message", { type:"pi-imagin:workspace-loaded" });
    assert.equal(events.listenerCount("message"), 0);
  }
  scheduleSdkPreload(false, new EventEmitter(), async () => { throw new Error("预热失败"); });
  await new Promise(resolve => setImmediate(resolve));
});
