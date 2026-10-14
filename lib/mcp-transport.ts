import type { McpServerConfig, McpTransportFactory } from "@earendil-works/pi-coding-agent";
import type { McpConfigFieldRef } from "./api-types";
import { findWebPasswordField, resolvedConfigValues, WEB_PASSWORD_VARIABLE, type McpResolvedConfigValue } from "./mcp-config-values";
import type { PiSdkInternals } from "./pi-sdk-internals";
import { sanitizeProjectCommandEnvironment } from "./project-command-env";

// The resolved-value walk and the PI_WEB_PASSWORD rule are client-safe (`lib/mcp-config-values.ts`).
export { findWebPasswordField, resolvedConfigValues, WEB_PASSWORD_VARIABLE, type McpResolvedConfigValue };

// MCP servers are started on behalf of a project like its bash commands, so
// they get the same environment: the server's own, without the variables that
// configure or guard this Next.js process (ADR 0006, "Safety → Environment").
// The SDK's default stdio transport passes the whole `process.env` instead.


type TransportInternals = Pick<
  PiSdkInternals,
  "createDefaultTransport" | "StdioTransport" | "getConfigValueEnvVarNames" | "isCommandConfigValue"
>;
type ConfigValueInternals = Pick<PiSdkInternals, "getConfigValueEnvVarNames" | "isCommandConfigValue">;

export interface PiImaginMcpTransportOptions {
  /** Environment stdio servers start from, before sanitizing. Defaults to `process.env` at connect time. */
  baseEnvironment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** `env "KEY"`, `header "Name"` or `oauth.clientSecret`, for messages. */
export function describeConfigField(field: McpConfigFieldRef): string {
  if (field.kind === "oauth-client-secret") return "oauth.clientSecret";
  return `${field.kind} "${field.name}"`;
}

/** `findWebPasswordField()` as the field's description, for messages. */
export function findWebPasswordReference(
  config: McpServerConfig,
  internals: ConfigValueInternals,
): string | undefined {
  const field = findWebPasswordField(config, internals);
  return field && describeConfigField(field);
}

/** The sanitized environment with the server's own `env` on top; a Windows name replaces any casing of itself. */
function serverEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  configured: Record<string, string>,
  platform: NodeJS.Platform,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(sanitizeProjectCommandEnvironment(baseEnvironment, platform))) {
    if (value !== undefined) environment[name] = value;
  }
  for (const [name, value] of Object.entries(configured)) {
    if (platform === "win32") {
      for (const existing of Object.keys(environment)) {
        if (existing.toUpperCase() === name.toUpperCase()) delete environment[existing];
      }
    }
    environment[name] = value;
  }
  return environment;
}

/**
 * HTTP 服务器使用 SDK 传输；stdio 保留 SDK 的命令、参数、cwd、stderr 和配置值解析，
 * 但以 inheritEnv: false 从清理过的环境启动，绝不退回继承完整宿主环境的默认传输。
 */
export function createPiImaginMcpTransportFactory(
  internals: TransportInternals,
  options: PiImaginMcpTransportOptions = {},
): McpTransportFactory {
  const platform = options.platform ?? process.platform;
  return (entry, cwd, authProvider) => {
    const field = findWebPasswordReference(entry.config, internals);
    if (field) {
      throw new Error(`MCP server "${entry.name}" ${field} references ${WEB_PASSWORD_VARIABLE}, which Pi Imagin does not pass to MCP servers`);
    }
    const transport = internals.createDefaultTransport(entry, cwd, authProvider);
    if ("url" in entry.config) return transport;
    if (!(transport instanceof internals.StdioTransport)) {
      throw new Error(`MCP server "${entry.name}": the SDK did not create a stdio transport`);
    }
    const { env: configured = {}, ...stdioOptions } = transport.options;
    // env 只能包含条目自身的值，额外值可能是 SDK 加入的未清理宿主环境。
    const declared = new Set(Object.keys(entry.config.env ?? {}));
    const unexpected = Object.keys(configured).find((name) => !declared.has(name));
    if (unexpected !== undefined) {
      throw new Error(`MCP server "${entry.name}": the SDK set environment variable ${unexpected}, which its config does not declare`);
    }
    return new internals.StdioTransport({
      ...stdioOptions,
      env: serverEnvironment(options.baseEnvironment ?? process.env, configured, platform),
      inheritEnv: false,
    });
  };
}
