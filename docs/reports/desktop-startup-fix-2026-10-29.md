# 安装版启动优化实施记录

日期：2026-10-29。接续 [启动诊断](desktop-startup-2026-10-29.md)，按用户要求修改源码，由用户自行打包安装测试；未提交、推送或构建安装包。

## 已修改

1. `next.config.ts`：仅桌面生产构建关闭 `preloadEntriesOnStart`，避免首个健康请求阶段预加载全部页面／接口；普通网页保留默认策略。
2. `lib/global-settings-file.ts`：设置位置读取复用现有轻量 `agent-dir`，避免间接加载整套 SDK；配置文件及锁机制保持原样。
3. `instrumentation-node.ts`：复用已有首屏就绪调度，将外部 Pi 命令模块的导入及自动修复一起延至 `workspace-loaded` 后，保留失败报告。
4. `lib/pi-command.ts`：初始化与用户开关共用队列，执行时读取最新开关，避免延迟初始化覆盖用户刚保存的状态。
5. `desktop/main.cjs`、`desktop/runtime.cjs`、`desktop/server.cjs`、`instrumentation.ts`：增加构建 ID、后台入口、预览密钥准备、Next 入口、instrumentation、HTTP 初始化及健康检查耗时；后台等待监测在就绪／退出后停止。保留认证、预览密钥轮换和原有退出流程，不改变 SDK 或提示词。

关键依赖与并发时序已补充中文注释。后台等待最多约每五秒记录一条；不增加网络请求，不输出配置内容、凭据或对话。

## 验证

- 23 项相关测试通过，0 失败、0 跳过：`lib/desktop-startup.test.mjs`、`lib/startup-imports.test.mjs`、`lib/sdk-preload.test.mjs`、`lib/pi-command.test.mjs`、`lib/pi-command.performance.test.mjs`、`desktop/runtime.test.cjs`、`desktop/server.test.cjs`。
- 新回归实际执行 instrumentation，核对健康就绪不会提前导入外部入口模块，首屏消息只执行一次；轻量设置／入口导入禁止解析 SDK 依赖。
- 并发模拟自动修复和用户开关，核对最终状态以队列中的最新设置为准；使用临时目录和模拟注册表调用，不修改真实设置。
- 后台启动器子进程验证阶段日志、预览密钥仍轮换、健康通知可处理、正常退出；健康探测回归覆盖重试与成功，日志不含认证信息。
- `tsc --noEmit` 通过。
- 13 个相关源码／测试文件的 ESLint 通过。既有无关检查未重复。

## 由用户安装后验证

构建入口保持 `npm run desktop:pack`，产物位置保持 `dist-desktop/`。本轮不停止开发窗口、不执行生产构建。

1. 安装后第一次启动，观察窗口出现及界面可用时间。
2. 正常退出应用后再次启动作对照；关闭窗口若只是隐藏到托盘，不算重新启动后台。
3. 确认原会话和模型设置仍在，外部 Pi 开关保留原值、入口正常修复。
4. 若仍慢，提供 `%APPDATA%\Pi Imagin\desktop.log` 中对应时段的记录。新 `[startup]` 字段可以区分后台进入前、Next 加载、初始化及健康响应等待。

尚未验证新安装包的端到端时间，因此没有宣称录像里的约 35 秒等待已完全解决，也没有将此前诊断实验的数据当作本次实现的性能结果。涉及修改的已通过检查不重复运行，后续只复测实际失败或受新增改动影响的项目。
