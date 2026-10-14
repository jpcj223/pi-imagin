# 0005：通过设置关闭内置子智能体配置

## 背景

`general-purpose`、`explore`、`plan` 是代码中的内置配置，不能像文件配置一样写 `enabled: false`。为了仅关闭一个配置而复制整份系统提示词，会冻结提示词版本，并让其他读取相同目录的运行时也看到这个副本。

## 决策

关闭状态保存为 `~/.pi/agent/agents/settings.json` 中的名称：

```json
{ "version": 1, "builtInEnabled": true, "disabledBuiltIns": ["explore"] }
```

- 列表查询、工具说明和派发守卫共用 `builtInProfiles()` 的 `enabled` 结果。
- 写入只修改此次操作的名称，保留未涉及名称的顺序、拼写和未知项。匹配不区分大小写，保存采用内置名称的原拼写。
- 读取关闭名单失败时仍显示内置配置；总功能开关读取失败会关闭派发，两种失败策略各自有明确用途。
- `PATCH /api/subagents/profiles` 接受 `scope: "builtin"`，写入设置并返回更新后的配置；PUT 和 DELETE 仍拒绝该作用域，因为没有可编辑或可删除文件。
- 同名文件仍完整替换内置配置，使用文件自己的 `enabled`。关闭名单约束内置配置，不约束所有同名文件。

内置配置仅支持原位开关，名称、提示词、工具和模型需要通过明确保存同名覆盖文件改变。

## 结果

关闭内置配置不产生 Markdown 副本，原提示词继续随版本更新。已有运行会话可能仍在工具说明中列出该配置，但派发前重新读取设置并拒绝关闭项，不需要为了守卫生效而重载。

`readSubagentSettings()` 返回 `disabledBuiltIns`；`maxConcurrent` 保持其既有不可枚举行为。
