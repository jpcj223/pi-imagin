# Pi Imagin 开发约定

本文记录项目结构、运行约束和主要接口。提交格式与检查要求见 [开发与提交规范](CONTRIBUTING.md)。

## 项目约定

- 仓库名为 `pi-imagin`，产品名为 Pi Imagin，默认分支为 `main`。保留已有许可证和作者署名。
- Logo 使用 B 版深海蓝灰圆底（#2F5261）、柔和近白色轨道与星核（#EDF2F4），见 [品牌图标](docs/branding.md)。已有会话格式、存储键和环境变量名称保持兼容，品牌调整不重置用户数据。
- 维护文档和说明注释使用中文。命令、路径、配置键、协议字段、语言包内容及检查器指令保留原值。
- 版本管理范围包含源码、测试、文档与必要配置；密钥、已安装依赖和构建产物不纳入提交。

## 启动与验证

```bash
npm run dev
node node_modules/typescript/bin/tsc --noEmit
npm run lint
```

开发服务默认监听 `127.0.0.1:30141`。开发与生产构建共用 `.next/`，因此执行 `next build` 或 `npm run build` 前须停止同目录开发服务，见 [发布说明](docs/release.md)。

### 服务故障排查

1. 使用 Windows 的 `Get-NetTCPConnection` 或其他系统的 `lsof` 检查 30141 端口。正常运行的服务可直接复用；同目录多个开发实例会争用 `.next/dev/lock`，更换端口也无法隔离构建目录。
2. 模块工厂不可用等错误可能与 Turbopack 热更新缓存有关。刷新页面后，结合服务日志和 API 响应判断故障范围。
3. 页面与服务端检查持续失败时，停止对应进程，备份 `.next` 后重启。
4. 开发模式使用 Turbopack；`next dev --webpack` 对 undici 引用的 Node 内置模块存在兼容问题。

## 架构边界

- 会话列表和详情通过 SDK `SessionManager` 及 `lib/session-reader.ts` 只读访问 JSONL，浏览历史不创建智能体会话。
- 提示词通过 `POST /api/agent/[id]`、`startRpcSession()` 和进程内 SDK 会话执行，事件从对应 SSE 路由订阅。
- 扩展行为与 pi CLI 保持一致，界面含义以 SDK TUI 为准。网页展示逻辑由客户端负责，扩展协议和配置继续使用 SDK 的既有定义。
- 会话、MCP、文件权限和配置写入复用现有统一模块。

## 主要目录和入口

| 目录或模块 | 职责 |
| --- | --- |
| `app/` | Next.js 页面、布局、样式和 API 路由 |
| `components/` | 会话侧栏、聊天、文件、终端和设置组件 |
| `hooks/` | 客户端状态、会话事件、布局和偏好 |
| `lib/` | 智能体、模型、MCP、文件权限、Git 与缓存逻辑 |
| `bin/pi-imagin.js` | 本地启动命令入口 |
| `public/` | 图标、离线页面、PWA 与静态资源 |
| `e2e/` | 浏览器回归测试 |
| `docs/agents/` | 各模块的实现约束和注意事项 |
| `docs/adr/` | 保留的架构决策 |

| 核心文件 | 职责 |
| --- | --- |
| `lib/rpc-manager.ts` | 会话包装器、启动、命令和生命周期 |
| `lib/session-reader.ts` | 会话读取、索引、缓存与上下文 |
| `lib/session-fork.ts`、`lib/session-delete.ts` | 独立分支和删除 |
| `lib/session-tree.ts`、`lib/session-ui-state.ts` | 侧栏行模型和跨窗口状态 |
| `hooks/useAgentSession.ts` | 提示词、工具、实时事件和重连 |
| `components/AppShell.tsx`、`components/ChatWindow.tsx` | 工作区布局与聊天入口 |
| `components/SessionSidebar.tsx`、`components/PiImaginTitle.tsx` | 侧栏和项目标题 |
| `lib/model-runtime.ts`、`lib/model-scope.ts` | 服务商模型和启用范围 |
| `lib/models-config-store.ts` | 模型配置的安全读取及原子保存 |
| `lib/mcp-host.ts`、`lib/mcp-transport.ts` | 会话 MCP 连接与传输 |
| `lib/mcp-config-file.ts`、`lib/mcp-add.ts` | MCP 配置修改与导入 |
| `lib/path-security.ts`、`lib/file-access.ts` | 统一文件访问边界 |
| `lib/worktree.ts` | 项目根、工作树创建和移除 |
| `lib/terminal-manager.ts` | 终端进程和连接生命周期 |
| `lib/subagents.ts` | 子智能体配置、资源和工具边界 |
| `lib/i18n/`、`hooks/useI18n.tsx` | 界面语言 |

主要 API：`/api/sessions`、`/api/agent`、`/api/models`、`/api/models-config`、`/api/auth`、`/api/mcp`、`/api/project-trust`、`/api/files`、`/api/cwd`、`/api/worktrees`、`/api/git`、`/api/terminal`、`/api/subagents`、`/api/plugins`、`/api/skills`、`/api/web-auth`。参数见对应路由和共享类型。

## 专题约定

各模块的实现约束见下列专题文档；本文件维护通用约定和入口索引。

- [会话与事件](docs/agents/sessions.md)：生命周期、分支、删除、分页、侧栏、流式渲染和缓存。
- [工具与扩展](docs/agents/tools.md)：预设、仅聊天、精确提示词、工具声明及只读策略。
- [模型与认证](docs/agents/models.md)：默认模型、范围开关、目录刷新、凭据和兼容配置。
- [MCP 运行时](docs/agents/mcp-runtime.md)：注册、等待、信任、回收和传输边界。
- [MCP 设置](docs/agents/mcp-settings.md)：只读面板、保存、项目覆盖、撤销和脱敏。
- [MCP 测试与登录](docs/agents/mcp-test-sign-in.md)：连接时限、OAuth、取消和令牌并发。
- [MCP 添加](docs/agents/mcp-add.md)：粘贴导入、变量确认、字段补齐及新目录信任。
- [文件与访问](docs/agents/files-and-access.md)：访问白名单、链接、上传、表格、工作树及密码节流。
- [设置界面](docs/agents/settings-ui.md)：共享组件、字体、分组开关、保存目标和可见禁用原因。
- [子智能体](docs/agents/subagents.md)：配置、并发、资源、完成通知和只读查看。
- [客户端平台](docs/agents/client-platform.md)：软键盘、视口、终端附加键和完成声音。

## 旧版 Safari

页面完全在客户端渲染，无法解析的脚本会导致空白页。保留 `browserslist` 的 Safari/iOS 16.2 目标及对 Mermaid 依赖的转译。

客户端正则需兼容 Safari/iOS 16.2，避免使用带后行断言 `(?<=`、`(?<!` 的正则字面量。现有 GFM 邮件正则加载器采用运行时构造并提供兼容处理，依赖升级后的回归范围包含旧版 Safari。

## 会话文件与样式

会话保存在 `~/.pi/agent/sessions/<编码工作目录>/<时间戳>_<uuid>.jsonl`，使用 SDK 的版本化记录格式。上下文中的 `entryIds` 按消息顺序对应，用于分支和定位。读写沿用 SDK 和已有帮助模块。

共享样式变量位于 `app/globals.css`，包括背景、面板、悬浮、选择、边框、文字、强调色以及 `--font-mono`。新增界面使用现有变量和共享组件。
