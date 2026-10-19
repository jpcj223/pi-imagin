import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { StringDecoder } from "node:string_decoder";
import test from "node:test";
import { createJiti } from "jiti";
import { DefaultResourceLoader, createPowerShellToolDefinition } from "@earendil-works/pi-coding-agent";

const { createUtf8PowerShellOperations, createPowerShellOutputExtension, preferUserPowerShellExtension } = await createJiti(import.meta.url).import("./powershell-operations.ts");
const windows = process.platform === "win32";

test("命令原文和执行上下文独立传递，不拼接用户文本或修改宿主环境", async () => {
  const command = '"中文 🌱 \' \\"; Write-Output "$env:TEST_VALUE"';
  const signal = new AbortController().signal;
  const env = { TEST_VALUE: "value" };
  let captured;
  const operations = createUtf8PowerShellOperations({ async exec(script, cwd, options) { captured = { script, cwd, options }; return { exitCode: 7 }; } });
  assert.deepEqual(await operations.exec(command, "/work", { env, signal, timeout: 2, onData() {} }), { exitCode: 7 });
  assert.equal(captured.cwd, "/work");
  assert.equal(captured.options.signal, signal);
  assert.equal(captured.options.timeout, 2);
  const key = Object.keys(captured.options.env).find(key => key.startsWith("PI_IMAGIN_PS_SOURCE_"));
  assert.equal(captured.options.env[key], command);
  assert.ok(!captured.script.includes(command));
  assert.deepEqual(env, { TEST_VALUE: "value" });
  assert.equal(process.env[key], undefined);
});

test("Windows PowerShell 的正常输出、解析和运行错误均为 UTF-8，退出状态保留", { skip: !windows }, async t => {
  const legacy = join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  assert.ok(existsSync(legacy));
  const sdk = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
  // 仅测试指定旧版 Shell；生产仍通过 SDK 的公开操作接口选择 Shell。
  const { createLocalShellOperations } = await import(pathToFileURL(join(sdk, "core/tools/bash.js")).href);
  const local = createLocalShellOperations("PowerShell", () => ({ shell: legacy, args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"] }));
  const operations = createUtf8PowerShellOperations({ exec(command, cwd, options) {
    return local.exec('try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}\n' + command, cwd, options);
  } });
  const cwd = await mkdtemp(join(tmpdir(), "pi-ps-utf8-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const run = async command => {
    const decoder = new StringDecoder("utf8"); let output = "";
    const result = await operations.exec(command, cwd, { timeout: 5, onData: bytes => { output += decoder.write(bytes); } });
    output += decoder.end();
    assert.doesNotMatch(output, /\ufffd/);
    return { output, ...result };
  };
  const normal = await run("Write-Output '中文 🌱'; Write-Output (Get-Location).Path; Get-ChildItem Env:PI_IMAGIN_PS_SOURCE_*");
  assert.equal(normal.exitCode, 0);
  assert.match(normal.output, /中文 🌱/);
  assert.ok(normal.output.includes(cwd));
  assert.doesNotMatch(normal.output, /PI_IMAGIN_PS_SOURCE_/);
  const syntax = await run("Get-ChildItem -Path . -Directory, -File | Select-Object Name");
  assert.equal(syntax.exitCode, 1);
  assert.match(syntax.output, /ParseException/);
  assert.ok(syntax.output.includes("Get-ChildItem -Path . -Directory, -File"));
  const runtime = await run("throw '运行失败：中文'");
  assert.equal(runtime.exitCode, 1);
  assert.match(runtime.output, /运行失败：中文/);
  const exit = await run("exit 7"); assert.equal(exit.exitCode, 7);
  const empty = await run("Get-ChildItem -LiteralPath . -Force -Name");
  assert.equal(empty.exitCode, 0); assert.equal(empty.output, "");
  // 长输入不经过命令行转义或 Base64 扩张。
  assert.match((await run("#" + "x".repeat(16000) + "\nWrite-Output '长输入正常'")).output, /长输入正常/);
});

test("公开 SDK 工具仍支持超时、中止和长输出截断", { skip: !windows }, async t => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-ps-lifecycle-"));
  t.after(() => rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  let definition;
  createPowerShellOutputExtension(cwd).factory({ registerTool(tool) { definition = tool; } });
  const context = { cwd, sessionManager: { getSessionId: () => "test-ps", getSessionFile: () => undefined } };
  await assert.rejects(definition.execute("timeout", { command: "Start-Sleep -Seconds 10", timeout: 0.2 }, undefined, undefined, context), /timed out|timeout/i);
  const controller = new AbortController();
  const running = definition.execute("abort", { command: "Start-Sleep -Seconds 10" }, controller.signal, undefined, context);
  const timer = setTimeout(() => controller.abort(), 200);
  try {
    await assert.rejects(running, /aborted/i);
  } finally { clearTimeout(timer); }
  const long = await definition.execute("long", { command: "1..3000 | ForEach-Object { '行-' + $_ }" }, undefined, undefined, context);
  assert.ok(long.details.fullOutputPath);
  t.after(() => rm(long.details.fullOutputPath, { force: true }));
  assert.equal(long.details.truncation.truncated, true);
  assert.match(long.content.map(c => c.text).join(""), /行-3000/);
});

test("保留 SDK 原有工具说明与关闭状态，用户 PowerShell 扩展优先", async t => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-ps-override-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const host = createPowerShellOutputExtension(cwd);
  let definition;
  host.factory({ registerTool(tool) { definition = tool; } });
  const builtin = createPowerShellToolDefinition(cwd);
  assert.deepEqual(definition.promptGuidelines, builtin.promptGuidelines);
  assert.equal(definition.description, builtin.description);
  assert.equal(definition.defaultActive, false);
  const user = { name: "user-ps", factory(pi) { pi.registerTool({ ...createPowerShellToolDefinition(cwd), description: "user override" }); } };
  const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), extensionFactories: [user, host], extensionsOverride: preferUserPowerShellExtension, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const definitions = loaded.extensions.flatMap(extension => [...extension.tools.values()].map(tool => tool.definition));
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].description, "user override");
});
