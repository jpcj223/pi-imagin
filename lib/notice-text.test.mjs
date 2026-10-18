import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./notice-text.ts");
}

test("模型错误给出可操作提示，详细信息脱敏而普通工具错误不被误写",async()=>{
 const {modelNotice}=await loadSubject();
 const missing=modelNotice("No API key found for the selected model.\nUse /login. See: C:\\private\\providers.md","zh-CN");
 assert.match(missing.message,/缺少认证/);assert.equal(missing.action,"前往模型设置");assert.ok(!missing.message.includes("C:\\private"));
 assert.match(modelNotice("No models available","zh-CN").message,/没有可用/);
 assert.match(modelNotice("Invalid API key: sk-secret123","zh-CN").message,/认证失败/);
 assert.ok(!modelNotice("Invalid API key: sk-secret123 token=private-token","zh-CN").details.includes("secret123"));
 assert.ok(!modelNotice("Invalid API key: sk-secret123 token=private-token","zh-CN").details.includes("private-token"));
 assert.match(modelNotice("connect ECONNREFUSED","zh-CN").message,/连接失败/);
 assert.match(modelNotice("No API key found","en").message,/Authentication is missing/);
 assert.equal(modelNotice("File not found: /project/a.ts","zh-CN"),null);
});

// qrcode-terminal's `small` output: █ ▀ ▄ and runs of spaces that must keep their width.
const QR = [
  "▄▄▄▄▄▄▄▄▄▄▄",
  "█ ▄▄▄ █▀▄ █",
  "█ █   █  ▄█",
  "█▄▄▄▄▄█▄▀▄█",
  "▀▀▀▀▀▀▀▀▀▀▀",
].join("\n");

test("keeps a terminal QR code in a notice apart from its prose (#755)", async () => {
  const { splitNoticeText } = await loadSubject();
  const message = `请用微信扫码登录：\n\n${QR}\n\n二维码链接：https://example.com/q`;

  const parts = splitNoticeText(message);

  assert.deepEqual(parts, [
    { kind: "text", text: "请用微信扫码登录：\n\n" },
    { kind: "art", text: QR },
    { kind: "text", text: "\n\n二维码链接：https://example.com/q" },
  ]);
  assert.equal(parts.map((part) => part.text).join(""), message);
});

test("leaves a notice without block characters as one piece of prose", async () => {
  const { splitNoticeText } = await loadSubject();

  assert.deepEqual(splitNoticeText("Saved   to\n  disk"), [{ kind: "text", text: "Saved   to\n  disk" }]);
  assert.deepEqual(splitNoticeText(""), []);
});

test("starts a new run after a line without blocks", async () => {
  const { splitNoticeText } = await loadSubject();

  assert.deepEqual(splitNoticeText("█▀█\n\n█▄█\nok ▌"), [
    { kind: "art", text: "█▀█" },
    { kind: "text", text: "\n\n" },
    { kind: "art", text: "█▄█\nok ▌" },
  ]);
});
