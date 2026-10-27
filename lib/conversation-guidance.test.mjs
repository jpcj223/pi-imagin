import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentTools, getSystemMessageText } from "@earendil-works/pi-ai";
import { createAgentSession, createPowerShellToolDefinition, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createConversationGuidanceExtension } = await jiti.import("./conversation-guidance.ts");
const { createPowerShellOutputExtension, preferUserPowerShellExtension } = await jiti.import("./powershell-operations.ts");

test("SDK 实际请求保留上下文并补充格式约定，只读预设不暴露 PowerShell", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-dialogue-guidance-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const faux = fauxProvider({ models: [{ id: "dialogue-test" }] });
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory({ defaultTools: ["read", "ls"] });
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [createConversationGuidanceExtension(), createPowerShellOutputExtension(dir)],
    extensionsOverride: preferUserPowerShellExtension });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: faux.getModel("dialogue-test"), settingsManager: settings, resourceLoader: loader, sessionManager: SessionManager.inMemory(dir) });
  t.after(() => session.dispose());
  let prompt;
  const respond = context => {
    prompt = context.messages.filter(message => message.role === "system").map(getSystemMessageText).join("\n");
    assert.ok(!getCurrentTools(context.messages).some(tool => tool.name === "powershell"));
    return fauxAssistantMessage([fauxText("{\"ready\":true}")]);
  };
  faux.setResponses([respond, respond]);
  await session.prompt("只返回 JSON");
  assert.match(prompt, /expert coding assistant/);
  assert.match(prompt, /遵守用户指定的输出格式、数量和任务范围/);
  assert.match(prompt, /归纳需求时保留其对象、限制和时点/);
  assert.match(prompt, /区分预期行为、实际执行和无法确认/);
  assert.match(prompt, /可核对的工具记录/);
  assert.match(prompt, /空输出本身不能证明数据不存在/);
  assert.match(prompt, /简短交流不默认套标题、表格、长清单或结尾反问/);
  assert.match(prompt, /先做低成本查证或简短澄清/);
  assert.match(prompt, /不默认升级为文档普查/);
  assert.doesNotMatch(prompt, /Select-Object -First 0|Get-ChildItem -LiteralPath|列表层级正确缩进/);
  assert.deepEqual(session.getActiveToolNames().sort(), ["ls", "read"]);
  assert.equal(session.messages.at(-1).content.find(block => block.type === "text").text, '{"ready":true}');
  await session.prompt("下一轮同样只返回 JSON");
  assert.equal((prompt.match(/<pi_imagin_output_guidance>/g) ?? []).length, 1);
  // 关闭自动激活不会妨碍显式选择；不发送新的模型请求。
  session.setActiveToolsByName(["powershell"]);
  assert.deepEqual(session.getActiveToolNames(), ["powershell"]);
});

test("实际 SDK 请求保留工具调用、成功空结果及真实错误，按调用 ID 对应", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-dialogue-evidence-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const faux = fauxProvider({ models: [{ id: "evidence-test" }] });
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  const executed = [];
  const commands = ["Write-Output 'ok'", "Get-ChildItem -Directory, -File", "Get-ChildItem | Select-Object -First 0"];
  const tool = { name: "evidence-shell", factory(pi) {
    pi.registerTool(createPowerShellToolDefinition(dir, { operations: { async exec(command, _cwd, { onData }) {
      executed.push(command);
      if (command === commands[0]) onData(Buffer.from("ok\n"));
      if (command === commands[1]) { onData(Buffer.from("语法错误：MissingArgument")); return { exitCode: 1 }; }
      return { exitCode: 0 };
    } } }));
  } };
  const settings = SettingsManager.inMemory({ defaultTools: ["powershell"] });
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings, noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true, extensionFactories: [createConversationGuidanceExtension(), tool] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: faux.getModel("evidence-test"), settingsManager: settings, resourceLoader: loader, sessionManager: SessionManager.inMemory(dir) });
  t.after(() => session.dispose());
  let checked = false;
  faux.setResponses([
    fauxAssistantMessage(commands.map(command => fauxToolCall("powershell", { command })), { stopReason: "toolUse" }),
    context => {
      const calls = context.messages.filter(message => message.role === "assistant").flatMap(message => message.content.filter(block => block.type === "toolCall"));
      const results = context.messages.filter(message => message.role === "toolResult");
      assert.equal(calls.length, 3); assert.equal(results.length, 3);
      for (let index = 0; index < commands.length; index++) {
        const call = calls.find(call => call.arguments.command === commands[index]); assert.ok(call);
        const result = results.find(result => result.toolCallId === call.id); assert.ok(result);
        assert.equal(result.isError, index === 1);
        if (index === 1) assert.match(result.content.map(block => block.text ?? "").join(""), /语法错误：MissingArgument[\s\S]*Command exited with code 1/);
      }
      checked = true; return fauxAssistantMessage([fauxText("仅依据工具记录报告结果。")]);
    },
  ]);
  await session.prompt("执行这三个隔离测试命令并报告实际结果");
  assert.equal(checked, true); assert.deepEqual(executed, commands);
});
