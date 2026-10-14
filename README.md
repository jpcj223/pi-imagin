# Pi Imagin

源码来源：本项目基于 [pi-web](https://github.com/agegr/pi-web)，保留原 MIT 许可证和作者声明。


[pi 编程智能体](https://github.com/earendil-works/pi)的本地桌面工作区，也保留浏览器开发入口。Pi Imagin 与 pi 共用本机配置和会话文件，可查找和继续对话、运行智能体、配置模型与资源，并查看项目文件。


## 功能

- **会话工作区**：按项目查找、继续、重命名、导出和删除对话，并查看运行状态、上下文占用、花费和压缩信息。
- **两种分支方式**：**新会话**会从较早的消息创建独立会话文件；**从此处编辑**会在当前会话内创建分支。
- **项目文件工具**：左侧浏览和上传文件，右侧查看 Git Diff、源码、Markdown、图片、音频、PDF 和 DOCX；支持重命名、移入回收目录与撤销。
- **连续工作区**：独立主页导航、项目内会话、右侧会话目录与底部多标签终端；设置在主窗口内打开。
- **Git worktree**：从侧边栏切换 checkout，同时把同一仓库不同 worktree 的会话归在一起。
- **网页配置**：无需离开 Pi Imagin，即可管理 Provider 登录和 API Key、模型、模型测试、插件包及技能。
- **英文、简体中文和繁体中文界面**：首次打开默认浅色与简体中文，已有偏好继续保留，可在设置中切换。

## 快速开始

### Windows 桌面版

安装 `dist-desktop/Pi-Imagin-Setup-0.1.0-x64.exe`，之后双击桌面或开始菜单的 **Pi Imagin**。程序自动打开独立窗口并启动本机服务，安装包自带运行依赖。首次使用在窗口内的**设置 → 模型**中配置服务商，已有 pi 配置继续可用。

安装包目前是本机生成的 Windows x64 版本。数据位置、构建方式和验证记录见 [桌面版说明](docs/desktop.md)。

### 源码开发

Pi Imagin 当前为本地项目，尚未发布到 npm。需要 Node.js 22.19.0 或更新版本，在项目目录运行：

```bash
npm ci
npm run dev
```

打开 [http://127.0.0.1:30141](http://127.0.0.1:30141)，在**模型**面板配置服务商。

生产启动时先停止开发服务并完成构建，再运行 `node bin/pi-imagin.js`。本地命令包括 `node bin/pi-imagin.js version`、`status`、`open` 和 `stop`。项目自己的发布地址配置完成前，自动更新保持关闭。

## 配置

端口和主机名以命令行参数为准，优先于对应的环境变量。`--no-open` 与 `PI_WEB_NO_OPEN=1` 中任意一个都会关闭自动打开浏览器。运行 `node bin/pi-imagin.js --help`（或 `-h`）可打印启动选项并以退出码 0 结束，不会启动服务；未知参数会报错并以退出码 1 结束。

| 参数或环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `--help`、`-h` | 打印启动选项并退出 | — |
| `--port <端口>`、`-p <端口>` 或 `PORT` | 服务端口 | `30141` |
| `--hostname <主机>`、`-H <主机>` 或 `PI_WEB_HOSTNAME` | 监听主机名 | `127.0.0.1` |
| `--no-open` 或 `PI_WEB_NO_OPEN=1` | 不自动打开浏览器 | 自动打开 |
| `PI_IMAGIN_APP_NAME`（兼容 `PI_WEB_APP_NAME`） | PWA manifest 的 `name` 和 `short_name`；去除首尾空白，空值使用默认值 | `Pi Imagin` |
| `PI_WEB_ALLOWED_HOSTS` | 额外允许的代理或自定义主机名，多个值用逗号分隔，必须精确匹配 | 未设置 |
| `PI_WEB_PASSWORD` | 启用浏览器密码登录；API 客户端可使用用户名为 `pi` 的 Basic Auth | 不启用认证 |
| `PI_WEB_IDLE_TIMEOUT_MS` | 会话空闲回收时限，单位毫秒；0 关闭普通回收，非法值使用默认值 | `600000` |
| `PI_WEB_SHUTDOWN_DEADLINE_MS` | 等待扩展处理会话关闭的时限，单位毫秒；0 或非法值使用默认值 | `5000` |
| `PI_WEB_SKIP_VERSION_CHECK` | 兼容的更新检查开关；当前私有项目已关闭自动更新 | 未设置 |

在启动服务前设置 `PI_WEB_APP_NAME`，例如 `PI_WEB_APP_NAME='工作 Pi' pi-imagin`。修改后重启服务即可提供新的 manifest，无需重新构建。已安装 PWA 的名称更新由浏览器管理，不保证立即生效；此设置不改变页面标题或图标。

例如：

```bash
node bin/pi-imagin.js --help
node bin/pi-imagin.js -p 8080 -H 0.0.0.0 --no-open
```

### 远程访问

监听非回环地址会暴露一个可执行高权限操作的智能体。在可信局域网中使用时，请设置足够长的随机密码：

```bash
PI_WEB_PASSWORD='足够长的随机密码' node bin/pi-imagin.js --hostname 0.0.0.0
```

密码认证不会加密连接。不要通过明文 HTTP 将 Pi Imagin 暴露到互联网；远程访问应使用可信反向代理提供 HTTPS，或通过可信 VPN。如果反向代理传递外部主机名，请把该名称精确加入 `PI_WEB_ALLOWED_HOSTS`。这个白名单不会改变 Pi Imagin 的监听地址。

### HTTP 代理

服务端的模型和 API 请求会读取标准的 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量。

macOS 或 Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npm run dev
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npm run dev
```

## 注意事项

- **智能体数据**：Pi Imagin 默认读取 `~/.pi/agent` 下的 pi 数据，包括 `sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl` 中的会话文件。可通过 `PI_CODING_AGENT_DIR` 指定其他 pi agent 目录。
- **文件系统访问**：Pi Imagin 必须能读取智能体数据目录及会话记录中的工作目录。与现有 pi 会话共用数据时，请让 Pi Imagin 运行在与 pi 相同的文件系统环境中。
- **共享配置**：模型面板使用 pi 的模型、设置和凭据存储，因此两种界面都能看到相关更改。
- **文件访问边界**：文件浏览器仅能访问在 Pi Imagin 中选择过的工作目录，以及它已识别的项目或会话根目录；它不是通用的文件系统浏览器。
- **Git worktree**：切换器何时显示、如何创建 worktree，以及删除会产生什么影响，见 [Pi Imagin 里的 Worktree](./docs/worktrees.md)。

## 集成接口

### 会话右键菜单

桌面包装器等下游集成可监听可取消的 `pi-web:session-row-contextmenu` 浏览器事件，并同步调用 `preventDefault()` 表示已接管：

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;
  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

详情包含会话 ID、文件路径、工作目录、可选名称、指针位置和刷新回调。没有集成接管时显示内置菜单；省略号始终打开内置菜单。未保存会话不提供内置操作。事件标识保留旧前缀以兼容已有集成。

### 扩展会话保活

带后台工作的服务端扩展可通过版本化注册表防止自动空闲回收：

```js
const liveness = globalThis[Symbol.for("pi-imagin/session-liveness/v1")];
const release = liveness?.version === 1
  ? liveness.register({
      name: "my-extension",
      sessionId,
      sessionFile: sessionFile || undefined,
      isActive: () => detachedJobs.size > 0,
    })
  : () => {};
```

每个活动扩展会话注册一次，关闭、替换或重载时调用幂等的 `release()`。`isActive` 必须同步、轻量，并绑定精确会话 ID 或文件。查询失败时保留会话；此机制只影响自动空闲回收，明确关闭和 Stop 兜底仍优先。

## 开发

```bash
npm install
npm run dev
```

开发服务器运行在 [http://127.0.0.1:30141](http://127.0.0.1:30141)。常用检查命令：

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

日常开发时不要运行 `next build` 或 `npm run build`。它们会写入 `.next/`，可能干扰开发服务器；仅在发布流程中执行构建。

贡献者文档：[国际化](./docs/i18n.md)和[发布流程](./docs/release.md)。

## 仓库结构

```text
app/             Next.js 界面和 API 路由
components/      React 界面组件
hooks/           客户端状态和交互 hooks
lib/             会话、智能体、模型、文件、Git 和安全逻辑
public/          静态资源和 PWA 文件
bin/             npm CLI 入口及启动参数解析
docs/            面向用户和贡献者的专题文档
```

架构说明和详细文件地图见 [AGENTS.md](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)
