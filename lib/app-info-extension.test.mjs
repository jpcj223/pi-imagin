import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const { createAppInfoExtension } = await createJiti(import.meta.url).import("./app-info-extension.ts");
const loadTool = () => {
  let definition;
  createAppInfoExtension().factory({ registerTool: tool => { definition = tool; } });
  return definition;
};
const payload = result => JSON.parse(result.content[0].text);
const card = name => `<article data-package-card="true" data-package-name="${name}" data-package-types="extension"><p class="packages-desc">Example plugin</p><button data-copy-text="pi install npm:${name}">Copy</button></article>`;

test("真实 SDK 中能力信息随工具预设更新，不把注册未声明、隐藏或源码默认能力混为一谈", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-app-info-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const faux = fauxProvider({ models: [{ id: "app-info" }] });
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ defaultTools: ["read"] });
  const fixture = { name: "fixture", factory(pi) {
    for (const [name, exposure] of [["Agent", "model-only"], ["private_tool", "hidden"], ["lookup", "deferred"]]) {
      pi.registerTool({ name, label: name, description: name, exposure, parameters: { type: "object", properties: {} }, async execute() { throw new Error("Fixture must never execute"); } });
    }
  } };
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [createAppInfoExtension(), fixture] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime,
    model: faux.getModel("app-info"), settingsManager: settings, resourceLoader: loader, sessionManager: SessionManager.inMemory(dir) });
  t.after(() => session.dispose());
  let expected = true;
  const inspect = context => {
    const tool = getCurrentTools(context.messages).find(tool => tool.name === "pi_imagin_info");
    assert.ok(tool, "新增入口确实声明给模型");
    const result = context.messages.findLast(message => message.role === "toolResult");
    const info = payload(result);
    assert.equal(info.application, "Pi Imagin");
    assert.deepEqual(info.model, { provider: faux.getModel("app-info").provider, id: "app-info" });
    assert.deepEqual(info.subagents, { registered: true, declared: expected });
    assert.equal(info.tools.some(tool => tool.name === "private_tool"), false);
    assert.equal(info.tools.find(tool => tool.name === "lookup").declared, false);
    assert.equal(info.tools.some(tool => tool.name === "write" && tool.declared), false);
    assert.equal(info.interface.pluginCatalog, true);
    assert.doesNotMatch(JSON.stringify(info), /auth\.json|apiKey|systemPrompt/);
    return fauxAssistantMessage([fauxText("已根据当前工具状态回答。")]);
  };
  faux.setResponses([fauxAssistantMessage([fauxToolCall("pi_imagin_info", { action: "capabilities" })], { stopReason: "toolUse" }), inspect]);
  await session.prompt("当前应用有哪些能力？");
  expected = false;
  session.setActiveToolsByName(["read", "pi_imagin_info"]);
  faux.setResponses([fauxAssistantMessage([fauxToolCall("pi_imagin_info", { action: "capabilities" })], { stopReason: "toolUse" }), inspect]);
  await session.prompt("切换预设后再检查。");
  assert.deepEqual(session.getActiveToolNames().sort(), ["pi_imagin_info", "read"]);
});

test("插件搜索复用页面缓存，结果有界且可继续，空结果与网络失败分开", async t => {
  const oldFetch = globalThis.fetch, offline = process.env.PI_OFFLINE;
  t.after(() => { globalThis.fetch = oldFetch; if (offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = offline; });
  delete process.env.PI_OFFLINE;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    const query = new URL(url).searchParams.get("name");
    if (query === "failure") return new Response("unavailable", { status: 503 });
    if (query === "missing") return new Response('<span class="packages-count">0 / 5606</span>');
    return new Response(`<span class="packages-count">1-12 / 12</span>${Array.from({ length: 12 }, (_, i) => card(`unit-plugin-${i}`)).join("")}`);
  };
  const tool = loadTool();
  const first = payload(await tool.execute("1", { action: "search_plugins", query: "unit fish & 中文" }));
  assert.equal(new URL(calls[0]).origin, "https://pi.dev");
  assert.equal(new URL(calls[0]).searchParams.get("name"), "unit fish & 中文");
  assert.equal(first.items.length, 10);
  assert.equal(first.returnedCount, 10); assert.equal(first.remainingInPage, 2);
  assert.deepEqual(first.next, { page: 1, offset: 10 });
  const next = payload(await tool.execute("2", { action: "search_plugins", query: first.query, ...first.next }));
  assert.equal(next.items.length, 2); assert.equal(next.next, null);
  assert.equal(next.returnedCount, 2); assert.equal(next.remainingInPage, 0);
  assert.equal(calls.length, 1, "继续读取不重复访问目录");
  const empty = payload(await tool.execute("3", { action: "search_plugins", query: "missing" }));
  assert.deepEqual(empty.items, []); assert.match(empty.coverage, /not.*complete search/);
  await assert.rejects(tool.execute("4", { action: "search_plugins", query: "failure" }), /HTTP 503/);
  await assert.rejects(tool.execute("5", { action: "search_plugins", query: "  " }), /non-empty query/);
  assert.equal(tool.annotations.readOnlyHint, true);
});

test("详情只访问固定公开来源，保留部分失败及引用，README 有界且不能执行网页内容", async t => {
  const oldFetch = globalThis.fetch, offline = process.env.PI_OFFLINE;
  t.after(() => { globalThis.fetch = oldFetch; if (offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = offline; });
  delete process.env.PI_OFFLINE;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (String(url).includes("registry.npmjs.org")) return Response.json({ name: "unit-detail-plugin", version: "2", description: "Catalog candidate, not an installed package", engines: { node: ">=22" } });
    return new Response(`<dl class="definition-grid detail-grid"><dt>Package</dt><dd>unit-detail-plugin</dd><dt>Version</dt><dd>1</dd></dl><section><div class="content-card-body"><div class="rich-text packages-readme"><script>mustNotRun()</script><h2>Usage &amp; data</h2><p>${"x".repeat(9000)}</p></div></div></section>`);
  };
  const tool = loadTool();
  for (const name of ["../../auth.json", "https://example.com/plugin", undefined]) await assert.rejects(tool.execute("invalid", { action: "plugin_details", name }), /valid public npm/);
  assert.equal(calls.length, 0);
  const detail = payload(await tool.execute("detail", { action: "plugin_details", name: "unit-detail-plugin" }));
  assert.equal(detail.partial, false);
  assert.equal(detail.version, "1", "沿用现有页面对官方目录版本的选择");
  assert.equal(detail.readme.text.length, 6000); assert.equal(detail.readme.truncated, true);
  assert.match(detail.readme.text, /Usage & data/); assert.doesNotMatch(detail.readme.text, /script|mustNotRun|<p>/);
  assert.match(detail.compatibility, /Not verified/);
  assert.ok(calls.every(url => ["https://pi.dev", "https://registry.npmjs.org"].includes(new URL(url).origin)));
  globalThis.fetch = async url => String(url).includes("pi.dev") ? new Response("unavailable", { status: 503 }) : Response.json({ name: "unit-partial-plugin", version: "3" });
  const partial = payload(await tool.execute("partial", { action: "plugin_details", name: "unit-partial-plugin" }));
  assert.equal(partial.partial, true); assert.equal(partial.readme, null);
});

test("取消调用不查询网络，也不把取消转换成空结果", async () => {
  const controller = new AbortController(); controller.abort(new Error("Cancelled by user"));
  await assert.rejects(loadTool().execute("cancel", { action: "search_plugins", query: "cancelled" }, controller.signal), /Cancelled by user/);
});
