import { pluginLogoUrl } from "./plugin-presentation";
export { pluginLogoUrl } from "./plugin-presentation";
export interface CatalogPlugin {
  name: string;
  source: string;
  description: string;
  author?: string;
  types: string[];
  logo?: string;
  url: string;
}
export interface PluginCatalogPage { items: CatalogPlugin[]; page: number; total: number; hasNext: boolean }

const ORIGIN = "https://pi.dev";
const NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i;
const cache = new Map<string, { expires: number; data: PluginCatalogPage }>();

export function decodeCatalogText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (raw, name: string) => {
    const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
    if (!name.startsWith("#")) return named[name.toLowerCase()] ?? raw;
    const n = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
  });
}
function text(value: string): string { return decodeCatalogText(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
function attribute(tag: string, name: string): string { return decodeCatalogText(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? ""); }

/** 官方目录的只读适配；仅提取文本字段，不执行或转发网页 HTML。 */
export function parsePluginCatalog(html: string, page: number): PluginCatalogPage {
  const items: CatalogPlugin[] = [];
  for (const match of html.matchAll(/<article\b([^>]*\bdata-package-card="true"[^>]*)>([\s\S]*?)<\/article>/g)) {
    const name = attribute(match[1], "data-package-name");
    if (!NAME.test(name) || name.length > 214 || items.some(item => item.name === name)) continue;
    const body = match[2];
    const command = attribute(body.match(/<button\b[^>]*\bdata-copy-text="[^"]*"[^>]*>/)?.[0] ?? "", "data-copy-text");
    // 只允许目录明确提供的 npm 包，不能把网页任意文字变成安装命令。
    if (command !== `pi install npm:${name}`) continue;
    const description = text(body.match(/<p\b[^>]*class="packages-desc"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "").slice(0, 2000);
    const author = text(body.match(/class="packages-meta"[^>]*>\s*<span>([\s\S]*?)<\/span>/)?.[1] ?? "");
    items.push({ name, source: `npm:${name}`, description, author: author || undefined, types: attribute(match[1], "data-package-types").split(/\s+/).filter(Boolean), url: `${ORIGIN}/packages/${name}` });
  }
  const count = text(html.match(/class="packages-count"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "");
  // 官方空结果使用「0 / 全站总数」，分母不能当成本次命中数。
  const total = /^0\s*\//.test(count) ? 0 : Number(count.match(/\/\s*([\d,]+)/)?.[1]?.replaceAll(",", "") ?? "0");
  if (!html.includes('class="packages-count"') || (total > 0 && !items.length)) throw new Error("Plugin catalog format changed");
  const pagination = html.match(/<nav\b[^>]*class="pagination packages-pagination"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
  const hasNext = total > 0 && [...pagination.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].some(link => {
    if (!/^Next\b/.test(text(link[2]))) return false;
    try { const target = new URL(attribute(link[1], "href"), ORIGIN); return target.origin === ORIGIN && target.pathname === "/packages" && Number(target.searchParams.get("page")) === page + 1; } catch { return false; }
  });
  return { items, page, total, hasNext };
}

export async function boundedCatalogText(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`Plugin catalog HTTP ${response.status}`);
  const reader = response.body?.getReader(); if (!reader) throw new Error("Empty catalog response");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2_000_000) throw new Error("Catalog response too large"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => { }); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function searchPluginCatalog(query: string, page: number, signal?: AbortSignal): Promise<PluginCatalogPage> {
  const url = new URL("/packages", ORIGIN); if (query) url.searchParams.set("name", query); if (page > 1) url.searchParams.set("page", String(page));
  const key = url.href; const hit = cache.get(key); if (hit && hit.expires > Date.now()) return hit.data;
  if (/^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "")) throw new Error("Plugin catalog is unavailable offline");
  const combined = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
  const html = await boundedCatalogText(await fetch(url, { signal: combined, redirect: "error", headers: { Accept: "text/html" } }));
  const data = parsePluginCatalog(html, page);
  if (combined.aborted) throw combined.reason;
  if (cache.size >= 40) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 60000, data }); return data;
}

const logoCache = new Map<string, { expires: number; url?: string }>();
/** 图标独立加载，慢图标服务不会阻塞目录文字。 */
export async function loadPluginLogos(names: string[], signal?: AbortSignal): Promise<Record<string, string>> {
  const logos: Record<string, string> = {}, missing: string[] = [];
  for (const name of names) {
    const hit = logoCache.get(name);
    if (hit && hit.expires > Date.now()) { if (hit.url) logos[name] = hit.url; }
    else missing.push(name);
  }
  if (!missing.length || /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "")) return logos;
  await Promise.all(Array.from({ length: Math.ceil(missing.length / 16) }, async (_, batch) => {
    const group = missing.slice(batch * 16, batch * 16 + 16), preview = new URL("/api/packages/preview-media", ORIGIN);
    for (const name of group) preview.searchParams.append("name", name);
    const response = await fetch(preview, { signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]), redirect: "error" });
    const json = JSON.parse(await boundedCatalogText(response)) as { previews?: { name?: string; media?: { url?: string } }[] };
    for (const name of group) {
      const url = pluginLogoUrl(json.previews?.find(item => item.name === name)?.media?.url);
      if (logoCache.size >= 1000) logoCache.delete(logoCache.keys().next().value!);
      logoCache.set(name, { expires: Date.now() + 300000, url });
      if (url) logos[name] = url;
    }
  }));
  return logos;
}
