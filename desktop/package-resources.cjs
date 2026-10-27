/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { buildTarget, packageResources } = require("./platform.cjs");

const manifestName = ".desktop-framework-manifest.json";
const frameworkRoots = ["next", "@next"];
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const isLicense = file => /^(?:license|licence|notice|copying)(?:[.-]|$)/i.test(path.basename(file));

function assertResourceWithin(root, target) {
  if (!fs.existsSync(target)) return;
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(target));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("安装资源链接超出目标目录");
}

function filesWithin(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  function visit(current) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("安装资源不能包含目录链接");
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("安装资源不能包含文件链接");
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  visit(directory);
  return files;
}

/** 在 npm 补齐动态 SDK 依赖之前保存同一次生产构建的框架运行清单。 */
function createFrameworkManifest(standalone) {
  const modules = path.join(standalone, "node_modules");
  const files = {};
  for (const name of frameworkRoots) {
    for (const file of filesWithin(path.join(modules, name))) {
      files[path.relative(modules, file).split(path.sep).join("/")] = digest(file);
    }
  }
  for (const required of ["next/package.json", "next/dist/server/next.js", "next/dist/server/lib/start-server.js", "@next/env/package.json"]) {
    if (!files[required]) throw new Error(`生产框架追踪不完整：${required}`);
  }
  return { version: 1, buildId: fs.readFileSync(path.join(standalone, ".next/BUILD_ID"), "utf8").trim(), files };
}

function validateFrameworkManifest(server, manifest) {
  if (manifest?.version !== 1 || !manifest.files || !Object.keys(manifest.files).length ||
      manifest.buildId !== fs.readFileSync(path.join(server, ".next/BUILD_ID"), "utf8").trim()) throw new Error("框架清单与桌面生产构建不一致");
  for (const required of ["next/package.json", "next/dist/server/next.js", "next/dist/server/lib/start-server.js", "@next/env/package.json"]) {
    if (!manifest.files[required]) throw new Error(`框架清单缺少运行入口：${required}`);
  }
  for (const [relative, hash] of Object.entries(manifest.files)) {
    if (!/^(?:next|@next)\//.test(relative) || relative.includes("\\") || relative.split("/").some(part => !part || part === "." || part === "..") || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("框架清单路径或校验值无效");
    const file = path.join(server, "node_modules", relative);
    const isMap = /\.(?:[cm]?js|[cm]?ts|css)\.map$/i.test(relative);
    // 调试映射可能已由前一次整理删除，其余运行文件必须逐一匹配。
    if (isMap && !fs.existsSync(file) && fs.existsSync(file.slice(0, -4))) continue;
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink() || digest(file) !== hash) throw new Error(`框架运行文件与构建清单不一致：${relative}`);
  }
}

function pruneRuntimeResources(server, manifest, nativeTarget = `${process.platform}-${process.arch}`) {
  validateFrameworkManifest(server, manifest);
  const modules = path.join(server, "node_modules");
  assertResourceWithin(server, modules);
  const remove = [];
  for (const name of frameworkRoots) {
    assertResourceWithin(modules, path.join(modules, name));
    for (const file of filesWithin(path.join(modules, name))) {
      const relative = path.relative(modules, file).split(path.sep).join("/");
      // 始终保留原许可证，包括框架内附带依赖的声明。
      if (!manifest.files[relative] && !isLicense(file)) remove.push(file);
    }
  }
  const prebuilds = path.join(modules, "node-pty/prebuilds");
  assertResourceWithin(modules, prebuilds);
  for (const file of filesWithin(prebuilds)) {
    const relative = path.relative(prebuilds, file).split(path.sep);
    // 保留本次目标的原生模块与辅助程序，PDB 只用于 Windows 原生调试。
    if (!isLicense(file) && (relative[0] !== nativeTarget || file.toLowerCase().endsWith(".pdb"))) remove.push(file);
  }
  const result = { files: 0, bytes: 0 };
  for (const file of remove) {
    result.bytes += fs.statSync(file).size;
    fs.unlinkSync(file);
    result.files++;
  }
  return result;
}

