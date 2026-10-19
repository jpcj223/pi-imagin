import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Type } from "typebox";
import { createBashToolDefinition, createPowerShellToolDefinition, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { createUtf8PowerShellOperations } from "./powershell-operations";
import type { ProjectSessionScope } from "./managed-projects-shared";
import { assertProjectScopeDirectories, resolveProjectToolPath } from "./managed-projects";
import { createProjectCommandBashOperations } from "./project-command-env";
import { readSessionToolSelection } from "./session-tool-selection";
import { resolveShellTools } from "./powershell-settings";
import type { SessionEntry } from "./types";
import { copyProjectFile } from "./project-file-copy";

const FILE_TOOLS = new Set(["read", "write", "edit", "ls", "find", "grep"]);
const OUTPUT_TOOLS = new Set(["bash", "powershell", "project_command"]);

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

type ShellSettings = { getShellCommandPrefix(): string | undefined; getShellPath(): string | undefined };
const parameters = Type.Object({
  cwd: Type.String({ description: "Absolute working directory within one of this session's project folders." }),
  command: Type.String(),
  shell: Type.Optional(Type.Union([Type.Literal("bash"), Type.Literal("powershell")])),
  timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 3600 })),
});

/** 每个包装器持有独立快照，不修改 process.cwd，也不修改其他会话的 SDK 工具。 */
export function createProjectWorkspaceExtension(snapshot: ProjectSessionScope, defaultTools: () => string[] | undefined = () => undefined, shellSettings?: ShellSettings): InlineExtension {
  const scope = structuredClone(snapshot);
  // 工具拒绝后给出实际可用根，避免模型猜测兄弟目录或扫描项目父目录。
  const folderGuide = "当前会话关联目录（跨目录请直接使用以下绝对路径，不使用 ..）：\n"
    + scope.folders.map(folder => `${folder.name}: ${folder.path}`).join("\n");
  return {
    name: "pi-imagin-project-workspace",
    hidden: true,
    factory(pi) {
      pi.registerTool({
        name: "project_copy_file", label: "原样复制项目文件",
        description: "Copy one regular file byte-for-byte between this session's project folders, preserving whitespace, newlines and binary bytes. Use for exact file copies instead of reconstructing content with write. Requires read and write in the current preset. Maximum 16 MiB; existing files require explicit overwrite=true. Does not run a shell.",
        parameters: Type.Object({ source: Type.String({ description: "Absolute source file path in this session's project folders." }), destination: Type.String({ description: "Absolute destination file path in this session's project folders." }), overwrite: Type.Optional(Type.Boolean()) }),
        async execute(_id, args, signal, _onUpdate, context) {
          const selection = readSessionToolSelection(context.sessionManager.getEntries() as unknown as SessionEntry[]);
          const available = selection ? resolveShellTools(selection, defaultTools()) : pi.getActiveTools();
          if (!available.includes("read") || !available.includes("write")) throw new Error("当前工具预设需要同时允许 read 和 write，才能复制文件。");
          const result = await copyProjectFile(scope, args.source, args.destination, args.overwrite, signal);
          return { content: [{ type: "text" as const, text: `文件已按字节复制：${JSON.stringify(result)}` }], details: result };
        },
      });
      pi.registerTool({
        name: "project_command", label: "项目目录命令", description: "Run a command in an explicit project folder. Use for repository-specific tests and git operations. Command processes run with the current OS account permissions; this is not an OS sandbox.",
        parameters,
        async execute(id, args, signal, onUpdate, context) {
          let cwd: string;
          try { cwd = resolveProjectToolPath(scope, args.cwd); }
          catch (error) { throw new Error(`${error instanceof Error ? error.message : "无效的工作目录。"}\n${folderGuide}`); }
          if (!statSync(cwd).isDirectory()) throw new Error("命令工作目录必须是有效文件夹。");
          const selection = readSessionToolSelection(context.sessionManager.getEntries() as unknown as SessionEntry[]);
          const available = selection ? resolveShellTools(selection, defaultTools()) : pi.getActiveTools();
          const shell = args.shell ?? (available.includes("powershell") ? "powershell" : "bash");
          if (!available.includes(shell)) throw new Error(`当前工具预设未允许 ${shell}，不能执行项目命令。`);
          const definition = shell === "powershell"
            ? createPowerShellToolDefinition(cwd, { operations: createProjectCommandBashOperations({ localOperations: createUtf8PowerShellOperations() }) })
            : createBashToolDefinition(cwd, {
              commandPrefix: shellSettings?.getShellCommandPrefix(),
              operations: createProjectCommandBashOperations({ shellPath: shellSettings?.getShellPath() }),
            });
          // SDK 优先使用 ctx.cwd；只更换工厂参数会让命令错误地仍在主目录运行。
          const result = await definition.execute(id, { command: args.command, timeout: args.timeout }, signal, onUpdate, { ...context, cwd });
          return { ...result, content: [{ type: "text" as const, text: `工作目录：${cwd}\n` }, ...result.content] };
        },
      });
      pi.on("before_agent_start", event => {
        // 防止重启或链接更换将原快照目录静默映射到新目标。
        assertProjectScopeDirectories(scope);
        return { systemPrompt: event.systemPrompt + "\n\n<pi_imagin_project_workspace>\n"
          + JSON.stringify({ project: scope.projectName, defaultCwd: scope.cwd, folders: scope.folders })
          + "\n当前项目名、默认目录和关联目录以本会话的目录快照为准。defaultCwd 只是默认工作目录，不代表完整项目范围；跨关联目录使用清单中的完整路径，文件夹显示名不代表相对路径。不得通过 Shell 绕过文件工具的访问拒绝。项目设置变化不会扩展已有会话的目录清单，使用新增目录需新建会话；关联目录不会自动加载其中的 .pi 资源。\n</pi_imagin_project_workspace>" };
      });
      pi.on("context", event => {
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
        if (changed) return { messages };
      });
      pi.on("tool_call", (event, context) => {
        if (!FILE_TOOLS.has(event.toolName)) return;
        try {
          const input = event.input as { path?: unknown };
          if (input.path !== undefined && typeof input.path !== "string") throw new Error("无效的文件路径。");
          const path = resolveProjectToolPath(scope, typeof input.path === "string" ? input.path : scope.cwd);
          if (event.toolName !== "write" && !existsSync(path)) throw new Error("目标路径不存在，请使用项目中的实际路径。");
        } catch (error) {
          const input = event.input as { path?: unknown };
          // SDK 将过长命令输出放到临时文件；允许读取精确文件，仍禁止编辑和目录遍历。
          if (event.toolName === "read" && typeof input.path === "string"
            && isCommandOutput(input.path, context.sessionManager.getEntries() as unknown as SessionEntry[])) return;
          return { block: true, reason: `${error instanceof Error ? error.message : "项目目录访问被拒绝。"}\n${folderGuide}\n清单是固定快照；新增关联目录需新建会话，刷新不会扩展范围。请纠正文件路径，不要改用 Shell 绕过。` };
        }
      });
    },
  };
}
