# CodeGraph 接入与分组排版（2026-10-27）

## 工具已实际使用

- 来源：colbymchenry/codegraph，npm 包 @colbymchenry/codegraph，固定版本 1.6.2。
- 独立安装位置：output/tools/codegraph/，应用 package.json 与 lockfile 未变化；没有运行代理自动配置命令，没有修改 AGENTS.md。
- 当前通过 CLI 使用，MCP 尚未配置。调用入口：在仓库根目录运行 `./output/tools/codegraph.ps1 callers MarkdownBody` 或 `./output/tools/codegraph.ps1 explore 'MarkdownBody' --max-files 1`。
- 包安装使用 --ignore-scripts。索引与查询设置 CODEGRAPH_TELEMETRY=0；包装脚本运行时临时关闭匿名统计，结束恢复原环境值。
- 本地索引 .codegraph/codegraph.db：949 个文件、16853 个节点、46749 条边，初次索引约 4.5 秒，状态检查正常。该目录包含自身的忽略文件，不提交数据库；工具安装目录也被既有 /output/ 规则忽略。
- AGENTS.md、.gitignore、package.json、package-lock.json 的安装前后哈希一致。证据：output/tools/codegraph-before.json、codegraph-index.log、codegraph-style-query.txt。

## 本次查询帮助与局限

实际执行 explore 和 callers，定位 MarkdownBody 的 9 个调用／引用入口，包括聊天消息、技能文档与扩展对话框，因此本次修改继续限制在 .markdown-assistant-reply，避免影响共享文档。

宽泛关键词查询也带出了 HeaderRow 等无关符号；“未找到关联测试”不能解释为没有测试（本项目通过 Jiti 动态加载的现有测试仍存在）。优先使用精确符号查询，再对磁盘源码及现有测试核验。本轮没有做等价任务 A/B，不能量化节省 token 或速度；调用关系图不能代替 CSS 与视觉验证。

## 本轮样式调整

用户明确指出内容挤在一起。本次保持现有字号、图标、行宽设置，按分组调整：

- 正文行距从 1.68 恢复到 1.75，段落间距为 1em。
- 分节标题前留 1.65em、后留 0.5em；独立加粗分节前留 1.45em、后留 0.45em。
- 引导段与其后列表靠近，列表结束留 1.2em，为下一组内容形成停顿；列表项间距 0.4em，多段列表项内部增加段落分隔。
- 不改写回复内容，不修改提示词、复制逻辑、目录定位、用户字体或宽度偏好。

本轮产品改动仅 app/globals.css；CSS 解析通过。复用已通过且代码未变的渲染、Emoji、复制与目录测试，没有重复执行类型检查、全量测试或付费模型对话。

实际旧会话 01a17b0d-32b4-703c-9a28-6a111b3e6133 第 4 轮核实：正文行高 24.5px；独立加粗分节前 20.3px、后 6.3px，列表结束 16.8px。1440px 视口下检查该轮列表分组及第 6 轮长文。截图：output/live-acceptance-2026-10-27/style-grouped-check.png、style-grouped-long.png。

本轮没有提交或推送；视觉舒适度最终由用户在实际应用中确认。

## 行宽微调

按用户“窄点，微调”要求，将默认内容宽度从 760px 收为 720px（约 5%），段落、列表间距和字号不变。沿用已有宽度偏好处理，不重置显式保存值。本次只改常量，复用已验证的宽度设置逻辑，不重复运行全量检查。

## 两侧留白修正

用户进一步明确是正文贴近左右面板。此次直接修正聊天区域的内边距，不依赖默认宽度是否被用户偏好覆盖：视口宽度 881～1099px 时左右各 32px，1100px 及以上各 48px（原为 24px）；880px 及以下保留原有响应式间距。标题、消息正文和输入框共用该值并保持对齐，字号、行距与自定义内容宽度不变。CSS 解析通过。
