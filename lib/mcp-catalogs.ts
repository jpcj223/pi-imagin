/** 网站入口仅是浏览器偏好，不读取或修改 MCP 服务器配置。 */
export interface McpCatalog { label: string; href: string }
export const MCP_CATALOGS_STORAGE_KEY = "pi-mcp-catalogs-v1";
export const DEFAULT_MCP_CATALOGS: readonly McpCatalog[] = [
  { href: "https://glama.ai/mcp/servers", label: "glama.ai" },
  { href: "https://smithery.ai/servers", label: "smithery.ai" },
  { href: "https://mcp.so/", label: "mcp.so" },
  { href: "https://registry.modelcontextprotocol.io/", label: "MCP Registry" },
  { href: "https://github.com/mcp", label: "github.com/mcp" },
];

export function validMcpCatalog(catalog: McpCatalog): boolean {
  if (!catalog.label.trim() || !catalog.href.trim()) return false;
  try {
    const url = new URL(catalog.href);
    return ["https:", "http:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

export function readMcpCatalogs(raw: string | null): readonly McpCatalog[] {
  if (raw === null) return DEFAULT_MCP_CATALOGS;
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every(item => item && typeof item.label === "string" && typeof item.href === "string" && validMcpCatalog(item))) {
      return value.map(({ label, href }) => ({ label: label.trim(), href: href.trim() }));
    }
  } catch { /* 损坏的偏好回退默认入口；不影响已配置的服务器。 */ }
  return DEFAULT_MCP_CATALOGS;
}
