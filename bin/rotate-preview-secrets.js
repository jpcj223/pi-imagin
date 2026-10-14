"use strict";

// 构建产物包含 .next/prerender-manifest.json，
// 其中的 preview 区保存构建时生成的预览密钥。
// Next 将 previewModeId 与 x-prerender-revalidate 请求头比较；
// 匹配时会将请求视为按需重新验证，
// 并跳过中间件或代理，相关逻辑位于 Next 的 runMiddleware。
// 若发布产物复用固定密钥，
// 读取安装包的攻击者就可能构造请求绕过 proxy.ts，
// 绕过密码门禁和 Host、Origin、Fetch Metadata 检查。
//
// next start 只从该文件读取密钥，不支持运行时环境覆盖，
// 也不会重新生成；启动前将三个预览密钥
// 替换为新随机值，使发布产物中的值失效，
// 每次启动也拥有独立的值。
// 处理放在必经的启动入口而不是安装钩子中，
// 避免 --ignore-scripts 跳过保护。

// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require("crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const PRERENDER_MANIFEST = "prerender-manifest.json";

function freshPreviewSecrets() {
  return {
    // 密钥长度与 Next 构建时生成的长度一致。
    previewModeId: crypto.randomBytes(16).toString("hex"),
    previewModeSigningKey: crypto.randomBytes(32).toString("hex"),
    previewModeEncryptionKey: crypto.randomBytes(32).toString("hex"),
  };
}

/**
 * 用新随机值替换 .next/prerender-manifest.json 中的预览密钥。
 * 不会抛出异常；返回可显示的状态，使只读安装导致的失败可见。
 * @param {string} nextDir 包的 .next 目录绝对路径
 * @returns {{ ok: boolean, reason?: string, error?: Error }}
 */
function rotatePreviewSecrets(nextDir) {
  const manifestPath = path.join(nextDir, PRERENDER_MANIFEST);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { ok: false, reason: "missing" };
    }
    return { ok: false, reason: "unreadable", error };
  }

  if (!manifest || typeof manifest !== "object" || typeof manifest.preview !== "object") {
    return { ok: false, reason: "unexpected-shape" };
  }

  manifest.preview = { ...manifest.preview, ...freshPreviewSecrets() };

  // 先写同目录临时文件，再原子重命名，
  // 避免并发 next start 读到只写了一半的清单。
  const tempPath = path.join(nextDir, `${PRERENDER_MANIFEST}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(manifest));
    fs.renameSync(tempPath, manifestPath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best effort: leaving a stray temp file is harmless.
    }
    return { ok: false, reason: "unwritable", error };
  }

  return { ok: true };
}

function getRotationWarning(reason) {
  const detail =
    reason === "unwritable"
      ? "the install directory is not writable"
      : reason === "missing"
        ? "its prerender manifest is missing"
        : reason === "unreadable"
          ? "its prerender manifest could not be read"
          : "its prerender manifest has an unexpected format";
  return [
    `Warning: could not rotate pi-imagin's preview-mode secrets because ${detail}.`,
    "This instance keeps the published preview id, so a client that knows it can",
    "bypass the proxy's authentication and Host/Origin checks via the",
    "x-prerender-revalidate header. Run from a writable install, or restrict",
    "network access to this instance.",
  ].join("\n");
}

module.exports = {
  PRERENDER_MANIFEST,
  rotatePreviewSecrets,
  getRotationWarning,
};
