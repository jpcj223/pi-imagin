/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

/** 原生依赖随构建宿主生成，不允许用另一平台的依赖拼出安装包。 */
function buildTarget(platform = process.platform, arch = process.arch) {
  if (!["win32", "darwin", "linux"].includes(platform) || !["x64", "arm64"].includes(arch) || (platform === "win32" && arch !== "x64")) {
    throw new Error(`尚未支持的桌面构建目标：${platform}-${arch}`);
  }
  return {
    platform, arch, nativeTarget: `${platform}-${arch}`,
    archivePlatform: platform === "win32" ? "win" : platform,
    archiveExtension: platform === "win32" ? "zip" : "tar.gz",
    nodeRelative: platform === "win32" ? "node.exe" : "bin/node",
    npmRelative: platform === "win32" ? "node_modules/npm/bin/npm-cli.js" : "lib/node_modules/npm/bin/npm-cli.js",
    builderArgs: platform === "win32" ? ["--win", "nsis"] : platform === "darwin" ? ["--mac", "dmg", "zip"] : ["--linux", "AppImage", "deb"],
  };
}

function packageResources(output, platform = process.platform, productName = "Pi Imagin") {
  return platform === "darwin" ? path.join(output, `${productName}.app`, "Contents", "Resources") : path.join(output, "resources");
}

module.exports = { buildTarget, packageResources };
