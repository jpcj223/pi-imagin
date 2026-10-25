import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, ProjectTrustStore, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// 所有配置、进程与模型均来自隔离夹具，不接触用户服务器或凭据。
const agentDir = await mkdtemp(join(tmpdir(), "pi-imagin-mcp-switch-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(() => rm(agentDir, { recursive: true, force: true }));
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper, startRpcSession } = await jiti.import("./rpc-manager.ts");
const { createPiImaginBuiltinExtensions, preferPiImaginMcpExtension } = await jiti.import("./builtin-extensions.ts");
const { writeMcpRuntimeEnabled } = await jiti.import("./mcp-runtime-settings.ts");
const { requestMcpRuntimeRefresh, requestMcpServerRefresh, readMcpRuntimeApplication } = await jiti.import("./mcp-runtime-sessions.ts");
const { readMcpOverview } = await jiti.import("./mcp-config-read.ts");
const fixture = { command: process.execPath, args: [fileURLToPath(new URL("./__fixtures__/mcp-env-server.mjs", import.meta.url))], exposure: "direct" };

async function waitFor(condition) {
  const end = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > end) throw new Error("MCP runtime condition timed out");
    await delay(20);
  }
}

async function setup(t, { projectOff = false, adapter = false } = {}) {
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ extensions: ["-builtin:mcp"] }));
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { fixture, off: { ...fixture, enabled: false } } }));
  const cwd = await mkdtemp(join(tmpdir(), "pi-imagin-mcp-switch-cwd-"));
  if (projectOff) {
    await mkdir(join(cwd, ".pi"));
    await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify({ extensions: ["-builtin:mcp"] }));
    new ProjectTrustStore(agentDir).set(cwd, true);
  }
  const paths = [];
  if (adapter) {
    const dir = join(cwd, adapter === "custom" ? "custom-mcp" : "pi-mcp-adapter"); await mkdir(dir);
    const path = join(dir, "index.mjs");
    await writeFile(path, 'export default pi => { for (const name of ["mcp", "mcp-adapter", "mcp-auth"]) pi.registerCommand(name, { description: "legacy adapter", handler: async () => {} }); };');
    paths.push(path);
  }
  const faux = fauxProvider({ models: [{ id: "switch-test" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const { extensions, mcpHost } = await createPiImaginBuiltinExtensions({ agentDir });
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, extensionFactories: extensions,
    additionalExtensionPaths: paths, extensionsOverride: preferPiImaginMcpExtension,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model: faux.getModel("switch-test"),
    sessionManager: SessionManager.inMemory(cwd), settingsManager, resourceLoader });
  const wrapper = new AgentSessionWrapper(session, { mcpHost });
  wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  const previous = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[wrapper.sessionId, wrapper]]);
  t.after(async () => { globalThis.__piSessions = previous; await wrapper.shutdown(); await rm(cwd, { recursive: true, force: true }); });
  return { wrapper, session, mcpHost, faux };
}

