/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn } = require("node:child_process");
const extract = require("extract-zip");

const root = path.resolve(__dirname, "..");
const buildRoot = path.join(root, "build");
const nodeVersion = "22.23.3";
const nodeName = `node-v${nodeVersion}-win-x64`;

function cleanBuildDirectory(target) {
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== buildRoot || !path.basename(resolved).startsWith("desktop-")) throw new Error("构建目录不在预期范围，拒绝清理");
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: "inherit", windowsHide: true, ...options });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`构建步骤失败，退出码 ${code}`)));
  });
}

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`官方下载失败：HTTP ${response.status}`);
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

async function prepareNode() {
  const cache = path.join(buildRoot, "desktop-downloads");
  fs.mkdirSync(cache, { recursive: true });
  const zip = path.join(cache, `${nodeName}.zip`);
  const sums = await fetch(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`).then(response => {
    if (!response.ok) throw new Error("无法获取官方运行时校验表");
    return response.text();
  });
  const expected = sums.split("\n").find(line => line.trim().endsWith(` ${nodeName}.zip`))?.trim().split(/\s+/)[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("运行时校验信息不完整");
  if (!fs.existsSync(zip)) await download(`https://nodejs.org/dist/v${nodeVersion}/${nodeName}.zip`, zip);
  const actual = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
  if (actual !== expected) { fs.unlinkSync(zip); throw new Error("运行时校验失败，已移除下载文件，请重试"); }
  const extraction = path.join(buildRoot, "desktop-extracted");
  cleanBuildDirectory(extraction);
  await extract(zip, { dir: extraction });
  const target = path.join(buildRoot, "desktop-node");
  cleanBuildDirectory(target);
  fs.cpSync(path.join(extraction, nodeName), target, { recursive: true });
  return target;
}

async function prepare() {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("当前安装包构建面向 Windows x64");
  const devRunning = await new Promise(resolve => {
    const socket = net.connect({ host: "127.0.0.1", port: 30141 });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
  if (devRunning) throw new Error("请先停止本项目的开发服务，再构建安装包，避免覆盖 .next");
  fs.mkdirSync(buildRoot, { recursive: true });
  console.log("正在准备并校验内置 Node.js 运行时…");
  const nodeDir = await prepareNode();
  console.log("正在构建生产工作区…");
  await run(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build", "--webpack"], { env: { ...process.env, PI_IMAGIN_DESKTOP_BUILD: "1" } });
  const server = path.join(buildRoot, "desktop-server");
  cleanBuildDirectory(server);
  fs.cpSync(path.join(root, ".next/standalone"), server, { recursive: true });
  fs.cpSync(path.join(root, ".next/static"), path.join(server, ".next/static"), { recursive: true });
  fs.cpSync(path.join(root, "public"), path.join(server, "public"), { recursive: true });
  // 外置 SDK 含动态加载资源和原生模块，安装完整生产依赖，避免文件追踪遗漏。
  fs.copyFileSync(path.join(root, "package.json"), path.join(server, "package.json"));
  fs.copyFileSync(path.join(root, "package-lock.json"), path.join(server, "package-lock.json"));
  await run(path.join(nodeDir, "node.exe"), [path.join(nodeDir, "node_modules/npm/bin/npm-cli.js"), "ci", "--prefix", server, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: server });
  const icons = path.join(buildRoot, "desktop-icons");
  cleanBuildDirectory(icons);
  const sharp = require(path.join(root, "node_modules/sharp"));
  const png = await sharp(path.join(root, "public/icons/icon-ocean-512.png")).resize(256, 256).png().toBuffer();
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(icons, "icon.ico"), Buffer.concat([header, png]));
  fs.writeFileSync(path.join(buildRoot, "desktop-build.json"), JSON.stringify({ nodeVersion, nodeSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(nodeDir, "node.exe"))).digest("hex"), time: new Date().toISOString() }, null, 2));
  console.log("正在生成 Windows 安装包…");
  await run(process.execPath, [path.join(__dirname, "node_modules/electron-builder/out/cli/cli.js"), "--win", "nsis", "--x64", "--publish", "never"], { cwd: __dirname });
}

prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
