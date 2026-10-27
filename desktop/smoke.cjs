/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { buildTarget } = require("./platform.cjs");

const root = path.resolve(__dirname, "..");
const artifactRoot = path.join(root, "test-results");
fs.mkdirSync(artifactRoot, { recursive: true });
const profile = fs.mkdtempSync(path.join(artifactRoot, "desktop-smoke-"));
const cwd = path.join(profile, "workspace");
fs.mkdirSync(cwd);
const executable = path.resolve(process.argv[2] || path.join(root, "dist-desktop/win-unpacked/Pi Imagin.exe"));
const password = crypto.randomBytes(32).toString("hex");
const env = { ...process.env, PI_IMAGIN_DESKTOP_SMOKE: "1", PI_IMAGIN_DESKTOP_TEST_DIR: profile, PI_IMAGIN_DESKTOP_TEST_PASSWORD: password, PI_CODING_AGENT_DIR: path.join(profile, "agent") };
delete env.ELECTRON_RUN_AS_NODE;
const headers = { Authorization: `Basic ${Buffer.from(`pi:${password}`).toString("base64")}` };
let child;
let ready;
let exit;
let modelWorkspace;
let modelSessionId;

function launch() {
  const processHandle = spawn(executable, [], { windowsHide: true, env, stdio: "ignore" });
  const completion = new Promise((resolve, reject) => {
    processHandle.once("error", reject);
    processHandle.once("exit", resolve);
  });
  return { processHandle, completion };
}

function bounded(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("桌面验证等待超时")), ms); })]).finally(() => clearTimeout(timer));
}

async function waitReady() {
  const readyPath = path.join(profile, "smoke-ready.json");
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (fs.existsSync(readyPath)) return JSON.parse(fs.readFileSync(readyPath, "utf8"));
    if (child.exitCode !== null) throw new Error("桌面程序在完成启动前退出");
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`工作区未完成启动，请查看 ${path.join(profile, "desktop.log")}`);
}

