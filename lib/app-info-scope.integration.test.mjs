import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("真实 RPC 普通只读会话保留应用查询，仅聊天会话不加载该入口", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-app-info-scope-"));
  const previous = Object.fromEntries(["PI_CODING_AGENT_DIR", "PI_WEB_DISABLE_MCP", "PI_OFFLINE"].map(key => [key, process.env[key]]));
  const wrappers = [];
  t.after(async () => {
    await Promise.all(wrappers.map(wrapper => wrapper.shutdown()));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_WEB_DISABLE_MCP = "1";
  process.env.PI_OFFLINE = "1";
  await writeFile(join(dir, "settings.json"), JSON.stringify({ defaultTools: ["read"] }));
  const { startRpcSession } = await createJiti(import.meta.url).import("./rpc-manager.ts");
  const normal = (await startRpcSession("__new__app-info-readonly", "", dir, { toolNames: ["read"] })).session;
  wrappers.push(normal);
  assert.ok(normal.inner.getActiveToolNames().includes("pi_imagin_info"));
  assert.ok(!normal.inner.getActiveToolNames().some(name => ["write", "edit", "bash", "powershell"].includes(name)));
  const chatOnly = (await startRpcSession("__new__app-info-chat-only", "", dir, { toolNames: [] })).session;
  wrappers.push(chatOnly);
  assert.deepEqual(chatOnly.inner.getActiveToolNames(), []);
  assert.ok(!chatOnly.inner.getAllTools().some(tool => tool.name === "pi_imagin_info"));
});
