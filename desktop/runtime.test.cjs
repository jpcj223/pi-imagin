/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const { isOwnedUrl, isExternalUrl, waitForServer, pathsFor } = require("./runtime.cjs");
const { EventEmitter } = require("node:events");
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
  const files = pathsFor({ isPackaged: true }, "C:/app/resources");
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
