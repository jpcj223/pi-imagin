/** 图标仅作为图片呈现，拒绝脚本、凭据 URL 和非 HTTPS 协议。 */
export function pluginLogoUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2000) return;
  try { const url = new URL(value); if (url.protocol === "https:" && !url.username && !url.password) return url.href; } catch { }
}
