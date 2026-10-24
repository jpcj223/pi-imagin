import { ResourceCache } from "./browser-resource-cache";
import { validSkillSource, validSkillSlug, type CatalogSkill, type CatalogSkillDetail, type SkillCatalogPage } from "./skill-catalog-types";
import type { SkillContentResponse } from "./api-types";

const pages = new ResourceCache<SkillCatalogPage>(40, 60000);
const details = new ResourceCache<CatalogSkillDetail>(20, 300000);
const contents = new ResourceCache<SkillContentResponse>(20, 30000);
const HOME_KEY = "pi-skills-catalog-home-v1";
let restored = false;
const key = (query: string, page: number) => JSON.stringify([query.trim(), page]);
function validPage(data: SkillCatalogPage, page: number): boolean {
  return data?.page === page && Number.isSafeInteger(data.total) && data.total >= 0 && typeof data.hasNext === "boolean" && typeof data.searchLimited === "boolean"
    && Array.isArray(data.items) && data.items.length <= 200 && data.items.every(item => validSkillSource(item.source) && validSkillSlug(item.slug)
      && item.package === `${item.source}@${item.slug}` && item.url === `https://skills.sh/${item.source}/${item.slug}` && typeof item.name === "string" && item.name.length <= 300 && Number.isSafeInteger(item.installs) && item.installs >= 0 && typeof item.official === "boolean");
}
function restoreHome() {
  if (restored || typeof sessionStorage === "undefined") return;
  restored = true;
  try {
    const raw = sessionStorage.getItem(HOME_KEY); if (!raw || raw.length > 200000) return;
    const saved = JSON.parse(raw) as { at: number; data: SkillCatalogPage };
    if (Number.isFinite(saved.at) && saved.at <= Date.now() && Date.now() - saved.at < 86400000 && validPage(saved.data, 0)) pages.put(key("", 0), saved.data, saved.at + 60000);
  } catch { /* 缓存损坏或存储不可用时正常联网。 */ }
}
async function json<T>(url: string, signal: AbortSignal): Promise<T> {
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try {
    if (signal.aborted) controller.abort();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Skills request HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
export function peekSkillPage(query = "", page = 0) { restoreHome(); return pages.peek(key(query, page)); }
export function loadBrowserSkillPage(query = "", page = 0, signal?: AbortSignal, force = false) {
  restoreHome();
  return pages.load(key(query, page), async signal => {
    const data = await json<SkillCatalogPage>("/api/skills/catalog?" + new URLSearchParams({ q: query.trim(), page: String(page) }), signal);
    if (!validPage(data, page)) throw new Error("Invalid skills page");
    if (!query.trim() && page === 0) try { sessionStorage.setItem(HOME_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* 缓存失败不影响浏览。 */ }
    return data;
  }, signal, force);
}
export function peekCatalogSkillDetail(pkg: string) { return details.peek(pkg); }
export function loadBrowserSkillDetail(skill: CatalogSkill, signal?: AbortSignal, force = false) {
  return details.load(skill.package, async signal => {
    const data = await json<CatalogSkillDetail>("/api/skills/catalog/detail?" + new URLSearchParams({ source: skill.source, slug: skill.slug, ...(force ? { refresh: "1" } : {}) }), signal);
    if (data.package !== skill.package || typeof data.description !== "string" || typeof data.readmeHtml !== "string" || data.readmeHtml.length > 300000) throw new Error("Invalid skill detail");
    if (data.markdown !== undefined && (typeof data.markdown !== "string" || data.markdown.length > 1048576)) throw new Error("Invalid skill documentation");
    return data;
  }, signal, force);
}
export function loadInstalledSkillContent(cwd: string | null, filePath: string, signal?: AbortSignal, force = false) {
  return contents.load(JSON.stringify([cwd ?? "", filePath]), async signal => {
    const data = await json<SkillContentResponse>("/api/skills/content?" + new URLSearchParams({ ...(cwd ? { cwd } : {}), filePath }), signal);
    if (typeof data.content !== "string" || data.content.length > 1048576) throw new Error("Invalid skill content");
    return data;
  }, signal, force);
}
export function invalidateInstalledSkillContent(cwd: string | null, filePath: string) { contents.entries.delete(JSON.stringify([cwd ?? "", filePath])); }
