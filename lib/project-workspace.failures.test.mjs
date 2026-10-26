import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createProjectWorkspaceExtension } = await jiti.import("./project-workspace-extension.ts");
const { AgentSessionWrapper, startRpcSession, setRpcSessionTools } = await jiti.import("./rpc-manager.ts");
const { changeManagedProject, readManagedProjects } = await jiti.import("./managed-projects.ts");

async function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "pi-project-missing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const roots = ["frontend", "backend"].map(name => { const path = join(root, name); mkdirSync(path); return realpathSync(path); });
  const snapshot = { projectId: "test", projectName: "目录异常", cwd: roots[0], folders: roots.map((path, i) => ({ id: String(i), name: String(i), path })) };
  const faux = fauxProvider({ models: [{ id: "project-test" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({ defaultTools: ["read", "write"] });
  const resourceLoader = new DefaultResourceLoader({ cwd: roots[0], agentDir: root, settingsManager,
    extensionFactories: [createProjectWorkspaceExtension(snapshot)], noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd: roots[0], agentDir: root, sessionManager: SessionManager.inMemory(roots[0]),
    settingsManager, modelRuntime, model: faux.getModel("project-test"), resourceLoader });
  const wrapper = new AgentSessionWrapper(session, { projectScope: snapshot, ...options });
  t.after(() => wrapper.destroy());
  wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  return { roots, snapshot, faux, session, wrapper };
}

test("关联的次目录失效不阻止模型定位其他目录，历史仍可查询", async t => {
  const f = await fixture(t);
  rmSync(f.roots[1], { recursive: true });
  f.faux.setResponses([() => fauxAssistantMessage([fauxText("不应调用")])]);
  await f.wrapper.send({ type: "prompt", message: "检查目录状态" });
  while (f.wrapper.isRunning()) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.faux.state.callCount, 1);
  assert.ok(await f.wrapper.send({ type: "get_state" }));
  assert.equal(existsSync(f.roots[1]), false);
});

test("SDK 将启动钩子异常当通知处理时，文件工具仍不能重建已删除的关联根", async t => {
  const f = await fixture(t);
  rmSync(f.roots[1], { recursive: true });
  f.faux.setResponses([
    () => fauxAssistantMessage([fauxToolCall("write", { path: join(f.roots[1], "should-not-exist.txt"), content: "unexpected" }, { id: "deleted-root-write" })], { stopReason: "toolUse" }),
    () => fauxAssistantMessage([fauxText("结束")]),
  ]);
  await f.session.prompt("尝试写入已经删除的次目录");
  const result = f.session.messages.find(m => m.role === "toolResult" && m.toolCallId === "deleted-root-write");
  assert.equal(result?.isError, true);
  assert.equal(existsSync(f.roots[1]), false);
});

test("等待 MCP 期间次目录失效，后续模型收到实际状态且正常结束", async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const preparing = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { mcpHost: { prepareForPrompt: () => { entered(); return gate; }, dispose() {} } });
  t.after(() => release());
  f.faux.setResponses([() => fauxAssistantMessage([fauxText("不应调用")])]);
  const pending = f.wrapper.send({ type: "prompt", message: "准备期间目录改变" });
  await preparing;
  rmSync(f.roots[1], { recursive: true }); release();
  await pending;
  while (f.wrapper.isRunning()) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.faux.state.callCount, 1);
  assert.equal(f.wrapper.isRunning(), false);
});

test("尚未发送消息的会话切换工具预设重建后，仍继承原项目快照", async t => {
  const root = mkdtempSync(join(tmpdir(), "pi-project-unsaved-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  const wrappers = [];
  t.after(async () => {
    for (const wrapper of wrappers) await wrapper.shutdown();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const cwd = join(root, "project"); mkdirSync(cwd);
  const request = { action: "save", name: "原项目", folders: [{ path: cwd }], defaultPath: cwd };
  const p = (await changeManagedProject(request)).projects[0];
  const first = await startRpcSession("__new__project-audit", "", cwd, { toolNames: [], projectId: p.id });
  wrappers.push(first.session);
  assert.equal(existsSync(first.session.sessionFile), false);
  const scope = readManagedProjects().sessions[first.realSessionId];
  await changeManagedProject({ action: "remove", id: p.id, revision: p.revision });
  await changeManagedProject({ ...request, name: "同路径新项目" });
  const result = await setRpcSessionTools(first.realSessionId, undefined, ["read"]);
  wrappers.push(result.session);
  assert.equal(result.recreated, true);
  assert.deepEqual(readManagedProjects().sessions[result.sessionId], scope);
});
