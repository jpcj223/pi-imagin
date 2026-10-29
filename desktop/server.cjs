/* eslint-disable @typescript-eslint/no-require-imports */
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { flushCompileCache } = require("node:module");
const startupStarted = Date.now();
const desktopStartup = process.env.PI_IMAGIN_DESKTOP === "1";
function startupStage(stage) {
  if (desktopStartup) console.info(`[startup] backend ${stage} elapsed=${Date.now() - startupStarted}ms`);
}
startupStage(`entry pid=${process.pid} node=${process.versions.node} compileCache=${Boolean(process.env.NODE_COMPILE_CACHE)}`);
const rotationModule = fs.existsSync(path.join(__dirname, "rotate-preview-secrets.cjs"))
  ? path.join(__dirname, "rotate-preview-secrets.cjs") : path.join(__dirname, "../bin/rotate-preview-secrets.js");
// 与原有启动入口共用预览密钥轮换，打包时生成的值不能用于绕过认证。
const rotation = require(rotationModule).rotatePreviewSecrets(path.join(path.dirname(process.argv[2]), ".next"));
if (!rotation.ok) throw new Error("应用运行文件无法准备，请安装到当前用户可写的目录后重试。");
startupStage("preview secrets ready");
// 无网络探测、无文件扫描；只在首屏启动期间记录事件循环是否长期被阻塞。
// 这样能够区分 Node 尚未进入入口、模块同步载入和已进入可响应的等待。
let previousTick = Date.now(), lastPending = previousTick;
const startupWatch = desktopStartup ? setInterval(() => {
  const now = Date.now(), gap = now - previousTick;
  previousTick = now;
  if (gap >= 1500 || now - lastPending >= 5000) {
    lastPending = now;
    startupStage(`pending eventLoopGap=${gap}ms`);
  }
}, 1000) : undefined;
startupWatch?.unref();
function stopStartupWatch() { clearInterval(startupWatch); }
process.once("disconnect", stopStartupWatch);
// 主进程意外退出时，IPC 断开也回收本服务及其后代，不留下隐藏服务。
process.on("disconnect", () => {
  if (process.platform === "win32") {
    execFile("taskkill.exe", ["/PID", String(process.pid), "/T", "/F"], { windowsHide: true }, () => process.exit(0));
  } else {
    // 服务以独立进程组启动，只回收自身组，不触及桌面或其他应用。
    try { process.kill(-process.pid, "SIGKILL"); } catch { process.exit(0); }
  }
});
// Node 编译缓存放在桌面配置目录；明确刷盘，避免强制回收服务时丢失本次缓存。
process.on("message", message => {
  if (["pi-imagin:backend-ready", "pi-imagin:workspace-loaded", "pi-imagin:prepare-shutdown"].includes(message?.type)) {
    stopStartupWatch();
  }
  if (message?.type === "pi-imagin:workspace-loaded" || message?.type === "pi-imagin:prepare-shutdown") {
    try { flushCompileCache?.(); } catch { /* 缓存不可用不影响工作区。 */ }
  }
});
startupStage("next entry loading");
require(process.argv[2]);
startupStage("next entry required");
