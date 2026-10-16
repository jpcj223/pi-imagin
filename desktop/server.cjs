/* eslint-disable @typescript-eslint/no-require-imports */
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { flushCompileCache } = require("node:module");
const rotationModule = fs.existsSync(path.join(__dirname, "rotate-preview-secrets.cjs"))
  ? path.join(__dirname, "rotate-preview-secrets.cjs") : path.join(__dirname, "../bin/rotate-preview-secrets.js");
// 与原有启动入口共用预览密钥轮换，打包时生成的值不能用于绕过认证。
const rotation = require(rotationModule).rotatePreviewSecrets(path.join(path.dirname(process.argv[2]), ".next"));
if (!rotation.ok) throw new Error("应用运行文件无法准备，请安装到当前用户可写的目录后重试。");
// 主进程意外退出时，IPC 断开也回收本服务及其后代，不留下隐藏服务。
process.on("disconnect", () => {
  execFile("taskkill.exe", ["/PID", String(process.pid), "/T", "/F"], { windowsHide: true }, () => process.exit(0));
});
// Node 编译缓存放在桌面配置目录；明确刷盘，避免强制回收服务时丢失本次缓存。
process.on("message", message => {
  if (message?.type === "pi-imagin:workspace-loaded" || message?.type === "pi-imagin:prepare-shutdown") {
    try { flushCompileCache?.(); } catch { /* 缓存不可用不影响工作区。 */ }
  }
});
require(process.argv[2]);
