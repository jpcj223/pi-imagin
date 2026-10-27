# macOS 与 Linux 桌面包

## 提交与范围

先按要求将压缩反馈修复提交并推送为 `7d3c347`。跨平台打包实现为 `6ab3383`，原生构建中发现的兼容问题通过后续提交修复；当前构建对应 `522af6c`，均在 `feat/multi-folder-projects`，没有合并主分支或创建 Release。

复用现有 Electron、Next standalone 和生产资源校验流程：

- 按构建宿主准备对应架构的官方 Node 运行时，校验 SHA256；Windows x64 流程保留。
- macOS 提供 Apple Silicon、Intel 两种 DMG / ZIP；Linux 首轮为 x64 AppImage / DEB。
- 资源裁剪按真实目标保留 node-pty 二进制和 macOS spawn-helper；显式检查原生模块加载。
- 按 macOS 应用包结构定位资源，修正 POSIX Node / npm 路径与 PATH 分隔符。
- POSIX 服务放入独立进程组，退出和 IPC 断开只回收自身组，继续先执行原有智能体、终端清理。
- 非 Windows 安装包把需写入的 Next 资源放入用户配置目录 `server-runtime/`，依赖与静态资源只读链接，保持 AppImage 挂载目录和 macOS 包不变。安装目录仍执行原有预览密钥轮换保护，没有跳过认证。
- 新增原生构建工作流，只上传 Actions 产物，不自动发布；冒烟测试使用隔离智能体目录，不调用模型。

## 已处理的问题

1. Linux 的递归监听在原子替换文件后漏掉删除：改为监听父目录，及时添加／移除子目录监听，结构变动核对镜像。
2. 旧冒烟脚本将 Windows 资源布局用于 macOS：改用 `Contents/Resources` 与 POSIX npm 路径。
3. 终端验证把可执行路径当 Shell ID：改为读取应用接口登记的 ID，保持原有白名单。

## 本地检查

- Windows 正常权限下桌面回归 38 项通过；受限环境的目录链接、回环连接和进程回收失败属于环境限制，改用正常权限执行，未改测试判定或跳过检查。
- 官方 Linux Node 校验后在现有 WSL 中执行开发回归，6 项通过；扩展的嵌套目录新增、原子替换、删除测试在 Linux 和 Windows 通过。
- 改动文件 lint、工作流 YAML 解析、差异格式检查通过。未运行与桌面包无关的全量聊天测试。

## 原生产物与验证

[本轮构建](https://github.com/jpcj223/pi-imagin/actions/runs/40493866710)三个任务均为成功，分别使用 macOS ARM、macOS Intel、Ubuntu 22.04。

| 平台 | 产物 | 原生验证 | 下载 |
| --- | --- | --- | --- |
| macOS Apple Silicon（arm64） | DMG、ZIP | 38 项桌面回归通过；生产包启动、文件操作、终端、退出回收、重启通过 | [构建产物](https://github.com/jpcj223/pi-imagin/actions/runs/40493866710/artifacts/12729902130) |
| macOS Intel（x64） | DMG、ZIP | 同上，独立 Intel 机器执行通过 | [构建产物](https://github.com/jpcj223/pi-imagin/actions/runs/40493866710/artifacts/12729567991) |
| Linux x64 | AppImage、DEB | 同上，独立 Ubuntu 机器执行通过 | [构建产物](https://github.com/jpcj223/pi-imagin/actions/runs/40493866710/artifacts/12730376555) |

生产包的实际可执行负载通过上述自动检查，未在图形安装向导中安装到用户设备。macOS 验证记录时间：ARM 11:13 UTC、Intel 11:16 UTC；Linux 为 11:13 UTC。工作流跳过模型请求，测试使用隔离配置。

本机日志保存在忽略目录 `output/desktop-job-122154250861.log`、`output/desktop-job-122154250708.log`、`output/desktop-job-122154250911.log`。Actions 产物保留 14 天。

## 限制

没有 Apple Developer ID 及公证凭据，macOS 产物为未公证测试包。尚未覆盖用户设备上的安装、Gatekeeper、所有 Linux 发行版与硬件；Linux arm64 有构建入口，但本轮不生成或宣称已验证该架构。没有付费模型对话或真实凭据写入。
