# 品牌图标

Logo 为深海蓝—青蓝渐变的纯图形，保留内部流动留白与右上独立弧线。

## 原稿与导出

已选原稿位于 `design/pi-imagin-logo-ocean-blue-v9.png`，保持原始透明度、轮廓和配色。
导出脚本只裁去画布外部留白、缩放并添加图标安全边距；不会重新绘制造型。

在项目根目录执行：

```bash
node bin/generate-brand-icons.mjs
```

脚本使用项目现有的 `sharp`，无需增加依赖。也可通过第一个参数指定新的原稿路径。

## 使用位置

| 资源 | 用途 |
| --- | --- |
| `public/icons/logo-ocean.png` | 新会话页、登录页、侧栏品牌与离线页；透明底适配明暗主题 |
| `public/icons/icon-ocean-192.png` | PWA 安装图标，192 × 192 |
| `public/icons/icon-ocean-512.png` | PWA 安装图标，512 × 512 |
| `public/icons/apple-touch-ocean.png` | Apple 安装图标，180 × 180，使用浅色实底 |
| `public/icons/favicon-ocean-32.png` | 浏览器标签页 PNG 图标 |
| `app/favicon.ico` | 内嵌 16、32、48 像素的兼容图标 |

网页与 PWA 使用新的资源名称，服务工作线程同步更新缓存标识，避免复用旧图标。
以后替换配色或造型时，应同步调整资源名称与缓存标识，并验证浅色、深色主题及安装图标。