function pruneElectronLocales(output) {
  const directory = path.join(output, "locales");
  assertResourceWithin(output, directory);
  const languages = require("./package.json").build.electronLanguages;
  // 与界面已支持的英语、简体和繁体中文保持一致；缺少资源时不继续裁剪。
  for (const language of languages) {
    if (!fs.existsSync(path.join(directory, `${language}.pak`))) throw new Error(`缺少桌面语言资源：${language}`);
  }
  const result = { files: 0, bytes: 0 };
  for (const file of filesWithin(directory)) {
    if (path.extname(file) !== ".pak" || languages.includes(path.basename(file, ".pak"))) continue;
    result.bytes += fs.statSync(file).size;
    fs.unlinkSync(file);
    result.files++;
  }
  return result;
}

/** 仅排除附带原文件的调试映射，保留运行代码、声明、SDK 文档与许可证。 */
function pruneSourceMaps(directory) {
  const result = { files: 0, bytes: 0 };
  if (!fs.existsSync(directory)) return result;
  if (fs.lstatSync(directory).isSymbolicLink()) return result;
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      // 不跟随链接，不碰依赖目录之外的文件。
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.(?:[cm]?js|[cm]?ts|css)\.map$/i.test(entry.name) && fs.existsSync(file.slice(0, -4))) {
        const bytes = fs.statSync(file).size;
        fs.unlinkSync(file);
        result.files++;
        result.bytes += bytes;
      }
    }
  }
  visit(directory);
  return result;
}

function optimizePackage(appOutDir, platform = process.platform, arch = process.arch, productName = "Pi Imagin") {
  const output = path.resolve(appOutDir);
  const repo = path.resolve(__dirname, "..");
  const relative = path.relative(repo, output);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("只允许整理仓库内的桌面构建产物");
  const target = buildTarget(platform, arch);
  const resources = packageResources(output, platform, productName);
  for (const file of ["app.asar", "server/server.js", path.join("node", target.nodeRelative)]) {
    if (!fs.existsSync(path.join(resources, file))) throw new Error(`桌面构建资源不完整：${file}`);
  }
  const actualOutput = path.relative(fs.realpathSync(repo), fs.realpathSync(resources));
  if (actualOutput === ".." || actualOutput.startsWith(`..${path.sep}`) || path.isAbsolute(actualOutput)) throw new Error("构建资源链接指向仓库外，拒绝整理");
  const server = path.join(resources, "server");
  assertResourceWithin(resources, server);
  assertResourceWithin(resources, path.join(resources, "node/node_modules"));
  const manifest = JSON.parse(fs.readFileSync(path.join(server, manifestName), "utf8"));
  const result = pruneRuntimeResources(server, manifest, target.nativeTarget);
  // macOS 的语言资源在 Framework 的 lproj 中，由 electronLanguages 处理。
  const locales = platform === "darwin" ? { files: 0, bytes: 0 } : pruneElectronLocales(output);
  result.files += locales.files;
  result.bytes += locales.bytes;
  for (const relative of ["server/node_modules", platform === "win32" ? "node/node_modules" : "node/lib/node_modules"]) {
    const pruned = pruneSourceMaps(path.join(resources, relative));
    result.files += pruned.files;
    result.bytes += pruned.bytes;
  }
  console.log(`安装资源精简：移除 ${result.files} 个非运行文件，减少 ${(result.bytes / 1024 / 1024).toFixed(1)} MiB`);
  return result;
}

// 正常打包通过 afterPack 调用；已有生产资源可直接整理后重新生成安装器。
module.exports = context => optimizePackage(context.appOutDir, context.electronPlatformName, ({ 1: "x64", 3: "arm64" })[context.arch], context.packager.appInfo.productFilename);
module.exports.optimizePackage = optimizePackage;
module.exports.pruneSourceMaps = pruneSourceMaps;
module.exports.createFrameworkManifest = createFrameworkManifest;
module.exports.pruneRuntimeResources = pruneRuntimeResources;
module.exports.manifestName = manifestName;
module.exports.pruneElectronLocales = pruneElectronLocales;
if (require.main === module) {
  try { optimizePackage(process.argv[2] || path.join(__dirname, "../dist-desktop/win-unpacked")); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
