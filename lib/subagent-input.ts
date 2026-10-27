import { readFileSync, realpathSync, statSync } from "fs";
import { relative, resolve } from "path";
import { isPathWithinRoots } from "./path-security";
import { toSlashPath } from "./paths";
import type { ProjectSessionScope } from "./managed-projects-shared";
import { resolveProjectToolPath } from "./managed-projects";

export const MAX_SUBAGENT_INPUT_FILES = 8;
export const MAX_SUBAGENT_INPUT_BYTES = 512 * 1024;
/** 沿用 SDK 压缩模块约四个字符一个 token 的估算。 */
const CHARS_PER_TOKEN = 4;
/** 内联文件最多约占子代理上下文窗口的十分之一。 */
const CONTEXT_WINDOW_SHARE = 10;

export interface SubagentInputFile {
  path: string;
  content: string;
}

export interface SubagentInputLimits {
  /** 文件总字节上限；未指定时使用 MAX_SUBAGENT_INPUT_BYTES。 */
  maxBytes?: number;
  /** 由上下文窗口限制预算时，在错误中显示子代理模型。 */
  model?: string;
}

/** 内联文件进入首条用户消息，固定上限可能挤满小模型窗口；按字节和模型窗口共同限额，模型容量未知时沿用固定上限。 */
export function subagentInputLimits(
  model: { provider: string; id: string; contextWindow?: number } | undefined,
): SubagentInputLimits {
  const contextWindow = model?.contextWindow;
  if (!model || !contextWindow || contextWindow < 0) return {};
  const maxBytes = Math.floor((contextWindow * CHARS_PER_TOKEN) / CONTEXT_WINDOW_SHARE);
  return maxBytes < MAX_SUBAGENT_INPUT_BYTES ? { maxBytes, model: `${model.provider}/${model.id}` } : {};
}

function formatInputLimit(bytes: number): string {
  return bytes < 1024 ? `${bytes}-byte` : `${Math.floor(bytes / 1024)} KB`;
}

export function loadSubagentInputFiles(
  cwd: string,
  requestedPaths: readonly string[],
  projectScope?: ProjectSessionScope,
  limits: SubagentInputLimits = {},
): SubagentInputFile[] {
  const maxBytes = limits.maxBytes ?? MAX_SUBAGENT_INPUT_BYTES;
  if (requestedPaths.length > MAX_SUBAGENT_INPUT_FILES) {
    throw new Error(`Agent input_files accepts at most ${MAX_SUBAGENT_INPUT_FILES} files`);
  }

  const realCwd = realpathSync(cwd);
  const allowedRoots = new Set([realCwd]);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const seen = new Set<string>();
  const files: SubagentInputFile[] = [];
  let totalBytes = 0;

  for (const requestedPath of requestedPaths) {
    if (!requestedPath.trim()) throw new Error("Agent input_files paths must not be empty");

    let filePath: string;
    try {
      filePath = realpathSync(projectScope ? resolveProjectToolPath(projectScope, requestedPath) : resolve(cwd, requestedPath));
    } catch {
      throw new Error(`Agent input file does not exist: ${requestedPath}`);
    }
    if (!projectScope && !isPathWithinRoots(filePath, allowedRoots)) {
      throw new Error(`Agent input file is outside the session cwd: ${requestedPath}`);
    }
    if (!statSync(filePath).isFile()) {
      throw new Error(`Agent input path is not a file: ${requestedPath}`);
    }
    if (seen.has(filePath)) continue;
    seen.add(filePath);

    const buffer = readFileSync(filePath);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      const scope = limits.model ? ` for ${limits.model}, about a tenth of its context window` : "";
      throw new Error(
        `Agent input_files exceeds the ${formatInputLimit(maxBytes)} total limit${scope}. `
        + "Pass fewer or smaller files, or name the paths in prompt if the subagent can read them.",
      );
    }

    let content: string;
    try {
      content = decoder.decode(buffer);
    } catch {
      throw new Error(`Agent input file is not valid UTF-8 text: ${requestedPath}`);
    }
    files.push({
      path: toSlashPath(projectScope ? filePath : relative(realCwd, filePath)),
      content,
    });
  }

  return files;
}

export function appendSubagentInputFiles(task: string, files: readonly SubagentInputFile[]): string {
  if (files.length === 0) return task;
  const documents = files.map((file) =>
    `<document path=${JSON.stringify(file.path)}>\n${file.content}\n</document>`
  ).join("\n\n");
  return `${task}\n\n<documents>\n${documents}\n</documents>`;
}
