import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

test("仅桌面生产构建关闭全入口预加载，普通网页保持框架默认", async t => {
  const previous = process.env.PI_IMAGIN_DESKTOP_BUILD;
  t.after(() => { if (previous === undefined) delete process.env.PI_IMAGIN_DESKTOP_BUILD; else process.env.PI_IMAGIN_DESKTOP_BUILD = previous; });
  for (const desktop of [false, true]) {
    if (desktop) process.env.PI_IMAGIN_DESKTOP_BUILD = "1"; else delete process.env.PI_IMAGIN_DESKTOP_BUILD;
    const { default: config } = await import(`../next.config.ts?startup-desktop=${desktop}`);
    assert.equal(config.experimental.preloadEntriesOnStart, desktop ? false : undefined);
    assert.equal(config.output, desktop ? "standalone" : undefined);
  }
});

test("桌面 instrumentation 首屏前既不加载 SDK，也不导入外部命令模块", async t => {
  const root = mkdtempSync(join(tmpdir(), "pi-startup-order-"));
  const oldDesktop = process.env.PI_IMAGIN_DESKTOP;
  const oldInfo = console.info;
  const watched = ["message", "disconnect", "SIGINT", "SIGTERM"];
  const listeners = new Map(watched.map(name => [name, new Set(process.listeners(name))]));
  const trace = [];
  globalThis.__piStartupTestTrace = trace;
  process.env.PI_IMAGIN_DESKTOP = "1";
  console.info = () => {};
  t.after(() => {
    for (const name of watched) for (const listener of process.listeners(name)) if (!listeners.get(name).has(listener)) process.off(name, listener);
    console.info = oldInfo;
    if (oldDesktop === undefined) delete process.env.PI_IMAGIN_DESKTOP; else process.env.PI_IMAGIN_DESKTOP = oldDesktop;
    delete globalThis.__piStartupTestTrace;
    rmSync(root, { recursive: true, force: true });
  });
  const stubs = {
    "http-dispatcher": "exports.configureHttpDispatcher=()=>{}; exports.readHttpIdleTimeoutMs=()=>undefined;",
    "agent-event-stream": "exports.closeAllAgentEventStreams=()=>{};",
    "sdk-loader": "exports.loadSdk=async()=>{globalThis.__piStartupTestTrace.push('sdk');};",
    "pi-command": "globalThis.__piStartupTestTrace.push('command-import'); exports.initializeExternalPiCommand=async()=>{globalThis.__piStartupTestTrace.push('command-initialize');};",
  };
  const alias = { "@/lib/sdk-preload": fileURLToPath(new URL("./sdk-preload.ts", import.meta.url)) };
  for (const [name, source] of Object.entries(stubs)) {
    const file = join(root, `${name}.cjs`); writeFileSync(file, source); alias[`@/lib/${name}`] = file;
  }
  const { registerNodeInstrumentation } = await createJiti(import.meta.url, { alias }).import("../instrumentation-node.ts");
  registerNodeInstrumentation();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(trace, [], "健康接口和首屏之前不能启动任一后台任务");
  process.emit("message", { type: "pi-imagin:backend-ready" });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(trace, [], "后台可连接不等于首屏已完成");
  process.emit("message", { type: "pi-imagin:workspace-loaded" });
  process.emit("message", { type: "pi-imagin:workspace-loaded" });
  for (let i = 0; i < 100 && trace.length < 3; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(trace, ["sdk", "command-import", "command-initialize"]);
});
