import { randomUUID } from "node:crypto";
import {
  createLocalPowerShellOperations,
  createPowerShellToolDefinition,
  type BashOperations,
  type InlineExtension,
  type LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import { createProjectCommandBashOperations } from "./project-command-env";

const EXTENSION_NAME = "pi-imagin-powershell-output";
const EXTENSION_PATH = `<inline:${EXTENSION_NAME}>`;

/** 先让 SDK 设置 UTF-8，再动态解析用户命令，使语法错误也采用相同编码。 */
export function createUtf8PowerShellOperations(
  localOperations: BashOperations = createLocalPowerShellOperations(),
): BashOperations {
  return {
    exec(command, cwd, options) {
      // 原文通过本次进程的环境传入，避免引号转义、命令注入和 Base64 扩大命令行长度。
      const suffix = randomUUID().replaceAll("-", "");
      const key = `PI_IMAGIN_PS_SOURCE_${suffix}`;
      const variable = `$piImaginSource${suffix}`;
      const wrapper = `${variable} = [Environment]::GetEnvironmentVariable('${key}');\n`
        + `[Environment]::SetEnvironmentVariable('${key}', $null);\n`
        + `& ([scriptblock]::Create(${variable}))`;
      return localOperations.exec(wrapper, cwd, {
        ...options,
        env: { ...(options.env ?? process.env), [key]: command },
      });
    },
  };
}

export function createPowerShellOutputExtension(cwd: string): InlineExtension {
  return {
    name: EXTENSION_NAME,
    hidden: true,
    factory(pi) {
      const definition = createPowerShellToolDefinition(cwd, {
        operations: createProjectCommandBashOperations({ localOperations: createUtf8PowerShellOperations() }),
      });
      pi.registerTool({
        ...definition,
        // 仅替换内置实现；注册扩展不能让原本关闭的 Shell 自动变成活动工具。
        defaultActive: false,
        promptGuidelines: [
          ...(definition.promptGuidelines ?? []),
          "当前工具使用 PowerShell 语法，不套用 Unix 参数。查询目录可用 Get-Location 和 Get-ChildItem -LiteralPath . -Force -Name；按用户要求控制范围。",
          "命令成功且没有输出可能是正常结果。已有足够证据时停止查询；失败时先核对具体错误，不重复同义命令。",
          "Select-Object -First 0 等过滤或输出抑制会主动产生空输出，不能据此声称目录为空、没有匹配项。需要实际工具结果才能报告执行成功或失败。",
        ],
      });
    },
  };
}

/** 用户自行提供的同名工具保持优先，宿主修复不覆盖其行为。 */
export function preferUserPowerShellExtension(base: LoadExtensionsResult): LoadExtensionsResult {
  const index = base.extensions.findIndex(extension => extension.path === EXTENSION_PATH);
  if (index < 0) return base;
  const owner = base.extensions.slice(0, index).find(extension => extension.tools.has("powershell"));
  if (!owner) return base;
  return {
    ...base,
    extensions: base.extensions.filter((_, candidate) => candidate !== index),
    errors: base.errors.filter(error => !(error.path === EXTENSION_PATH
      && error.error === `Tool "powershell" conflicts with ${owner.path}`)),
  };
}
