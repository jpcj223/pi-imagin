import { decodeCatalogText } from "./plugin-catalog";
import { loadRepositorySkillDoc } from "./skill-documentation";
import { validSkillSource, validSkillSlug, type CatalogSkill, type SkillCatalogPage, type CatalogSkillDetail } from "./skill-catalog-types";

const pages = new Map<string, { expires: number; data: SkillCatalogPage }>();
const details = new Map<string, { expires: number; data: CatalogSkillDetail }>();

/** 公共目录提供 200 项真实分页；搜索接口只提供有限的命中集合，不伪造下一页。 */
export function parseSkillCatalog(raw: unknown, query: string, page: number): SkillCatalogPage {
  const data = raw as Record<string, unknown> | null;
  if (!data || !Array.isArray(data.skills) || data.skills.length > 200) throw new Error("Invalid skills catalog");
  if (!query && (data.page !== page || typeof data.hasMore !== "boolean" || !Number.isSafeInteger(data.total) || Number(data.total) < 0)) throw new Error("Invalid skills pagination");
  if (query && (data.query !== query || !Number.isSafeInteger(data.count) || data.count !== data.skills.length)) throw new Error("Invalid skills search");
  const items: CatalogSkill[] = [];
  for (const item of data.skills) {
    if (!item || typeof item !== "object") throw new Error("Invalid skill entry");
    const { source, skillId: slug, name, installs, isOfficial } = item;
    if (!validSkillSource(source) || !validSkillSlug(slug) || typeof name !== "string" || !name || name.length > 300 || !Number.isSafeInteger(installs) || installs < 0) throw new Error("Invalid skill entry");
    const pkg = `${source}@${slug}`;
    if (!items.some(entry => entry.package === pkg)) items.push({ name, source, slug, package: pkg, installs, official: isOfficial === true, url: `https://skills.sh/${source}/${slug}` });
  }
  return { items, page, total: query ? items.length : Number(data.total), hasNext: !query && data.hasMore === true, searchLimited: Boolean(query && data.skills.length >= 199) };
}

async function readPublic(path: string, signal?: AbortSignal): Promise<string> {
  if (/^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "")) throw new Error("Skills catalog is unavailable offline");
  // 沿用部署方配置的目录地址；请求参数不能指定主机、协议或本地文件。
  const origin = process.env.SKILLS_API_URL || "https://skills.sh";
  const root = new URL(origin), allowedOrigins = new Set([root.origin]);
  if (["https://skills.sh", "https://www.skills.sh"].includes(root.origin)) { allowedOrigins.add("https://skills.sh"); allowedOrigins.add("https://www.skills.sh"); }
  const combined = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
  let target = new URL(path, root), response: Response;
  for (let redirects = 0; ; redirects++) {
    response = await fetch(target, { signal: combined, headers: { Accept: "application/json, text/html" }, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location"); await response.body?.cancel();
    if (redirects >= 2 || !location) throw new Error("Invalid catalog redirect");
    target = new URL(location, target);
    if (!allowedOrigins.has(target.origin) || target.username || target.password) throw new Error("Unsupported catalog redirect");
  }
  if (!response.ok) throw new Error(`Skills catalog HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty skills response");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) throw new Error("Skills response too large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function loadSkillCatalog(query: string, page: number, signal?: AbortSignal): Promise<SkillCatalogPage> {
  const key = JSON.stringify([query, page]); const hit = pages.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  const path = query ? `/api/search?${new URLSearchParams({ q: query, limit: "200" })}` : `/api/skills/all-time/${page}`;
  const data = parseSkillCatalog(JSON.parse(await readPublic(path, signal)), query, page);
  if (signal?.aborted) throw signal.reason;
  if (pages.size >= 40) pages.delete(pages.keys().next().value!);
  pages.set(key, { expires: Date.now() + 60000, data }); return data;
}

/** 只取公开页的 SKILL.md 区块，外部 HTML 在客户端统一净化，绝不作为指令执行。 */
export function parseCatalogSkillDetail(html: string, source: string, slug: string): CatalogSkillDetail {
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/)?.[1];
  if (!canonical || !["https://skills.sh", "https://www.skills.sh"].some(origin => canonical === `${origin}/${source}/${slug}`)) throw new Error("Skill detail identity mismatch");
  const marker = html.indexOf(">SKILL.md</span>");
  const startTag = marker < 0 ? null : /<div class="prose\s[^"]*">/.exec(html.slice(marker));
  if (!startTag) throw new Error("Skill documentation is unavailable");
  const start = marker + startTag.index + startTag[0].length;
  const tags = /<\/?div\b[^>]*>/g; tags.lastIndex = start;
  let depth = 1, end = -1;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) { end = match.index; break; }
  }
  if (end < 0) throw new Error("Invalid skill documentation");
  return { package: `${source}@${slug}`, description: decodeCatalogText(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "").slice(0, 2000), readmeHtml: html.slice(start, Math.min(end, start + 300000)), truncated: end - start > 300000 || />Show more<\/button>/.test(html.slice(end, end + 1500)) };
}

export async function loadCatalogSkillDetail(source: string, slug: string, signal?: AbortSignal, force = false): Promise<CatalogSkillDetail> {
  const key = `${source}@${slug}`; const hit = details.get(key);
  if (!force && hit && hit.expires > Date.now()) return hit.data;
  let data: CatalogSkillDetail;
  try { data = parseCatalogSkillDetail(await readPublic(`/${source}/${slug}`, signal), source, slug); }
  catch (error) {
    if (signal?.aborted || /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "")) throw error;
    const full = await loadRepositorySkillDoc(source, slug, signal, force);
    data = { package: key, readmeHtml: "", ...full, truncated: false };
  }
  if (data.truncated) {
    try {
      const full = await loadRepositorySkillDoc(source, slug, signal, force);
      data = { ...data, ...full, description: full.description || data.description, readmeHtml: "", truncated: false };
    } catch { if (signal?.aborted) throw signal.reason; data.fullUnavailable = true; }
  }
  if (signal?.aborted) throw signal.reason;
  if (details.size >= 20) details.delete(details.keys().next().value!);
  details.set(key, { expires: Date.now() + (data.fullUnavailable ? 10000 : 300000), data }); return data;
}
