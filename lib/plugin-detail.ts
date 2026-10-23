import { boundedCatalogText, decodeCatalogText } from "./plugin-catalog";

export interface PluginSourceDetail {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  published?: string;
  license?: string;
  dependencies?: string;
  engines?: Record<string, string>;
  homepage?: string;
  repository?: string;
  readmeHtml?: string;
  readmeTruncated?: boolean;
  partial: boolean;
}
export function isCatalogPackageName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 214 && /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(value);
}
function plain(value: string): string {
  return decodeCatalogText(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
export function pluginWebLink(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2000) return;
  try {
    const url = new URL(value.replace(/^git\+/, ""));
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* 缺失或不支持的链接不进入界面。 */ }
}

/** 从官方详情读取展示字段；README 仍是外部 HTML，客户端必须净化后呈现。 */
export function parsePluginDetail(html: string, name: string): PluginSourceDetail {
  if (!html.includes('class="definition-grid detail-grid"')) throw new Error("Plugin detail format changed");
  const grid = html.match(/<dl class="definition-grid detail-grid">([\s\S]*?)<\/dl>/)?.[1] ?? "";
  const fields = Object.fromEntries([...grid.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)].map(match => [plain(match[1]), plain(match[2])]));
  if (fields.Package !== name) throw new Error("Plugin detail identity mismatch");
  const readme = html.match(/<div class="rich-text packages-readme">([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/)?.[1];
  return { name, version: fields.Version, author: fields.Author, published: fields.Published, license: fields.License, dependencies: fields.Dependencies, readmeHtml: readme?.slice(0, 500_000), readmeTruncated: Boolean(readme && readme.length > 500_000), partial: false };
}

const cache = new Map<string, { expires: number; value: PluginSourceDetail }>();
export async function loadPluginDetail(name: string, signal?: AbortSignal): Promise<PluginSourceDetail> {
  if (!isCatalogPackageName(name)) throw new Error("Invalid plugin name");
  const hit = cache.get(name);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (/^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "")) throw new Error("Plugin detail is unavailable offline");
  const combined = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
  const [page, metadata] = await Promise.allSettled([
    fetch(`https://pi.dev/packages/${name}`, { redirect: "error", signal: combined }).then(boundedCatalogText).then(html => parsePluginDetail(html, name)),
    fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, { redirect: "error", signal: combined, headers: { Accept: "application/json" } }).then(boundedCatalogText).then(raw => JSON.parse(raw) as Record<string, unknown>),
  ]);
  if (signal?.aborted) throw signal.reason;
  if (page.status === "rejected" && metadata.status === "rejected") throw new Error("Plugin details are unavailable");
  const detail: PluginSourceDetail = page.status === "fulfilled" ? page.value : { name, partial: true };
  if (metadata.status === "fulfilled") {
    const data = metadata.value;
    if (data.name !== name) throw new Error("Plugin metadata identity mismatch");
    if (typeof data.description === "string") detail.description = data.description.slice(0, 2000);
    if (!detail.version && typeof data.version === "string") detail.version = data.version.slice(0, 100);
    if (!detail.license && typeof data.license === "string") detail.license = data.license.slice(0, 200);
    detail.homepage = pluginWebLink(data.homepage);
    const repository = data.repository as { url?: unknown } | undefined;
    detail.repository = pluginWebLink(typeof data.repository === "string" ? data.repository : repository?.url)?.replace(/\.git$/, "");
    if (data.engines && typeof data.engines === "object") detail.engines = Object.fromEntries(Object.entries(data.engines).filter((entry): entry is [string, string] => typeof entry[1] === "string").slice(0, 20));
  } else detail.partial = true;
  if (!detail.partial) {
    if (cache.size >= 20) cache.delete(cache.keys().next().value!);
    cache.set(name, { expires: Date.now() + 300000, value: detail });
  }
  return detail;
}