async function request(endpoint, body, method) {
  const response = await fetch(`${ready.origin}${endpoint}`, {
    headers: { ...headers, ...(body ? { "Content-Type": "application/json", Origin: ready.origin } : {}) },
    method: method || (body ? "POST" : "GET"), body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${endpoint} 验证失败：HTTP ${response.status} ${data.error || ""}`);
  return data;
}

async function verifyTerminal() {
  const id = crypto.randomBytes(16).toString("hex");
  await request("/api/terminal", { id, cwd, cols: 80, rows: 24, shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh" });
  const controller = new AbortController();
  const stream = await fetch(`${ready.origin}/api/terminal/${id}/events`, { headers, signal: controller.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let pending = "", output = "";
  const command = process.platform === "win32" ? "echo DESKTOP_TERMINAL_%RANDOM%\r" : `printf 'DESKTOP_%s\\n' 'TERMINAL_${crypto.randomInt(100000, 999999)}'\r`;
  await request(`/api/terminal/${id}`, { type: "input", data: command });
  try {
    await bounded((async () => {
      while (!/DESKTOP_TERMINAL_\d+/.test(output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""))) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("终端事件提前结束");
        pending += decoder.decode(chunk.value, { stream: true });
        const events = pending.split("\n\n"); pending = events.pop();
        for (const event of events) {
          const value = event.split("\n").find(line => line.startsWith("data: "));
          if (value) { const data = JSON.parse(value.slice(6)); if (data.type === "output") output += data.data; }
        }
      }
    })(), 15000).catch(error => { throw new Error(`${error.message}；终端输出：${JSON.stringify(output.slice(-500))}`); });
  } finally { controller.abort(); await reader.cancel().catch(() => {}); }
  console.log("内置运行时终端验证通过");
}

async function verifyModel() {
  modelWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "pi-imagin-desktop-model-"));
  await request("/api/cwd/validate", { cwd: modelWorkspace });
  const models = await request(`/api/models?cwd=${encodeURIComponent(modelWorkspace)}`);
  const chosen = models.modelList.find(model => model.provider === "硅基流动" && model.id === "Qwen/Qwen3.5-9B");
  assert.ok(chosen, "已授权的硅基流动模型应在打包服务中可用");
  // 只发送本条测试提示词，空目录中没有开发文档、对话或项目指令。
  const result = await request("/api/agent/new", { cwd: modelWorkspace, type: "prompt", message: "请只回复：桌面验证通过", provider: chosen.provider, modelId: chosen.id, toolNames: [], thinkingLevel: "off" });
  const id = result.sessionId;
  modelSessionId = id;
  assert.ok(id);
  await bounded((async () => {
    while ((await request("/api/agent/running")).runningSessionIds.includes(id)) await new Promise(resolve => setTimeout(resolve, 300));
  })(), 90000);
  const snapshot = await request(`/api/sessions/${id}?force=1`);
  const replies = snapshot.context.messages.filter(message => message.role === "assistant");
  assert.ok(replies.some(message => JSON.stringify(message.content).includes("桌面验证通过")), "真实模型应返回指定测试文本");
  assert.ok(replies.every(message => message.stopReason !== "error"), "模型回复不应包含接口错误");
  await request(`/api/sessions/${id}`, { name: "桌面安装验证" }, "PATCH");
  const history = await fetch(`${ready.origin}/api/sessions/${id}/export?inline=1`, { headers, signal: AbortSignal.timeout(45000) });
  assert.equal(history.status, 200, "完整历史导出应正常");
  const exportedHtml = await history.text();
  const encodedSession = exportedHtml.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
  assert.ok(encodedSession, "完整历史应包含会话数据");
  const exportedSession = JSON.parse(Buffer.from(encodedSession, "base64").toString("utf8"));
  assert.ok(exportedSession.entries.some(entry => entry.type === "message" && entry.message.role === "assistant" && JSON.stringify(entry.message.content).includes("桌面验证通过")), "导出数据应包含真实模型回复");
  await request(`/api/sessions/${id}`, undefined, "DELETE");
  modelSessionId = undefined;
  console.log("真实模型调用、会话保存与完整历史验证通过");
}

async function run() {
  assert.ok(fs.existsSync(executable), "桌面可执行文件应已生成");
  const resources = process.platform === "darwin" ? path.resolve(path.dirname(executable), "../Resources") : path.join(path.dirname(executable), "resources");
  for (const required of ["server/node_modules/next/package.json", "server/node_modules/node-pty/package.json", "server/node_modules/@earendil-works/pi-coding-agent/package.json", path.join("node", buildTarget().npmRelative)]) assert.ok(fs.existsSync(path.join(resources, required)), `安装资源缺失：${required}`);
  const initial = launch(); child = initial.processHandle; exit = initial.completion;
  ready = await waitReady();
  assert.equal(ready.packaged, true);
  assert.equal(new URL(ready.loadedUrl).pathname, "/", "窗口应直接进入工作区，不停留在登录页");
  const unauthorized = await fetch(`${ready.origin}/api/home`);
  assert.equal(unauthorized.status, 401, "本地服务拒绝缺少窗口认证的请求");
  const second = launch();
  assert.equal(await bounded(second.completion, 15000), 0);
  assert.equal(child.exitCode, null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, "smoke-ready.json"), "utf8")).backendPid, ready.backendPid);
  console.log("打包窗口启动与重复启动验证通过");
  await request("/api/cwd/validate", { cwd });
  const original = path.join(cwd, "验证.txt");
  fs.writeFileSync(original, "桌面文件验证");
  const renamed = await request("/api/file-actions", { cwd, path: original, action: "rename", name: "已重命名.txt" });
  assert.equal(fs.readFileSync(renamed.path, "utf8"), "桌面文件验证");
  const deleted = await request("/api/file-actions", { cwd, path: renamed.path, action: "delete" });
  assert.equal(fs.existsSync(renamed.path), false);
  await request("/api/file-actions", { cwd, path: renamed.path, action: "restore", token: deleted.token });
  assert.equal(fs.readFileSync(renamed.path, "utf8"), "桌面文件验证");
  console.log("打包服务文件重命名、删除与恢复验证通过");
  await verifyTerminal();
  // 布局更新可只复验本地功能，不重复产生模型费用。
  if (!process.argv.includes("--skip-model")) await verifyModel();
  if (process.argv.includes("--sidebar")) {
    const defaults = await fetch(`${ready.origin}/api/default-cwd`, { headers });
    assert.equal(defaults.status, 200);
    assert.equal((await defaults.json()).parent, path.join(os.homedir(), "pi-cwd"), "默认会话范围应由安装版服务端提供");
    const id = crypto.randomUUID();
    const validation = await fetch(`${ready.origin}/api/sessions/ui-state`, { method: "POST", headers: { ...headers, Origin: ready.origin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "move-session", sessionId: id, anchorId: id, position: "before", add: [] }) });
    assert.equal(validation.status, 400);
    assert.match((await validation.json()).error, /distinct session ids/, "安装版应包含新的会话排序校验，拒绝自身投放且不写入数据");
    console.log("安装版侧栏排序接口与无效投放校验通过");
  }
  fs.writeFileSync(path.join(profile, "smoke-quit"), "quit");
  assert.equal(await bounded(exit, 15000), 0);
  assert.throws(() => process.kill(ready.backendPid, 0), "退出后不应保留本地服务");
  fs.unlinkSync(path.join(profile, "smoke-quit"));
  fs.unlinkSync(path.join(profile, "smoke-ready.json"));
  const restart = launch(); child = restart.processHandle; exit = restart.completion;
  const restored = await waitReady();
  assert.equal(restored.origin, ready.origin, "再次启动继续使用原端口与窗口偏好来源");
  console.log("正常退出回收与再次启动验证通过");
}

run().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (modelSessionId && ready && child?.exitCode === null) {
    await request(`/api/agent/${modelSessionId}`, { type: "abort" }).catch(() => {});
    await request(`/api/sessions/${modelSessionId}`, undefined, "DELETE").catch(() => {});
  }
  if (child?.exitCode === null) {
    fs.writeFileSync(path.join(profile, "smoke-quit"), "quit");
    await bounded(exit, 15000).catch(() => {});
  }
  console.log(`验证记录目录：${profile}`);
  if (modelWorkspace) {
    assert.equal(path.dirname(modelWorkspace), os.tmpdir());
    assert.ok(path.basename(modelWorkspace).startsWith("pi-imagin-desktop-model-"));
    fs.rmSync(modelWorkspace, { recursive: true, force: true });
  }
});
