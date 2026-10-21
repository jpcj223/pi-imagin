import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createCredentialFileGuardExtension, isCredentialFileCall } = await jiti.import("./credential-file-guard.ts");

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-credential-guard-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const agentDir = join(dir, "agent"), cwd = join(dir, "project");
  await mkdir(agentDir); await mkdir(cwd);
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ example: { type: "api_key", key: "fixture-auth-secret-123" } }));
  await writeFile(join(agentDir, "models.json"), '{"providers":{"example":{"apiKey":"fixture-model-secret-456"}}}');
  await writeFile(join(cwd, "README.md"), "normal project content");
  return { dir, agentDir, cwd };
}

async function createSession(t, f, faux, manager = SessionManager.inMemory(f.cwd)) {
  const runtime = await ModelRuntime.create({ authPath: join(f.agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({ defaultTools: ["read", "grep", "ls", "edit", "write"] });
  const resourceLoader = new DefaultResourceLoader({ cwd: f.cwd, agentDir: f.agentDir, settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [createCredentialFileGuardExtension(f.agentDir)] });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd: f.cwd, agentDir: f.agentDir, modelRuntime: runtime,
    model: faux.getModel("first"), settingsManager, resourceLoader, sessionManager: manager });
  t.after(() => session.dispose());
  return session;
}

test("凭证路径守卫覆盖直接访问、目录搜索、复制、链接和 Windows 路径别名", async t => {
  const f = await fixture(t);
  const auth = join(f.agentDir, "auth.json"), models = join(f.agentDir, "models.json");
  const blocked = (tool, input) => isCredentialFileCall(tool, input, f.cwd, f.agentDir);
  for (const path of [auth, models, relative(f.cwd, auth), `@${auth}`, pathToFileURL(auth).href]) {
    for (const tool of ["read", "edit", "write", "grep"]) assert.equal(blocked(tool, { path }), true, `${tool}: ${path}`);
  }
  assert.equal(blocked("grep", { path: f.dir, pattern: "apiKey" }), true);
  assert.equal(blocked("grep", { path: f.cwd, pattern: "apiKey" }), false);
  assert.equal(blocked("ls", { path: f.agentDir }), false);
  assert.equal(blocked("project_copy_file", { source: auth, destination: join(f.cwd, "copy.json") }), true);
  assert.equal(blocked("project_copy_file", { source: join(f.cwd, "README.md"), destination: models }), true);
  assert.equal(blocked("read", { path: join(f.cwd, "auth.json") }), false);
  assert.equal(blocked("read", { path: join(f.cwd, "README.md") }), false);
  const aliasDir = join(f.dir, "alias");
  await symlink(f.agentDir, aliasDir, process.platform === "win32" ? "junction" : "dir");
  assert.equal(blocked("read", { path: join(aliasDir, "auth.json") }), true);
  assert.equal(blocked("grep", { path: aliasDir }), true);
  const hardlink = join(f.cwd, "linked.json"); await link(auth, hardlink);
  assert.equal(blocked("read", { path: hardlink }), true);
  if (process.platform === "win32") {
    assert.equal(blocked("read", { path: auth.toUpperCase().replaceAll("\\", "/") }), true);
    assert.equal(blocked("read", { path: `${auth}::$DATA` }), true);
    const shellPath = auth.replace(/^([A-Za-z]):\\/, (_match, drive) => `/${drive}/`).replaceAll("\\", "/");
    assert.equal(blocked("read", { path: shellPath }), true);
  }
});

test("SDK 拒绝凭证读取和写入，正常项目读取可用，凭证正文不进入请求或会话文件", async t => {
  const f = await fixture(t);
  const faux = fauxProvider({ models: [{ id: "first" }] });
  const manager = SessionManager.create(f.cwd, join(f.dir, "sessions"));
  const session = await createSession(t, f, faux, manager);
  // 守卫只拦截访问，不注册新工具，避免权限保护再次变成专用能力扩张。
  assert.deepEqual(session.getActiveToolNames().sort(), ["edit", "grep", "ls", "read", "write"]);
  const calls = [
    ["read", { path: join(f.agentDir, "models.json") }],
    ["read", { path: join(f.agentDir, "auth.json") }],
    ["write", { path: join(f.agentDir, "models.json"), content: "do-not-overwrite" }],
    ["grep", { path: f.agentDir, pattern: "key" }],
    ["read", { path: join(f.cwd, "README.md") }],
  ];
  let checked = false;
  faux.setResponses([
    fauxAssistantMessage(calls.map(([name, args]) => fauxToolCall(name, args)), { stopReason: "toolUse" }),
    context => {
      const results = context.messages.filter(message => message.role === "toolResult");
      assert.equal(results.length, calls.length);
      assert.equal(results.filter(result => result.isError).length, 4);
      assert.match(JSON.stringify(results), /normal project content/);
      assert.doesNotMatch(JSON.stringify(context.messages), /fixture-auth-secret-123|fixture-model-secret-456/);
      checked = true; return fauxAssistantMessage([fauxText("凭证访问已阻止，项目读取成功")]);
    },
  ]);
  await session.prompt("隔离的工具边界检查");
  assert.ok(checked);
  const stored = await readFile(session.sessionFile, "utf8");
  assert.doesNotMatch(stored, /fixture-auth-secret-123|fixture-model-secret-456/);
  assert.match(await readFile(join(f.agentDir, "models.json"), "utf8"), /fixture-model-secret-456/);
});
