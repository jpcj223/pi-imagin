/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pruneSourceMaps, optimizePackage, createFrameworkManifest, pruneRuntimeResources, pruneElectronLocales } = require("./package-resources.cjs");

test("桌面语言资源保留英语、简体和繁体中文，缺少支持语言时停止", t => {
  const { directory, write } = fixture(t);
  for (const name of ["en-US", "en-GB", "zh-CN", "zh-TW", "fr"]) write(`locales/${name}.pak`);
  assert.equal(pruneElectronLocales(directory).files, 1);
  assert.deepEqual(fs.readdirSync(path.join(directory, "locales")).sort(), ["en-GB.pak", "en-US.pak", "zh-CN.pak", "zh-TW.pak"]);
  fs.unlinkSync(path.join(directory, "locales/zh-CN.pak"));
  assert.throws(() => pruneElectronLocales(directory), /缺少桌面语言/);
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-imagin-framework-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (name, body = "fixture") => {
    const file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  };
  write(".next/BUILD_ID", "test-build");
  for (const name of ["next/package.json", "next/dist/server/next.js", "next/dist/server/lib/start-server.js", "@next/env/package.json"]) write(`node_modules/${name}`);
  const manifest = createFrameworkManifest(directory);
  return { directory, write, manifest };
}

test("生产清单只裁剪框架开发资源和非目标终端二进制，保留 SDK、npm、许可证及 x64 原生模块", t => {
  const { directory, write, manifest } = fixture(t);
  const removed = ["next/dist/build/compiler.js", "@next/swc-win32-x64-msvc/compiler.node", "node-pty/prebuilds/linux-x64/pty.node", "node-pty/prebuilds/win32-arm64/conpty.node", "node-pty/prebuilds/win32-x64/conpty.pdb"];
  const kept = ["next/LICENSE.md", "next/dist/compiled/example/NOTICE", "@next/swc-win32-x64-msvc/LICENSE", "@earendil-works/pi-coding-agent/dist/index.js", "@earendil-works/pi-coding-agent/docs/extensions.md", "@earendil-works/pi-coding-agent/dist/index.d.ts", "npm/bin/npm-cli.js", "@esbuild/win32-x64/esbuild.exe", "node-pty/prebuilds/linux-x64/LICENSE", "node-pty/prebuilds/win32-x64/conpty.node", "node-pty/prebuilds/win32-x64/conpty/conpty.dll", "node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe"];
  for (const name of [...removed, ...kept]) write(`node_modules/${name}`);
  assert.equal(pruneRuntimeResources(directory, manifest, "win32-x64").files, removed.length);
  for (const name of removed) assert.equal(fs.existsSync(path.join(directory, "node_modules", name)), false, name);
  for (const name of [...kept, ...Object.keys(manifest.files)]) assert.ok(fs.existsSync(path.join(directory, "node_modules", name)), name);
  assert.deepEqual(pruneRuntimeResources(directory, manifest, "win32-x64"), { files: 0, bytes: 0 });
});

test("构建标识、校验值或清单路径错误时停止，不先删除资源", t => {
  const { directory, write, manifest } = fixture(t);
  const extra = write("node_modules/next/dist/build/compiler.js");
  assert.throws(() => pruneRuntimeResources(directory, { ...manifest, buildId: "other-build" }), /不一致/);
  const invalid = structuredClone(manifest);
  invalid.files["next/../../outside"] = "0".repeat(64);
  assert.throws(() => pruneRuntimeResources(directory, invalid), /无效/);
  write("node_modules/next/dist/server/next.js", "changed");
  assert.throws(() => pruneRuntimeResources(directory, manifest), /不一致/);
  assert.ok(fs.existsSync(extra));
});

test("缺少框架入口时不生成或使用清单", t => {
  const { directory, manifest } = fixture(t);
  fs.unlinkSync(path.join(directory, "node_modules/next/dist/server/next.js"));
  assert.throws(() => createFrameworkManifest(directory), /不完整/);
  delete manifest.files["next/dist/server/next.js"];
  assert.throws(() => pruneRuntimeResources(directory, manifest), /缺少运行入口/);
});

test("整理调试映射不会删掉运行代码、声明、SDK 资源或许可证，重复执行安全", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-imagin-package-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ["bundle.js", "bundle.js.map", "types.d.ts", "types.d.ts.map", "runtime.map", "orphan.js.map", "README.md", "LICENSE", "extension.ts", "native.node"]) fs.writeFileSync(path.join(directory, name), "fixture");
  assert.deepEqual(pruneSourceMaps(directory), { files: 2, bytes: 14 });
  assert.deepEqual(fs.readdirSync(directory).sort(), ["bundle.js", "types.d.ts", "runtime.map", "orphan.js.map", "README.md", "LICENSE", "extension.ts", "native.node"].sort());
  assert.deepEqual(pruneSourceMaps(directory), { files: 0, bytes: 0 });
});

test("拒绝整理仓库外目录和不完整产物", () => {
  assert.throws(() => optimizePackage(os.tmpdir()), /仓库内/);
  assert.throws(() => optimizePackage(__dirname), /资源不完整/);
});

test("安装器使用直接解压且保持原升级身份和用户数据策略", () => {
  const { build } = require("./package.json");
  assert.equal(build.afterPack, "./package-resources.cjs");
  assert.equal(build.nsis.useZip, true);
  assert.equal(build.nsis.differentialPackage, false);
  assert.equal(build.appId, "local.pi-imagin.desktop");
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(build.nsis.allowToChangeInstallationDirectory, true);
});
