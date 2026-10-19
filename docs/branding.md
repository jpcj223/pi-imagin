# 品牌图标

Logo 采用用户选定的 B 版：深海蓝灰圆底 `#2F5261`、柔和近白色 `#EDF2F4` 宇宙轨道、中心星核与两个环绕节点。色块保持纯色，不使用渐变和纹理；图形不随页面主题反色。页面、浏览器、PWA、桌面启动页和开发窗口统一使用这一配色。此次仅更新本地开发资源，不重新打包或更新已安装版本。

## 原稿与导出

选定原稿位于 `design/pi-imagin-logo-cosmic-ocean.png`。保留原黑白稿 `design/pi-imagin-logo-cosmic.png` 的逐像素轮廓、轨道布局、节点、留边与透明度，仅将黑白覆盖率映射到 B 版两种纯色，避免重新绘制带来造型变化。原稿为 160 × 160 的透明外围 PNG。较大的导出尺寸用于安装平台适配，不代表原稿增加了细节。

在项目根目录执行：

```bash
node bin/generate-brand-icons.mjs
```

脚本使用现有 `sharp`，按原稿可见范围裁切、缩放并添加安全边距。第一个参数可指定其他原稿路径。圆底保持深海蓝灰，圆形之外透明；Apple 安装图标使用白色画布。

## 使用位置

| 资源 | 用途 |
| --- | --- |
| `public/icons/logo-cosmic-ocean.png` | 侧栏品牌、登录页与离线页 |
| `public/icons/icon-cosmic-ocean-192.png` | 对话品牌标识、PWA 和推送通知图标 |
| `public/icons/icon-cosmic-ocean-512.png` | 大尺寸 PWA 安装图标 |
| `public/icons/apple-touch-cosmic-ocean.png` | Apple 安装图标，180 × 180，白底 |
| `public/icons/favicon-cosmic-ocean-32.png` | 浏览器标签页 PNG 图标 |
| `app/favicon.ico` | 浏览器兼容图标，内嵌 16、32、48 像素 |
| `public/icons/icon-cosmic-ocean.ico` | 桌面开发窗口及 Windows 图标源，内嵌 16、24、32、48、64、128、256 像素 |
| `desktop/startup-logo.png` | 桌面启动与故障重试页 |
| `build/desktop-icons/icon.ico` | 打包后的主窗口、历史窗口、任务栏、托盘、程序及安装快捷方式 |

桌面打包入口先重新导出图标，随后将同一个多尺寸 ICO 复制到打包资源中。开发窗口直接读取 `public/icons` 下的 ICO，不依赖以前的生产构建。

Windows 正式版使用 `local.pi-imagin.desktop`，开发窗口使用独立的 `local.pi-imagin.desktop.dev`。主进程与窗口同时设置应用标识，窗口任务栏属性明确指向当前 ICO，避免开发窗口沿用 `Electron.lnk` 或 Electron 可执行文件的旧图标。历史窗口采用相同设置。

网页、PWA 与服务工作线程统一使用 `cosmic-ocean` 资源名称，缓存标识为 `cosmic-ocean-v1`，避免继续命中旧的彩色图标。安装程序包含新的可执行文件图标；已经安装的应用需更新安装资源并重新启动才能应用 Windows 图标。
