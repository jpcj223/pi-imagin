/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

/** AppImage 和签名的 macOS 包保持只读；预览密钥与 Next 缓存写入用户目录。 */
function prepareWritableServer(source, profile) {
  const buildId = fs.readFileSync(path.join(source, ".next/BUILD_ID"), "utf8").trim();
  if (!buildId) throw new Error("桌面生产构建标识缺失");
  const key = createHash("sha256").update(buildId).digest("hex").slice(0, 24);
  const parent = path.join(profile, "server-runtime");
  const target = path.join(parent, key);
  fs.mkdirSync(parent, { recursive: true });
  if (!fs.existsSync(target)) {
    const staging = fs.mkdtempSync(path.join(parent, `${key}-`));
    // 只复制可写框架产物，庞大的依赖和静态资源继续只读复用安装包。
    for (const name of [".next", "server.js", "package.json"]) {
      fs.cpSync(path.join(source, name), path.join(staging, name), { recursive: true, dereference: true });
    }
    fs.writeFileSync(path.join(staging, ".pi-imagin-build"), buildId);
    fs.renameSync(staging, target);
  }
  if (fs.lstatSync(target).isSymbolicLink() || fs.readFileSync(path.join(target, ".pi-imagin-build"), "utf8") !== buildId) {
    throw new Error("用户目录中的桌面运行副本不属于当前构建");
  }
  // AppImage 每次挂载的路径可能变化，重新关联本次安装资源。
  for (const name of ["node_modules", "public"]) {
    const installed = path.join(source, name), link = path.join(target, name);
    if (!fs.existsSync(installed)) continue;
    const stat = fs.lstatSync(link, { throwIfNoEntry: false });
    if (stat && !stat.isSymbolicLink()) throw new Error(`运行资源 ${name} 不是预期链接`);
    if (stat) fs.unlinkSync(link);
    fs.symlinkSync(installed, link, process.platform === "win32" ? "junction" : "dir");
  }
  return target;
}

module.exports = { prepareWritableServer };
