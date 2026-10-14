"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execFileSync, spawnSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require("../package.json");

const NPM_LATEST_URL = "https://registry.npmjs.org/pi-imagin/latest";
const FETCH_TIMEOUT_MS = 10_000;
const MANUAL_COMMAND = "npm install -g pi-imagin@latest";

// 对应 lib/app-update.ts 的纯 JavaScript 实现，命令入口不能直接导入 TypeScript。
function parseStableVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function isNewerStableVersion(candidate, current) {
  const candidateParts = parseStableVersion(candidate);
  const currentParts = parseStableVersion(current);
  if (!candidateParts || !currentParts) return false;
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
}

async function fetchLatestVersion() {
  const response = await fetch(NPM_LATEST_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  const { version } = await response.json();
  if (typeof version !== "string" || !parseStableVersion(version)) {
    throw new Error("npm registry returned an invalid version");
  }
  return version;
}

// 使用当前 Node 执行 npm 自身的 CLI 文件，避免 Windows Shell，
// 查找方式与 lib/node-cli.ts 一致；无法安全启动时返回 null。
function findNpmInvocation(args, nodeDir = path.dirname(process.execPath), platform = process.platform, exists = fs.existsSync) {
  for (const script of [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ]) {
    if (exists(script)) return { command: process.execPath, args: [script, ...args] };
  }
  return platform === "win32" ? null : { command: "npm", args };
}

function realpathOrSelf(target, realpath = fs.realpathSync) {
  try {
    return realpath(target);
  } catch {
    return path.resolve(target);
  }
}

// 安装类型：全局 npm 目录中的 pi-imagin、npx 缓存，或其他本地目录。
function getInstallKind({ pkgDir, npmRoot, realpath = fs.realpathSync }) {
  const realPkgDir = realpathOrSelf(pkgDir, realpath);
  if (realPkgDir.split(/[\\/]/).includes("_npx")) return "npx";
  if (!npmRoot) return "other";
  const inGlobalRoot =
    path.basename(realPkgDir) === "pi-imagin" &&
    realpathOrSelf(path.dirname(realPkgDir), realpath) === realpathOrSelf(npmRoot, realpath);
  return inGlobalRoot ? "global" : "other";
}

function getGlobalNpmRoot() {
  const invocation = findNpmInvocation(["root", "-g"]);
  if (!invocation) return null;
  try {
    return execFileSync(invocation.command, invocation.args, { encoding: "utf8", timeout: 30_000 }).trim();
  } catch {
    return null;
  }
}

function runNpmInstall(version) {
  const invocation = findNpmInvocation(["install", "-g", `pi-imagin@${version}`]);
  if (!invocation) return null;
  const result = spawnSync(invocation.command, invocation.args, { stdio: "inherit" });
  return result.status ?? 1;
}

async function runUpdate({
  check,
  currentVersion,
  pkgDir,
  listRecords,
  formatRecord,
  fetchLatest = fetchLatestVersion,
  getNpmRoot = getGlobalNpmRoot,
  install = runNpmInstall,
  realpath = fs.realpathSync,
  log = console.log,
  error = console.error,
  updatesEnabled = packageJson.private !== true,
}) {
  if (!updatesEnabled) {
    log("Pi Imagin is a local project. Automatic updates are not configured.");
    return 0;
  }
  let latest;
  try {
    latest = await fetchLatest();
  } catch (fetchError) {
    error(`Could not check for updates: ${fetchError.message}`);
    return 1;
  }
  if (!isNewerStableVersion(latest, currentVersion)) {
    log(`pi-imagin ${currentVersion} is up to date.`);
    return 0;
  }
  log(`pi-imagin ${latest} is available (installed: ${currentVersion}).`);
  if (check) return 0;

  // next start 正在使用 .next 时，不能直接替换其文件。
  const running = await listRecords();
  if (running.length > 0) {
    error(`pi-imagin is running:\n${running.map(formatRecord).join("\n")}\nRun \`pi-imagin stop\` first, then update.`);
    return 1;
  }

  const kind = getInstallKind({ pkgDir, npmRoot: getNpmRoot(), realpath });
  if (kind === "npx") {
    error("This pi-imagin runs from the npx cache. Run `npm run dev` instead.");
    return 1;
  }
  if (kind !== "global") {
    error(`This pi-imagin is not a global npm install. Update it yourself, for example: ${MANUAL_COMMAND}`);
    return 1;
  }

  const code = install(latest);
  if (code === null) {
    error(`Could not find npm. Run: ${MANUAL_COMMAND}`);
    return 1;
  }
  return code;
}

module.exports = { findNpmInvocation, getInstallKind, isNewerStableVersion, runUpdate };
