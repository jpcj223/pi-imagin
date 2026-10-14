// 兼容旧版 node-pty 在 macOS 上缺少 spawn-helper 执行权限的问题。
// 上游包能够正确保留执行权限后可移除此兼容处理。
/* eslint-disable @typescript-eslint/no-require-imports */
const { chmodSync, statSync } = require("node:fs");
const { dirname, join } = require("node:path");

if (process.platform === "darwin") {
  const root = dirname(require.resolve("node-pty/package.json"));
  for (const directory of ["build/Release", "build/Debug", `prebuilds/darwin-${process.arch}`]) {
    const helper = join(root, directory, "spawn-helper");
    const stat = statSync(helper, { throwIfNoEntry: false });
    if (stat?.isFile() && (stat.mode & 0o111) !== 0o111) chmodSync(helper, stat.mode | 0o111);
  }
}