test("enabling reloads an idle session and connects live tools without running a test or model", async t => {
  const { wrapper, session, mcpHost, faux } = await setup(t, { adapter: true });
  assert.deepEqual(mcpHost.serverStates(), []);
  assert.ok(session.extensionRunner.getRegisteredCommands().some(command => command.sourceInfo.path.includes("pi-mcp-adapter")), "关闭内置 MCP 时仍保留适配插件");
  await writeMcpRuntimeEnabled(true);
  requestMcpRuntimeRefresh();
  assert.equal(readMcpRuntimeApplication().pending, 1);
  await waitFor(() => wrapper.mcpRuntimeApplication() === "ready");
  await waitFor(() => mcpHost.serverStates().some(server => server.name === "fixture" && server.state === "ready"));
  assert.equal(faux.state.callCount, 0);
  assert.ok(!mcpHost.serverStates().some(server => server.name === "off" && server.state === "ready"));
  const commands = session.extensionRunner.getRegisteredCommands();
  assert.ok(commands.some(command => command.invocationName === "mcp" && command.sourceInfo.path === "builtin:mcp"));
  assert.ok(!commands.some(command => command.sourceInfo.path.includes("pi-mcp-adapter")));
  const listed = (await readMcpOverview({ agentDir })).servers.find(server => server.name === "fixture");
  assert.equal(listed.status.origin, "session"); assert.equal(listed.status.state, "connected");
  assert.equal(listed.status.toolCount, 4);
  assert.deepEqual(listed.status.tools.map(tool => tool.name), ["env_has", "env_get", "spawn_child", "record"]);
  assert.equal(listed.status.tools[0].readOnly, true);
  assert.equal(listed.status.tools[0].exposure, "direct");
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("mcp__fixture__record", { note: "live after switch" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  await wrapper.send({ type: "prompt", message: "call the fixture" });
  await waitFor(() => !wrapper.isRunning());
  const result = session.messages.find(message => message.role === "toolResult" && message.toolName === "mcp__fixture__record");
  assert.equal(result.isError, false);
  assert.match(JSON.stringify(result.content), /live after switch/);
  await writeMcpRuntimeEnabled(false); requestMcpRuntimeRefresh();
  await waitFor(() => wrapper.mcpRuntimeApplication() === "ready");
  assert.deepEqual(mcpHost.serverStates(), []);
  assert.ok(!session.getAllTools().some(tool => tool.name.startsWith("mcp__")));
});

test("global enable preserves a trusted project's explicit disable", async t => {
  const { wrapper, mcpHost } = await setup(t, { projectOff: true });
  await writeMcpRuntimeEnabled(true); requestMcpRuntimeRefresh();
  await waitFor(() => wrapper.mcpRuntimeApplication() === "ready");
  assert.deepEqual(mcpHost.serverStates(), []);
});

test("a busy session defers the refresh and keeps its task intact", async t => {
  const { wrapper, mcpHost } = await setup(t);
  // 模拟正在接收提示词的窗口；和真实 send 的任务结束路径共用 finally。
  wrapper.pendingPromptCount = 1;
  await writeMcpRuntimeEnabled(true); requestMcpRuntimeRefresh();
  await delay(60);
  assert.equal(wrapper.mcpRuntimeApplication(), "pending");
  assert.deepEqual(mcpHost.serverStates(), []);
  wrapper.pendingPromptCount = 0;
  await wrapper.send({ type: "get_state" });
  await waitFor(() => wrapper.mcpRuntimeApplication() === "ready");
  await waitFor(() => mcpHost.serverStates().some(server => server.state === "ready"));
});

test("unrelated /mcp extensions are not silently removed", () => {
  const builtin = { path: "builtin:mcp", commands: new Map([["mcp", {}]]) };
  const custom = { path: "/custom/mcp/index.ts", commands: new Map([["mcp", {}]]) };
  const base = { extensions: [builtin, custom], errors: [], runtime: {} };
  assert.equal(preferPiImaginMcpExtension(base), base);
});

test("an extension that still owns MCP is reported as an application failure, not a successful connection", async t => {
  const { wrapper, mcpHost } = await setup(t, { adapter: "custom" });
  await writeMcpRuntimeEnabled(true); requestMcpRuntimeRefresh();
  await waitFor(() => wrapper.mcpRuntimeApplication() === "failed");
  assert.equal(readMcpRuntimeApplication().failed, 1);
  assert.deepEqual(mcpHost.serverStates(), []);
});

test("a normal runtime opened after explicit enable connects without a prompt", async t => {
  await writeMcpRuntimeEnabled(true);
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { fixture } }));
  const cwd = await mkdtemp(join(tmpdir(), "pi-imagin-mcp-enabled-start-"));
  const { session: wrapper } = await startRpcSession("__mcp-enabled-start__", "", cwd);
  t.after(async () => { await wrapper.shutdown(); await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  await waitFor(() => wrapper.inner.getAllTools().some(tool => tool.name === "mcp__fixture__record"));
  assert.equal(wrapper.inner.messages.filter(message => message.role === "user").length, 0);
});


test("saved switches sync live tools; reconnect changes only the exact entry and off choices survive the gate", async t => {
  const { wrapper, session, mcpHost } = await setup(t);
  const path = join(agentDir, "mcp.json");
  await writeMcpRuntimeEnabled(true); requestMcpRuntimeRefresh();
  await waitFor(() => mcpHost.serverStates().some(s => s.name === "fixture" && s.state === "ready"));
  const original = (await readMcpOverview({ agentDir })).servers.find(s => s.name === "fixture");
  const config = JSON.parse(await readFile(path, "utf8"));
  config.mcpServers.off.enabled = true;
  await writeFile(path, JSON.stringify(config)); requestMcpServerRefresh();
  await waitFor(() => mcpHost.serverStates().some(s => s.name === "off" && s.state === "ready"));
  const stable = (await readMcpOverview({ agentDir })).servers.find(s => s.name === "off").status.updatedAt;
  assert.equal(requestMcpServerRefresh({ cwd: join(agentDir, "other-project") }), 0);
  assert.equal(requestMcpServerRefresh({ target: { scope: original.scope, name: original.name,
    sourcePath: original.sourcePath, configKey: original.configKey } }), 1);
  await waitFor(() => wrapper.mcpRuntimeApplication() === "ready");
  await waitFor(() => mcpHost.serverStates().some(s => s.name === "fixture" && s.state === "ready"));
  assert.equal((await readMcpOverview({ agentDir })).servers.find(s => s.name === "off").status.updatedAt, stable);
  assert.ok(session.getAllTools().some(s => s.name === "mcp__fixture__record"));
  config.mcpServers.off.enabled = false;
  await writeFile(path, JSON.stringify(config)); requestMcpServerRefresh();
  await waitFor(() => wrapper.mcpRuntimeApplication() === "ready");
  await waitFor(() => !session.getActiveToolNames().some(name => name.startsWith("mcp__off__")));
  await writeMcpRuntimeEnabled(false); requestMcpRuntimeRefresh();
  await waitFor(() => wrapper.mcpRuntimeApplication() === "ready");
  await writeMcpRuntimeEnabled(true); requestMcpRuntimeRefresh();
  await waitFor(() => wrapper.mcpRuntimeApplication() === "ready");
  await waitFor(() => mcpHost.serverStates().some(s => s.name === "fixture" && s.state === "ready"));
  assert.ok(!mcpHost.serverStates().some(s => s.name === "off"));
  // 正在忙碌时先请求重连，再关闭总开关：按最后保存的关闭状态应用。
  wrapper.pendingPromptCount = 1;
  requestMcpServerRefresh({ target: { scope: original.scope, name: original.name, sourcePath: original.sourcePath, configKey: original.configKey } });
  await writeMcpRuntimeEnabled(false); requestMcpRuntimeRefresh();
  wrapper.pendingPromptCount = 0;
  await wrapper.send({ type: "get_state" });
  await waitFor(() => wrapper.mcpRuntimeApplication() === "ready");
  assert.deepEqual(mcpHost.serverStates(), []);
});
