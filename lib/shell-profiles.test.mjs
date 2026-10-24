import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { discoverShellProfiles, shellProfileSettings, selectedShellProfile, resolveEnvironmentTools, readShellProfiles, changeShellProfiles, validateShellProfile } = await jiti.import("./shell-profiles.ts");
const { createEnvironmentOperations, shellCommandArguments } = await jiti.import("./shell-profile-operations.ts");
const profiles = discoverShellProfiles();

test("SDK 保留环境优先级，模型工具描述和真实执行使用相同语法", { skip: process.platform !== "win32" }, async t => {
  const { SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const { createProjectCommandBashExtension } = await jiti.import("./project-command-env.ts");
  const root = await mkdtemp(join(tmpdir(), "pi-model-shell-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const settings = SettingsManager.inMemory({ piImaginShells: { version: 1, added: [], custom: [], order: ["cmd", "powershell"] } });
  assert.equal(selectedShellProfile(settings.getGlobalSettings()).id, "cmd");
  assert.deepEqual(resolveEnvironmentTools(["read", "bash"], settings), ["read", "bash"]);
  let tool;
  createProjectCommandBashExtension({ cwd: root, settings, environmentSettings: settings }).factory({ registerTool: definition => { tool = definition; } });
  assert.match(tool.description, /CMD/); assert.match(tool.promptSnippet, /cmd syntax/);
  const result = await tool.execute("command-test", { command: "echo MODEL_CMD_READY & exit /b 7" }, undefined, undefined, { cwd: root, sessionManager: { getSessionId: () => "test", getSessionFile: () => undefined } });
  assert.match(result.content[0].text, /MODEL_CMD_READY/); assert.equal(result.isError, true);
});

test("首次仅列出实际系统内置环境，Windows 优先内置 PowerShell；排序只改变选择，不扩展工具权限", () => {
  const settings = shellProfileSettings({});
  assert.ok(settings.profiles.length > 0);
  assert.ok(settings.profiles.every(item => item.builtin));
  if (process.platform === "win32") assert.equal(settings.selectedId, "powershell");
  assert.deepEqual(resolveEnvironmentTools(["read", "grep"], { getGlobalSettings: () => ({}) }), ["read", "grep"]);
  const resolved = resolveEnvironmentTools(["read", "bash", "write"], { getGlobalSettings: () => ({}) });
  assert.deepEqual(resolved, ["read", process.platform === "win32" ? "powershell" : "bash", "write"]);
});

test("内置项不可移除；优先级、添加、移除和重置持久化，保留其他设置", async t => {
  const root = await mkdtemp(join(tmpdir(), "pi-shell-profiles-")), path = join(root, "settings.json");
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  await writeFile(path, JSON.stringify({ defaultTools: ["read", "bash", "edit", "+codemode"], codemode: { mode: "only" }, unrelated: "keep" }));
  let value = await readShellProfiles(path);
  await assert.rejects(changeShellProfiles({ action: "remove", id: value.profiles[0].id }, path), /cannot be removed/);
  await assert.rejects(changeShellProfiles({ action: "order", order: [] }, path), /list changed/);
  const order = value.profiles.map(item => item.id).reverse();
  await changeShellProfiles({ action: "order", order }, path);
  assert.deepEqual((await readShellProfiles(path)).profiles.map(item => item.id), order);
  const optional = value.detected.find(item => !item.builtin && item.modelSupported);
  if (optional) {
    value = await changeShellProfiles({ action: "add", id: optional.id }, path);
    assert.equal(value.profiles.at(-1).id, optional.id);
    await assert.rejects(changeShellProfiles({ action: "add", id: optional.id }, path), /already/);
    const reset = await changeShellProfiles({ action: "reset" }, path);
    assert.ok(reset.profiles.some(item => item.id === optional.id), "恢复默认只重置顺序，保留已添加项");
    assert.deepEqual(reset.profiles.filter(item => item.builtin).map(item => item.id), shellProfileSettings({}).profiles.map(item => item.id));
    await changeShellProfiles({ action: "remove", id: optional.id }, path);
    assert.ok(!(await readShellProfiles(path)).profiles.some(item => item.id === optional.id));
    await validateShellProfile(optional); // 移除列表项后程序依然存在、仍可使用。
  }
  await changeShellProfiles({ action: "reset" }, path);
  assert.deepEqual((await readShellProfiles(path)).profiles.map(item => item.id), shellProfileSettings({}).profiles.map(item => item.id));
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(saved.unrelated, "keep"); assert.deepEqual(saved.codemode, { mode: "only" }); assert.ok(saved.defaultTools.includes("codemode"));
});

test("手动添加先验证程序及命令语法，错误路径与重复项不写入配置", async t => {
  const root = await mkdtemp(join(tmpdir(), "pi-custom-shell-")), path = join(root, "settings.json");
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  await writeFile(path, "{}");
  const before = await readFile(path, "utf8");
  await assert.rejects(changeShellProfiles({ action: "custom", label: "bad", path: "relative.exe", kind: "cmd" }, path));
  await assert.rejects(changeShellProfiles({ action: "custom", label: "bad", path: join(root, "missing.exe"), kind: "cmd" }, path));
  const builtin = profiles.find(item => item.builtin && item.available);
  await assert.rejects(changeShellProfiles({ action: "custom", label: "duplicate", path: builtin.path, kind: builtin.kind }, path), /already/);
  assert.equal(await readFile(path, "utf8"), before);
});

test("不可用的高优先级项保留但跳过；WSL 标明只供手动终端，不静默冒充 AI 环境", () => {
  const selected = selectedShellProfile({ piImaginShells: { version: 1, added: [], order: ["custom-abc"], custom: [{ id: "custom-abc", label: "Missing", path: join(tmpdir(), "nonexistent-pi-shell.exe"), kind: "bash" }] } });
  assert.ok(selected.builtin);
  const wsl = profiles.find(item => item.kind === "wsl");
  if (wsl) assert.equal(wsl.modelSupported, false);
});

test("会话执行环境固定到加载时，失效或语法变化不把已生成的命令交给另一种 Shell", async () => {
  const profile = profiles.find(item => item.available && item.kind !== "powershell");
  await assert.rejects(createEnvironmentOperations(profile, "powershell").exec("echo NEVER_RUN", process.cwd(), { onData() {} }), /Reload the session/);
  const settings = { getGlobalSettings: () => ({}) };
  const operations = createEnvironmentOperations(settings);
  settings.getGlobalSettings = () => { throw new Error("不得在执行中重新选择环境"); };
  let output = "";
  await operations.exec("echo FROZEN_ENV", process.cwd(), { onData: data => { output += data.toString(); } });
  assert.match(output, /FROZEN_ENV/);
});

for (const profile of profiles.filter(item => item.available && item.modelSupported)) {
  test(`${profile.label} 使用指定程序真实执行，中文、空格目录与退出状态保留`, async t => {
    const root = await mkdtemp(join(tmpdir(), "pi-shell space-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    const operations = createEnvironmentOperations(profile); let output = "";
    const command = profile.kind === "powershell" ? "[Console]::Write('中文 READY'); exit 7" : profile.kind === "cmd" ? "echo READY & exit /b 7" : "printf '中文 READY'; exit 7";
    const result = await operations.exec(command, root, { onData: data => { output += data.toString(); } });
    assert.equal(result.exitCode, 7); assert.match(output, /READY/);
    if (profile.kind !== "cmd") assert.match(output, /中文/);
    assert.ok(shellCommandArguments(profile).length);
  });
}

test("执行失败不会换环境重试，SDK 取消、超时与输出事件继续可用", async t => {
  const profile = profiles.find(item => item.builtin && item.available);
  const operations = createEnvironmentOperations(profile);
  const root = await mkdtemp(join(tmpdir(), "pi-shell-timeout-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const sleep = profile.kind === "powershell" ? "Start-Sleep -Seconds 5" : profile.kind === "cmd" ? "ping -n 6 127.0.0.1 >nul" : "sleep 5";
  await assert.rejects(operations.exec(sleep, root, { timeout: 0.1, onData() {} }), /timeout/);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  try { await assert.rejects(operations.exec(sleep, root, { signal: controller.signal, onData() {} }), /aborted/); } finally { clearTimeout(timer); }
});
