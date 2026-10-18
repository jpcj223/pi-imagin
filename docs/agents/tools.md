# 工具选择与内置扩展

## 新会话的工具预设

`POST /api/agent/new` 的 `toolNames` 是用户选择。省略该字段表示采用 pi 的 `defaultTools`；空数组表示“仅聊天”；非空数组固定内置编程工具。固定选择写入版本化的 `pi-web:tool-selection` 自定义记录，最新有效记录生效。没有记录或最新记录的 `cleared: true` 表示不固定选择。读取规则见 [架构决策 0002](../adr/0002-chat-only-tool-selection.md)。

仅聊天必须在创建服务之前解析：不加载扩展、技能、提示词模板、主题或 pi 基础提示词。普通会话的精确系统提示词来自 SDK 按顺序发现的上下文文件；子智能体使用自己的配置。浏览器记录的默认预设仅初始化新会话，不能覆盖历史会话。

仅聊天没有扩展提供的模型。模型选择器可能列出扩展模型，但创建或切换到该模型时必须说明资源限制，不能偷偷改用默认模型，也不能只返回含糊的“没有 API Key”。

精确系统提示词通过 `before_agent_start` 返回 `{ systemPrompt }`。不要直接赋值 `agent.state.systemPrompt`，也不要修改 SDK 的请求准备方法；前者是从记录重建的只读值，后者不能保证到达真实请求。

## 工具暴露与预设更新

`direct` 和 `model-only` 通常在注册时激活，`defaultActive: false` 的工具除外；`codemode`、`deferred` 必须显式激活；`hidden` 工具不能被预设重新开启。

- `get_tools` 返回 `agent.state.tools` 中的真实描述。Code mode 的 `only` 模式可以隐藏声明，但工具仍可能可调用；面板应区分“活动”和“已向模型声明”。
- 切换预设仅替换编程工具，保留其他已活动、已注册且未隐藏的工具。不要重新激活扩展主动关闭的工具，也不要因预设变化强制开启 Code mode。
- 重载后采用扩展重新建立的活动集合，不能恢复重载前的旧集合。
- 分支导航恢复目标分支的工具后，普通会话再应用自身固定预设，并保留会话的 Code mode、搜索、子智能体工具。仅聊天和子智能体沿用 SDK 恢复的结果。
- 仅聊天与非仅聊天之间切换需要重建会话包装器；非空预设之间通常可以原地更新。

## 内置扩展

普通会话使用 SDK 根导出的 `codemode`、`tool-search` 和 `mcp` 工厂，注册为可替换的内置扩展。名称、`-builtin:<name>`、项目覆盖、禁用扩展及第三方替换都与 pi CLI 一致。

MCP 工厂的 `loadConfig` 不返回服务器，`startupWaitMs` 为 0，由 Pi Imagin 的 MCP 主机决定何时连接。传输使用 `createPiImaginMcpTransportFactory()`，不会在服务端自动打开浏览器。`PI_WEB_DISABLE_MCP` 生效或 SDK 内部模块不可用时，不能退回 SDK 的默认传输。

Code mode 只在 SDK 沙箱自检成功后提供；失败时保留同名空工厂，维持配置兼容。子智能体根据配置选择 Code mode 和 MCP，并使用自己的 MCP 主机。

Windows 内置 PowerShell 与 `project_command` 共用 UTF-8 操作适配：SDK 先初始化输出编码，再从本次进程的临时环境变量动态解析命令，执行前移除该变量。语法错误也必须可读；退出码、超时、中止和长输出截断沿用 SDK。用户扩展提供的同名工具保持优先，不能修改已安装依赖或全局进程环境。子智能体仅在其配置允许 PowerShell 时安装该适配。

普通会话通过隐藏扩展补充简短的格式与证据说明：区分分析和执行，执行结论须有真实工具结果；成功空输出不能推断目录为空，充分证据后停止重复查询；归纳需求保留其对象、时点与限制强度。不改写模型返回值或替模型执行重试。仅聊天与替换系统提示词的子智能体继续使用原有精确提示词，不注入这些约定。

## 只读 MCP 策略

固定工具集合没有 `bash`、`powershell`、`edit`、`write` 时属于只读会话；未固定选择不等于只读。此类会话拦截没有 `annotations.readOnlyHint: true` 的 MCP 调用，包括 Code mode 脚本间接调用。子智能体根据其配置工具执行相同策略。标记由服务器声明，只能减少模型误操作，不能防御恶意服务器。

## 默认工具开关

Code mode 的“始终开启”向全局 `defaultTools` 写入 `+codemode`；“自动”不写该项。修改由 `/api/tools/settings` 经全局设置文件锁执行，只更新相关条目和 `codemode.mode`、`codemode.inlineBudget`。

`defaultTools` 支持 `+name`、`-name` 等修饰符，必须通过 SDK 解析；不要把纯修饰符列表当普通名称列表，也不要留下表示“禁用所有工具”的空数组。
