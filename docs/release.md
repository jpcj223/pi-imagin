# Pi Imagin 发布说明

源码仓库为 [pi-imagin](https://github.com/jpcj223/pi-imagin)，包名为 `pi-imagin`。`package.json` 设置了 `private: true`，目前未发布到 npm。桌面构建按宿主系统生成对应安装包，自动更新保持关闭。

## 桌面安装包

在目标平台和架构的机器上执行：

```bash
npm ci
npm ci --prefix desktop
npm run desktop:pack
```

产物在 `dist-desktop/`：Windows x64 为 NSIS 安装器，macOS 分 Apple Silicon（arm64）及 Intel（x64）的 DMG、ZIP，Linux 为 AppImage、DEB。脚本不混用不同平台的原生依赖，随包准备对应平台的 Node 22 运行时并校验官方 SHA256。Linux 初次构建建议 Ubuntu 22.04 或兼容环境；macOS 使用 Xcode 命令行工具。开发与发布构建目录规则仍适用。

`.github/workflows/desktop-packages.yml` 使用三台原生构建机生成 macOS 两种架构及 Linux x64 产物。桌面代码推送触发或手动执行；仅上传 Actions 构建产物，不创建 Release。每个平台运行桌面回归及生产包启动、文件操作、终端、退出和再次启动检查，跳过所有付费模型请求。macOS 手动命令例子：

```bash
node desktop/smoke.cjs "dist-desktop/mac-arm64/Pi Imagin.app/Contents/MacOS/Pi Imagin" --skip-model
```

Linux 在有桌面会话时执行 `node desktop/smoke.cjs dist-desktop/linux-unpacked/pi-imagin --skip-model`；无显示器构建机使用 `xvfb-run -a`。可写的 Next 运行副本位于应用用户目录 `server-runtime/`，安装目录和签名包不被修改；依赖与静态资源保持只读复用。

安装版启动排查：Windows 日志位于 `%APPDATA%\Pi Imagin\desktop.log`；开发窗口使用独立目录，不能混用日志。日志中的 `[startup]` 记录后台、健康检查、页面及首屏后任务的阶段耗时和构建 ID。验证更新后第一次及再次启动，分别观察窗口出现和界面可用；若仍有长等待，保留该次日志，不能用单次较快结果认定问题已解决。该日志不包含模型凭据或对话正文。

未配置 Apple Developer ID 及公证凭据时，macOS 产物属于未公证测试包，不视作可无提示公开分发的正式签名版。正式发布应按 electron-builder 的签名与公证配置提供仓库密钥，不把证书、密码提交到源码。Linux 首轮自动构建仅覆盖 x64；arm64 构建入口已兼容，但没有对应产物和验证时不标记为已支持发布。

## 本地开发与验证

```bash
npm ci
npm run dev
```

发布前根据变更影响完成类型检查、代码检查及相关测试，并核对版本、提交记录和构建产物。

## 本地生产启动

先停止使用同一目录的开发服务，再构建并启动：

```bash
npm run build
node bin/pi-imagin.js
```

## 配置独立发布目标

公开发布前需确认目标仓库、npm 包归属、发布凭据及包元数据，并配置独立的更新地址。`PI_IMAGIN_REPOSITORY_URL` 用于指定项目发布说明地址，单独设置该变量不会开启自动更新。发布地址须对应 Pi Imagin 自身的发布目标，npm 包状态以实际发布结果为准。

原 MIT 许可证与作者声明保留在 `LICENSE`。
