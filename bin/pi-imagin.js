#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getHelpText, parseCommandLine } = require("./pi-imagin-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getNextNodeArgs } = require("./pi-imagin-node-args");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { wireChildProcessLifecycle } = require("./process-lifecycle");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { rotatePreviewSecrets, getRotationWarning } = require("./rotate-preview-secrets");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { openInBrowser } = require("./browser-opener");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRunRecordTracker, getOpenUrl, getRunDir } = require("./run-records");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getPackageVersion, runCommand } = require("./pi-imagin-commands");

let launchOptions;
try {
  launchOptions = parseCommandLine();
} catch (error) {
  fs.writeSync(
    process.stderr.fd,
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

if (launchOptions.help) {
  fs.writeSync(process.stdout.fd, getHelpText());
  process.exit(0);
}

if (launchOptions.command === "start") {
  startServer(launchOptions);
} else {
  runCommand(launchOptions).then(
    exitWhenIdle,
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      exitWhenIdle(1);
    },
  );
}

// 等待事件循环自然结束，不在 fetch 完成后立即强制退出。
// Windows 的部分 Node 版本会在后台网络工作仍未结束时，
// 触发 libuv 的 UV_HANDLE_CLOSING 断言。
// 这会中止正常 CLI 退出流程。
// 使用不保持事件循环存活的计时器，仅在仍有后台任务时兜底退出。
function exitWhenIdle(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 2_000).unref();
}

function startServer({ port, hostname, openBrowser }) {

  const pkgDir = path.join(__dirname, "..");
  const nextDir = path.join(pkgDir, ".next");

  // 直接解析 Next 的 JavaScript 命令入口，
  // 避免 npx 安装中可能缺失的 .bin 符号链接。
  let nextBin;
  try {
    nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
  } catch {
    // 兜底查找 Next 包根目录，再拼接启动文件路径。
    try {
      const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
      nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
    } catch {
      nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
    }
  }

  const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const passwordEnabled = Boolean(process.env.PI_WEB_PASSWORD);

  if (!fs.existsSync(nextDir)) {
    console.error("Build artifacts not found. Please report this issue.");
    process.exit(1);
  }

  // 启动前生成新预览密钥，
  // 让安装包中固化的 previewModeId 不能通过请求头
  // 绕过代理；必须在 next start 之前完成。
  const rotation = rotatePreviewSecrets(nextDir);
  if (!rotation.ok) {
    console.warn(getRotationWarning(rotation.reason));
  }

  if (!loopbackHostnames.has(hostname)) {
    if (passwordEnabled) {
      console.warn(
        `Warning: pi-imagin is listening on ${hostname} with password authentication over HTTP. Use HTTPS or a trusted VPN to protect the password in transit.`,
      );
    } else {
      console.warn(
        `Warning: pi-imagin is listening on ${hostname} without authentication. Only use this on a trusted network.`,
      );
    }
  }

  const nextArgs = ["start", "-p", port];
  nextArgs.push("-H", hostname);

  // 始终使用 Node 直接运行 Next 的 JavaScript 入口，
  // 避免 Windows 下 .bin 链接和 Shell 处理含空格路径的问题。
  const child = spawn(process.execPath, getNextNodeArgs(nextBin, nextArgs), {
    cwd: pkgDir,
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env, PI_WEB_HOSTNAME: hostname },
  });
  wireChildProcessLifecycle(child);

  // 端口 0 由系统分配，但启动器不知道最终端口，因此不写运行记录。
  const runRecord = createRunRecordTracker({
    dir: getRunDir,
    record: {
      pid: process.pid,
      nextPid: child.pid,
      port: Number(port),
      hostname,
      url: getOpenUrl(hostname, port),
      version: getPackageVersion(pkgDir),
      startedAt: new Date().toISOString(),
    },
  });

  let serverReady = false;
  const url = `http://${hostname}:${port}`;

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (!serverReady && text.includes("Ready")) {
      serverReady = true;
      if (port !== "0") runRecord.markReady();
      if (openBrowser) openInBrowser(url);
    }
  });
}
