import { getGlobalSettingsPath, updateGlobalSettings } from "./global-settings-file";

/** 只修改全局 MCP 内置扩展开关，保留其他扩展、通配规则和项目覆盖。 */
export async function writeMcpRuntimeEnabled(enabled: boolean, settingsPath = getGlobalSettingsPath()): Promise<void> {
  await updateGlobalSettings(settingsPath, (settings) => {
    const entries = settings.extensions;
    if (entries !== undefined && (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string"))) {
      throw new Error("Invalid settings.json: extensions must be an array of strings");
    }
    const kept = ((entries ?? []) as string[]).filter((entry) => !["builtin:mcp", "+builtin:mcp", "-builtin:mcp", "!builtin:mcp"].includes(entry));
    // 末尾的精确规则只覆盖 MCP；不能移除 !builtin:* 等涉及其他扩展的规则。
    settings.extensions = [...kept, `${enabled ? "+" : "-"}builtin:mcp`];
  });
}
