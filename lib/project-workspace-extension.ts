import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Type } from "typebox";
import { createBashToolDefinition, createPowerShellToolDefinition, type ExtensionContext, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { createUtf8PowerShellOperations } from "./powershell-operations";
import type { ProjectSessionScope } from "./managed-projects-shared";
import { ProjectScopeAccessError, resolveProjectToolPath, unavailableProjectFolders } from "./managed-projects";
import { createProjectCommandBashOperations } from "./project-command-env";
import { readSessionToolSelection } from "./session-tool-selection";
import { resolveShellTools } from "./powershell-settings";
import type { SessionEntry } from "./types";
import { copyProjectFile } from "./project-file-copy";
import { resolveEnvironmentTools, selectedShellProfile } from "./shell-profiles";
import { createEnvironmentOperations } from "./shell-profile-operations";

const FILE_TOOLS = new Set(["read", "write", "edit", "ls", "find", "grep"]);
const OUTPUT_TOOLS = new Set(["bash", "powershell", "project_command"]);
const COMMAND_DENIAL_ENTRY = "pi-imagin:project-command-denial";

/** 使用真实用户消息 ID 区分新请求；后台自定义消息不产生新授权边界。 */
export function projectCommandRequestId(entries: readonly { id: string; type: string; message?: { role: string } }[]): string | undefined {
  return entries.findLast(entry => entry.type === "message" && entry.message?.role === "user")?.id;
}

/** 只放行本会话命令实际落盘的完整输出，不把结果正文中的任意路径变成访问授权。 */
function isCommandOutput(path: string, entries: SessionEntry[]): boolean {
  if (!isAbsolute(path)) return false;
  const target = resolve(path);
  try {
    if (!statSync(target).isFile() || realpathSync(target) !== target) return false;
    return entries.some(entry => {
      if (entry.type !== "message") return false;
      const message = entry.message;
      if (message.role === "bashExecution") return message.fullOutputPath === target;
      if (message.role !== "toolResult" || !OUTPUT_TOOLS.has(message.toolName ?? "")) return false;
      const details = message.details as { fullOutputPath?: unknown } | undefined;
      return details?.fullOutputPath === target;
    });
  } catch { return false; }
}

type ShellSettings = { getShellCommandPrefix(): string | undefined; getShellPath(): string | undefined; getGlobalSettings?(): unknown };
const parameters = Type.Object({
  cwd: Type.String({ description: "Absolute working directory within one of this session's project folders." }),
  command: Type.String(),
  shell: Type.Optional(Type.Union([Type.Literal("bash"), Type.Literal("powershell")])),
  timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 3600 })),
});

