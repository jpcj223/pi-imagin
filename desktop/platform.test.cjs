/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildTarget, packageResources } = require("./platform.cjs");
const { pathsFor } = require("./runtime.cjs");
const { prepareWritableServer } = require("./writable-server.cjs");
const { pruneRuntimeResources, createFrameworkManifest } = require("./package-resources.cjs");

test("运行时、归档、安装目标与原生依赖使用同一平台和架构", () => {
  for (const [platform, arch] of [["win32", "x64"], ["darwin", "arm64"], ["darwin", "x64"], ["linux", "x64"], ["linux", "arm64"]]) {
    const target = buildTarget(platform, arch);
    const files = pathsFor({ isPackaged: true }, path.resolve("resources"), platform, arch);
    assert.equal(files.node, path.resolve("resources/node", target.nodeRelative));
    assert.equal(target.nativeTarget, `${platform}-${arch}`);
    assert.equal(target.archiveExtension, platform === "win32" ? "zip" : "tar.gz");
    assert.ok(target.builderArgs.includes(platform === "win32" ? "--win" : platform === "darwin" ? "--mac" : "--linux"));
  }
  assert.throws(() => buildTarget("linux", "ia32"), /尚未支持/);
  assert.equal(packageResources("out", "darwin"), path.join("out", "Pi Imagin.app/Contents/Resources"));
  assert.equal(packageResources("out", "linux"), path.join("out", "resources"));
});

test("只读安装资源独立生成可写副本，复用缓存且刷新 AppImage 依赖链接", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-writable-server-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function installed(name) {
    const source = path.join(root, name);
    for (const dir of [".next", "public", "node_modules"]) fs.mkdirSync(path.join(source, dir), { recursive: true });
    for (const [file, value] of [[".next/BUILD_ID", "same-build"], [".next/prerender-manifest.json", "original"], ["server.js", "server"], ["package.json", "{}"]]) fs.writeFileSync(path.join(source, file), value);
    return source;
  }
  const first = installed("first"), second = installed("remounted");
  const profile = path.join(root, "profile");
  const runtime = prepareWritableServer(first, profile);
  fs.writeFileSync(path.join(runtime, ".next/prerender-manifest.json"), "rotated");
  assert.equal(fs.readFileSync(path.join(first, ".next/prerender-manifest.json"), "utf8"), "original");
  assert.equal(prepareWritableServer(second, profile), runtime);
  assert.equal(fs.readFileSync(path.join(runtime, ".next/prerender-manifest.json"), "utf8"), "rotated");
  assert.equal(fs.realpathSync(path.join(runtime, "node_modules")), fs.realpathSync(path.join(second, "node_modules")));
  fs.writeFileSync(path.join(runtime, ".pi-imagin-build"), "other");
  assert.throws(() => prepareWritableServer(first, profile), /不属于/);
});

test("资源裁剪分别保留 macOS 与 Linux 目标的终端模块和辅助程序", t => {
  for (const target of ["darwin-arm64", "darwin-x64", "linux-x64"]) {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "pi-native-prune-"));
    t.after(() => fs.rmSync(source, { recursive: true, force: true }));
    function write(file) { const full = path.join(source, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, "fixture"); }
    write(".next/BUILD_ID");
    for (const file of ["next/package.json", "next/dist/server/next.js", "next/dist/server/lib/start-server.js", "@next/env/package.json"]) write(`node_modules/${file}`);
    const manifest = createFrameworkManifest(source);
    for (const native of [target, "win32-x64"]) write(`node_modules/node-pty/prebuilds/${native}/pty.node`);
    write(`node_modules/node-pty/prebuilds/${target}/spawn-helper`);
    pruneRuntimeResources(source, manifest, target);
    assert.ok(fs.existsSync(path.join(source, `node_modules/node-pty/prebuilds/${target}/pty.node`)));
    assert.ok(fs.existsSync(path.join(source, `node_modules/node-pty/prebuilds/${target}/spawn-helper`)));
    assert.equal(fs.existsSync(path.join(source, "node_modules/node-pty/prebuilds/win32-x64/pty.node")), false);
  }
});
