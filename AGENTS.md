# Pi Imagin 开发约定

## 项目与提交规则

- 仓库名为 `pi-imagin`，产品名为 Pi Imagin，默认分支为 `main`。保留已有许可证和作者署名。
- Logo 使用深海蓝至青蓝的渐变图形，见 [品牌图标](docs/branding.md)。已有会话格式、存储键和环境变量名称保持兼容，品牌调整不重置用户数据。
- 默认只修改和验证。用户明确要求本次提交后，才暂存并执行 `git commit`；推送和发布按用户指令执行。
- 相关改动合并提交，使用中文 Conventional Commits。正文简要说明改动、实际验证和未解决的问题，见 [提交规范](CONTRIBUTING.md)。
- 开发对话、聊天导出和个人会话记录只保存在本地，可放入 `dev-conversations/` 或 `dev-transcripts/`，不要写进共享文档。
- 维护文档和说明注释使用中文。命令、路径、配置键、协议字段、语言包内容及检查器指令保留原值。
- 提交前排除密钥、依赖、构建产物和无关改动，正常运行提交钩子。

## 启动与验证

```bash
npm run dev
node node_modules/typescript/bin/tsc --noEmit
npm run lint
```

开发服务默认监听 `127.0.0.1:30141`。服务运行时不要执行 `next build` 或 `npm run build`，构建会覆盖 `.next/`。需要生产构建时，先停止开发服务，见 [发布说明](docs/release.md)。

### 服务故障排查

1. 检查 30141 端口，已有服务正常时直接复用。Windows 可用 `Get-NetTCPConnection`，其他系统可用 `lsof`。同一目录不要再开第二个实例，换端口也会争用 `.next/dev/lock`。
2. 遇到模块工厂不可用等错误，先刷新页面，再对照服务日志和 API 响应排查 Turbopack 热更新缓存。
3. 刷新后仍报错且服务端检查也失败时，再停止对应进程，备份 `.next` 后重启。
4. 开发使用 Turbopack。不要改用 `next dev --webpack`，该模式可能无法处理 undici 引用的 Node 内置模块。
5. Next.js 自动附加的代理规则由工具管理，不混入其他文档修改。

## 架构边界

- 会话列表和详情通过 SDK `SessionManager` 及 `lib/session-reader.ts` 只读访问 JSONL，浏览历史不创建智能体会话。
- 提示词通过 `POST /api/agent/[id]`、`startRpcSession()` 和进程内 SDK 会话执行，事件从对应 SSE 路由订阅。
- 扩展行为与 pi CLI 保持一致，界面含义以 SDK TUI 为准。显示问题在网页客户端修复，不为网页另加扩展字段或选项。
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

修改前阅读相关专题。模块的注意事项补充到对应文档，本文件只保留通用约定。

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

客户端不要使用带后行断言 `(?<=`、`(?<!` 的正则字面量。现有 GFM 邮件正则加载器采用运行时构造并提供兼容处理，升级依赖后需验证旧版 Safari。

## 会话文件与样式

会话保存在 `~/.pi/agent/sessions/<编码工作目录>/<时间戳>_<uuid>.jsonl`，使用 SDK 的版本化记录格式。上下文中的 `entryIds` 按消息顺序对应，用于分支和定位。读写沿用 SDK 和已有帮助模块。

共享样式变量位于 `app/globals.css`，包括背景、面板、悬浮、选择、边框、文字、强调色以及 `--font-mono`。新增界面使用现有变量和共享组件。