/** 每个包装器持有独立快照，不修改 process.cwd，也不修改其他会话的 SDK 工具。 */
export function createProjectWorkspaceExtension(snapshot: ProjectSessionScope, defaultTools: () => string[] | undefined = () => undefined, shellSettings?: ShellSettings, currentScope?: () => ProjectSessionScope, contextOnly = false, parentRequestId?: () => string | undefined): InlineExtension {
  let scope = structuredClone(snapshot);
  const refresh = () => { if (currentScope) scope = currentScope(); return scope; };
  // 工具拒绝后给出实际可用根，避免模型猜测兄弟目录或扫描项目父目录。
  const folderGuide = () => "当前项目关联目录（操作请使用以下绝对路径，不使用 ..）：\n"
    + scope.folders.map(folder => `${folder.name}: ${folder.path}`).join("\n");
  const scopeData = () => JSON.stringify({ project: scope.projectName, revision: scope.projectRevision, folders: scope.folders, unavailable: unavailableProjectFolders(scope) });
  let promptScope = scopeData();
  const validatedPaths = new Map<string, string>();
  let commandAccessDenied = false;
  const commandRefusal = () => "本次请求已发生项目目录访问拒绝，命令执行已暂停，不能改用 Shell 继续访问。仍可使用文件工具处理当前允许目录；需要运行命令时，请先由用户确认目标并发送新的请求。";
  return {
    name: "pi-imagin-project-workspace",
    hidden: true,
    factory(pi) {
      const requestId = (context: ExtensionContext) => parentRequestId ? parentRequestId() : projectCommandRequestId(context.sessionManager.getEntries());
      const commandBlocked = (context: ExtensionContext) => {
        const entries = context.sessionManager?.getEntries() ?? [];
        const saved = entries.findLast(entry => entry.type === "custom" && entry.customType === COMMAND_DENIAL_ENTRY);
        if (saved?.type === "custom") {
          const data = saved.data as { requestId?: string } | undefined;
          const current = parentRequestId ? parentRequestId() : projectCommandRequestId(entries);
          // 父请求不可读时保持拒绝；换一个子任务提示或重开子会话不能解除它。
          commandAccessDenied = !current || !data?.requestId || current === data.requestId;
        }
        return commandAccessDenied;
      };
      const recordDenial = (error: unknown, context: ExtensionContext) => {
        if (!(error instanceof ProjectScopeAccessError)) return;
        if (!commandBlocked(context)) pi.appendEntry?.(COMMAND_DENIAL_ENTRY, { version: 1, requestId: requestId(context) });
        commandAccessDenied = true;
      };
      const commandEnvironment = shellSettings?.getGlobalSettings ? selectedShellProfile(shellSettings.getGlobalSettings() as Record<string, unknown>) : undefined;
      const environmentOperations = commandEnvironment ? createEnvironmentOperations(commandEnvironment) : undefined;
      pi.registerTool({
        name: "project_copy_file", label: "原样复制项目文件",
        description: "Copy one regular file byte-for-byte between this session's project folders, preserving whitespace, newlines and binary bytes. Use for exact file copies instead of reconstructing content with write. Requires read and write in the current preset. Maximum 16 MiB; existing files require explicit overwrite=true. Does not run a shell.",
        parameters: Type.Object({ source: Type.String({ description: "Absolute source file path in this session's project folders." }), destination: Type.String({ description: "Absolute destination file path in this session's project folders." }), overwrite: Type.Optional(Type.Boolean()) }),
        async execute(_id, args, signal, _onUpdate, context) {
          const selection = readSessionToolSelection(context.sessionManager.getEntries() as unknown as SessionEntry[]);
          const available = selection ? shellSettings?.getGlobalSettings ? resolveEnvironmentTools(selection, { getGlobalSettings: () => shellSettings.getGlobalSettings!() }) : resolveShellTools(selection, defaultTools()) : pi.getActiveTools();
          if (!available.includes("read") || !available.includes("write")) throw new Error("当前工具预设需要同时允许 read 和 write，才能复制文件。");
          let result;
          try { result = await copyProjectFile(refresh(), args.source, args.destination, args.overwrite, signal, refresh); }
          catch (error) { recordDenial(error, context); throw error; }
          return { content: [{ type: "text" as const, text: `文件已按字节复制：${JSON.stringify(result)}` }], details: result };
        },
      });
      pi.registerTool({
        name: "project_command", label: "项目目录命令", description: "Run a command in an explicit project folder. Use for repository-specific tests and git operations. When reading UTF-8 text in PowerShell, specify -Encoding UTF8. Command processes run with the current OS account permissions; this is not an OS sandbox.",
        parameters,
        async execute(id, args, signal, onUpdate, context) {
          if (commandBlocked(context)) throw new Error(commandRefusal());
          let cwd: string;
          try { cwd = resolveProjectToolPath(refresh(), args.cwd); }
          catch (error) { recordDenial(error, context); throw new Error(`${error instanceof Error ? error.message : "无效的工作目录。"}\n${folderGuide()}`); }
          if (!statSync(cwd).isDirectory()) throw new Error("命令工作目录必须是有效文件夹。");
          const selection = readSessionToolSelection(context.sessionManager.getEntries() as unknown as SessionEntry[]);
          const environmentSettings = shellSettings?.getGlobalSettings ? { getGlobalSettings: () => shellSettings.getGlobalSettings!() } : undefined;
          const available = selection ? environmentSettings ? resolveEnvironmentTools(selection, environmentSettings) : resolveShellTools(selection, defaultTools()) : pi.getActiveTools();
          const shell = args.shell ?? (available.includes("powershell") ? "powershell" : "bash");
          if (!available.includes(shell)) throw new Error(`当前工具预设未允许 ${shell}，不能执行项目命令。`);
          if (commandEnvironment && (shell === "powershell") !== (commandEnvironment.kind === "powershell")) throw new Error("执行环境已变化，请重载会话后再运行命令。");
          const definition = shell === "powershell"
            ? createPowerShellToolDefinition(cwd, { operations: createProjectCommandBashOperations({ localOperations: environmentOperations ?? createUtf8PowerShellOperations() }) })
            : createBashToolDefinition(cwd, {
              commandPrefix: commandEnvironment?.kind === "cmd" ? undefined : shellSettings?.getShellCommandPrefix(),
              operations: createProjectCommandBashOperations({ shellPath: shellSettings?.getShellPath(), ...(environmentOperations ? { localOperations: environmentOperations } : {}) }),
            });
          // SDK 优先使用 ctx.cwd；只更换工厂参数会让命令错误地仍在主目录运行。
          const result = await definition.execute(id, { command: args.command, timeout: args.timeout }, signal, onUpdate, { ...context, cwd });
          return { ...result, details: { ...result.details, cwd, shell }, content: [{ type: "text" as const, text: `工作目录：${cwd}${commandEnvironment ? `\n执行环境：${commandEnvironment.label}` : ""}\n` }, ...result.content] };
        },
      });
      pi.on("before_agent_start", event => {
        refresh();
        if (contextOnly) return;
        promptScope = scopeData();
        // SDK 的结构化 cwd 段会让模型把内部启动根误当作用户选定的目标。
        const systemPrompt = event.systemPrompt.replace(`<cwd>\n${snapshot.cwd.replaceAll("\\", "/")}\n</cwd>`, "<cwd>\nInternal SDK startup location only. This project has no default operation folder. Select an explicit folder from the current project list for each operation.\n</cwd>");
        return { systemPrompt: systemPrompt + "\n\n<pi_imagin_project_workspace>\n"
          + promptScope
          + "\n以上为当前项目范围。SDK 启动 cwd 仅用于内部初始化，不是默认操作位置；清单排序没有操作优先级，关联名不是相对路径。根据用户明确指向、关联名、路径和已读文件定位目标，能确定时直接执行；必要读取后仍有影响结果的歧义才询问。多个目录有同名文件时，只有用户要求或已有对话明确了目标才能修改；否则必须先询问。不得按启动 cwd、所谓当前目录、目录排序或自行先读到哪个文件决定修改谁。文件工具必须使用完整绝对路径（搜索也须明确根）；命令使用 project_command 并明确 cwd。允许一个任务跨多个关联目录。清单随项目设置自动更新，后续上下文中的最新清单替代旧清单，无需新建会话。根失效时说明原因，不重建根，也不妨碍其他有效根的任务。不得通过 Shell 绕过文件工具的访问拒绝；关联目录不会自动加载其中的 .pi 资源。\n</pi_imagin_project_workspace>" };
      });
      pi.on("context", event => {
        refresh();
        // 仅在发给模型的副本中补充来源；原始工具结果、图像和会话文件保持不变。
        // 从本次上下文的调用 ID 建立对应关系，避免并行读取串源，也避免重启丢失内存映射。
        const sources = new Map<string, string>();
        let changed = false;
        const messages = event.messages.map(message => {
          if (message.role === "assistant") {
            for (const content of message.content) {
              if (content.type !== "toolCall" || content.name !== "read" || typeof content.arguments.path !== "string") continue;
              try { sources.set(content.id, resolveProjectToolPath(scope, content.arguments.path)); }
              catch { /* 越界和临时输出不在此处重新授权；工具执行层保留原有判断。 */ }
            }
          }
          if (message.role !== "toolResult" || message.toolName !== "read" || message.isError) return message;
          const path = sources.get(message.toolCallId);
          if (!path) return message;
          changed = true;
          return { ...message, content: [
            { type: "text" as const, text: `<pi_imagin_file_source>${JSON.stringify({ path })}</pi_imagin_file_source>\n以上为来源标注，不是正文；以下是本次 read 返回的原始内容，可能为分页片段。` },
            ...message.content,
          ] };
        });
        // 每次模型请求重新读取版本；运行中编辑项目也能获知新范围，不写入历史用户消息。
        const latest = scopeData();
        if (contextOnly || latest !== promptScope) {
          messages.push({ role: "user", content: [{ type: "text", text: `<pi_imagin_project_workspace_update>\n${latest}\n这是应用提供的当前目录状态，替代此前目录清单；按最新关联名和范围定位，不使用已解除关联的旧路径。没有默认操作目录。文件使用绝对路径，命令使用 project_command 并指定 cwd。同名文件无法从用户要求或已有对话判断目标时先询问，不按启动 cwd 或排序选择。\n</pi_imagin_project_workspace_update>` }], timestamp: Date.now() });
          changed = true;
        }
        if (changed) return { messages };
      });
      pi.on("tool_call", (event, context) => {
        if (["project_command", "bash", "powershell", "Agent", "steer_subagent"].includes(event.toolName) && commandBlocked(context)) return { block: true, reason: commandRefusal() };
        if (event.toolName === "bash" || event.toolName === "powershell") return { block: true, reason: `项目命令必须使用 project_command 并显式指定 cwd，不能回退启动目录。\n${folderGuide()}` };
        if (!FILE_TOOLS.has(event.toolName)) return;
        try {
          const input = event.input as { path?: unknown };
          if (input.path !== undefined && typeof input.path !== "string") throw new Error("无效的文件路径。");
          const path = resolveProjectToolPath(refresh(), typeof input.path === "string" ? input.path : "");
          if (event.toolName !== "write" && !existsSync(path)) throw new Error("目标路径不存在，请使用项目中的实际路径。");
          if (event.toolCallId) validatedPaths.set(event.toolCallId, path);
        } catch (error) {
          const input = event.input as { path?: unknown };
          // SDK 将过长命令输出放到临时文件；允许读取精确文件，仍禁止编辑和目录遍历。
          if (event.toolName === "read" && typeof input.path === "string"
            && isCommandOutput(input.path, context.sessionManager.getEntries() as unknown as SessionEntry[])) return;
          recordDenial(error, context);
          return { block: true, reason: `${error instanceof Error ? error.message : "项目目录访问被拒绝。"}\n${folderGuide()}\n请按最新清单纠正文件路径，不要改用 Shell 绕过。` };
        }
      });
      pi.on("tool_result", event => {
        const path = validatedPaths.get(event.toolCallId);
        validatedPaths.delete(event.toolCallId);
        if (!path || event.isError || event.toolName === "read") return;
        return { content: [{ type: "text" as const, text: `实际路径：${path}\n` }, ...event.content], details: { ...(event.details && typeof event.details === "object" ? event.details : {}), path }, ...(event.structuredContent !== undefined ? { structuredContent: event.structuredContent } : {}) };
      });
      pi.on("agent_end", () => { validatedPaths.clear(); });
      // 后台通知和模型自动续轮不能解除拒绝；新输入开启新的执行请求。
      pi.on("input", event => { if (event.source !== "extension") commandAccessDenied = false; });
    },
  };
}
