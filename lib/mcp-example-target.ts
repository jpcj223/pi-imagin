/** 页面演示地址不能作为真实服务器保存；其余地址仍由原有校验器处理。 */
export function isMcpExampleTarget(config: object): boolean {
  if (!("url" in config) || typeof config.url !== "string") return false;
  try {
    const host = new URL(config.url).hostname.toLowerCase();
    return host === "mcp.example.com" || host === "placeholder.invalid";
  } catch {
    return false;
  }
}
