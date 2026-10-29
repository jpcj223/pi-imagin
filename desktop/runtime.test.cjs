/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { isOwnedUrl, isExternalUrl, waitForServer, pathsFor, requestLocal, loadWorkspacePage } = require("./runtime.cjs");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const { stopServer } = require("./runtime.cjs");

test("桌面窗口只认自己的来源，外部链接拒绝脚本与本地文件协议", () => {
  assert.equal(isOwnedUrl("http://127.0.0.1:30142/api/home", "http://127.0.0.1:30142"), true);
  assert.equal(isOwnedUrl("http://127.0.0.1:30141/", "http://127.0.0.1:30142"), false);
  assert.equal(isOwnedUrl("not a url", ""), false);
  for (const url of ["javascript:alert(1)", "file:///C:/x", "data:text/html,test"]) assert.equal(isExternalUrl(url), false);
  assert.equal(isExternalUrl("https://pi.dev/"), true);
});

test("内置服务意外退出时不无限等待", async () => {
  await assert.rejects(waitForServer("http://127.0.0.1:1", "", { exitCode: 1 }), /本地服务已退出/);
});

test("打包后的 Node 与服务放在资源目录，启动器位于归档外", () => {
  const files = pathsFor({ isPackaged: true }, "C:/app/resources", "win32", "x64");
  assert.match(files.node.replace(/\\/g, "/"), /resources\/node\/node.exe$/);
  assert.match(files.launcher.replace(/\\/g, "/"), /resources\/server-launcher.cjs$/);
});

test("退出先等待会话清理确认，再移除临时监听", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  let command;
  child.send = message => { command = message.type; child.emit("message", { type: "pi-imagin:shutdown-ready" }); };
  await stopServer(child);
  assert.equal(command, "pi-imagin:prepare-shutdown");
  assert.equal(child.listenerCount("message"), 0);
});

async function localServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("启动认证直连本机并保留原请求来源、JSON 与 Cookie", async t => {
  const origin = await localServer(t, (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/web-auth");
    assert.equal(request.headers.origin, origin);
    assert.equal(request.headers["content-type"], "application/json");
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      assert.deepEqual(JSON.parse(body), { password: "test-only" });
      response.writeHead(200, { "set-cookie": ["pi_web_session=test-cookie; HttpOnly"] });
      response.end("{}");
    });
  });
  const result = await requestLocal(origin, "/api/web-auth", { json: { password: "test-only" } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.headers["set-cookie"], ["pi_web_session=test-cookie; HttpOnly"]);
  await assert.rejects(requestLocal(origin, "https://example.com/"), /当前本机服务/);
});

test("启动探测不经过全局 fetch，认证或响应卡住会在期限内结束", async t => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("不应使用代理 fetch"); };
  t.after(() => { globalThis.fetch = original; });
  const origin = await localServer(t, (request, response) => {
    if (request.url === "/api/home") { assert.equal(request.headers.authorization, "Basic test"); response.end("{}"); }
    else if (request.url === "/partial") { response.writeHead(200); response.write("partial"); }
  });
  await waitForServer(origin, "Basic test", { exitCode: null }, 1000);
  await assert.rejects(requestLocal(origin, "/api/web-auth", { json: {}, timeout: 40 }), /连接超时/);
  await assert.rejects(requestLocal(origin, "/partial", { timeout: 40 }), /超时|aborted/);
});

function fakeWindow(load) {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.loadURL = load;
  return window;
}

test("健康探测记录重试与成功耗时，不泄露认证内容", async t => {
  let calls = 0;
  const origin = await localServer(t, (_request, response) => {
    response.writeHead(++calls === 1 ? 503 : 200); response.end("{}");
  });
  const progress = [];
  await waitForServer(origin, "Basic private-test-value", { exitCode: null }, 2000, value => progress.push(value));
  assert.deepEqual(progress.map(value => value.outcome), ["http-503", "ready"]);
  assert.deepEqual(progress.map(value => value.attempts), [1, 2]);
  assert.ok(progress.every(value => value.elapsedMs >= value.requestMs && value.requestMs >= 0));
  assert.ok(!JSON.stringify(progress).includes("private-test-value"));
});

test("页面 DOM 就绪即完成启动，不等待尚未结束的资源加载", async () => {
  const window = fakeWindow(() => new Promise(() => {}));
  const loaded = loadWorkspacePage(window, "http://127.0.0.1:30142", 1000);
  window.webContents.emit("dom-ready");
  await loaded;
  assert.equal(window.listenerCount("closed"), 0);
  assert.equal(window.webContents.listenerCount("did-fail-load"), 0);
});

test("桌面首屏等待主框架的真实就绪消息，忽略子框架与过早消息", async () => {
  const window = fakeWindow(() => new Promise(() => {}));
  const origin = "http://127.0.0.1:30142";
  const frame = { url:origin };
  window.webContents.mainFrame = frame;
  let done = false;
  const loaded = loadWorkspacePage(window, origin, 1000, true).then(() => { done = true; });
  window.webContents.emit("ipc-message", { senderFrame:frame }, "pi-imagin:workspace-ready");
  await Promise.resolve(); assert.equal(done, false);
  window.webContents.emit("dom-ready");
  window.webContents.emit("ipc-message", { senderFrame:{ url:origin } }, "pi-imagin:workspace-ready");
  await Promise.resolve(); assert.equal(done, false);
  window.webContents.emit("ipc-message", { senderFrame:frame }, "pi-imagin:workspace-ready");
  await loaded;
  assert.equal(window.webContents.listenerCount("ipc-message"), 0);
});

test("认证重定向到登录页时立即报告错误，不等待首屏消息超时", async () => {
  const window = fakeWindow(() => new Promise(() => {}));
  window.webContents.mainFrame = { url:"http://127.0.0.1:30142/login" };
  const loaded = loadWorkspacePage(window, "http://127.0.0.1:30142", 1000, true);
  window.webContents.emit("dom-ready");
  await assert.rejects(loaded,/连接没有完成/);
  assert.equal(window.webContents.listenerCount("ipc-message"),0);
});

test("页面失败、窗口销毁和页面超时可恢复，不无限等候", async () => {
  const window = fakeWindow(() => new Promise(() => {}));
  let loaded = loadWorkspacePage(window, "http://127.0.0.1:30142");
  window.webContents.emit("did-fail-load", {}, -2, "failed", "", false);
  window.webContents.emit("did-fail-load", {}, -2, "failed", "", true);
  await assert.rejects(loaded, /加载失败/);
  loaded = loadWorkspacePage(window, "http://127.0.0.1:30142");
  window.emit("closed");
  await assert.rejects(loaded, /窗口已关闭/);
  await assert.rejects(loadWorkspacePage(window, "http://127.0.0.1:30142", 40), /页面加载超时/);
  assert.equal(window.webContents.listenerCount("dom-ready"), 0);
});

test("退出途中服务先终止或 IPC 已断开时立即结束等待并清除监听", async () => {
  for (const mode of ["exit", "ipc-error"]) {
    const child = new EventEmitter();
    child.exitCode = null;
    child.send = (_message, callback) => {
      if (mode === "exit") child.emit("exit", 1);
      else callback(new Error("IPC 已关闭"));
    };
    await stopServer(child);
    assert.equal(child.listenerCount("message"), 0);
    assert.equal(child.listenerCount("exit"), 0);
    assert.equal(child.listenerCount("error"), 0);
  }
});
