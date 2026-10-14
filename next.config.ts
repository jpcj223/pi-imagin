import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

// remark-gfm 的邮件自动链接依赖包含正则后行断言，
// Safari 16.4 之前无法解析，会导致 iOS 16.2 页面空白。
// 加载器将其替换为运行时构造的等价正则，两种打包器都必须应用。
const gfmAutolinkEmailLoader = join(configDir, "lib/gfm-autolink-email-loader.cjs");

const nextConfig: NextConfig = {
  outputFileTracingRoot: configDir,
  experimental: {
    // 存在 proxy.ts 时，Next 会缓存 API 请求体，
    // 默认上限为 10 MB，而上传接口允许单次最多 100 MB。
    // 缓存上限必须大于上传上限，避免大文件被截断
    // 并在解析 FormData 时失败。
    proxyClientMaxBodySize: "128mb",
  },
  // next/image 仅用于静态 Logo，不需要在线图片优化接口，
  // 因此关闭优化器，减少 sharp/libheif 等额外依赖的风险面。
  images: { unoptimized: true },
  // 开发使用 Turbopack，生产构建使用 webpack。
  turbopack: {
    rules: {
      "**/mdast-util-gfm-autolink-literal/lib/index.js": { loaders: [gfmAutolinkEmailLoader] },
    },
  },
  webpack(config) {
    config.module.rules.push({
      test: /[\\/]mdast-util-gfm-autolink-literal[\\/]lib[\\/]index\.js$/,
      loader: gfmAutolinkEmailLoader,
    });
    return config;
  },
  // 未列出的依赖保留原始语法；Mermaid 的延迟加载模块
  // 含有静态类初始化块，需要额外转译以兼容旧浏览器。
  transpilePackages: ["mermaid", "@mermaid-js/parser"],
  serverExternalPackages: [
    "node-pty",
    "undici",
    "web-push",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  // Next 16 默认阻止跨来源访问开发资源；
  // 允许回环地址和 RFC1918 局域网范围，
  // 让同一局域网的设备可以访问开发服务。
  allowedDevOrigins: [
    "127.0.0.1",
    "10.*.*.*",
    // 172.16.0.0/12
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
    "192.168.*.*",
  ],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
