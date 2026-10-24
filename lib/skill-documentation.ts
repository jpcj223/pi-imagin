import { ResourceCache } from "./browser-resource-cache";
import { parseFrontmatter } from "./frontmatter";

interface TreeFile { path: string; type: string; sha: string }
interface Tree { sha: string; tree: TreeFile[]; truncated?: boolean }
const trees = new ResourceCache<Tree>(20, 300000);

/** 只访问固定公开主机，不接受用户提供的 URL，不执行仓库内容。 */
async function read(url: URL, signal: AbortSignal, maxBytes: number): Promise<string> {
  if (!["api.github.com", "raw.githubusercontent.com"].includes(url.hostname) || url.protocol !== "https:") throw new Error("Unsupported documentation source");
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]), redirect: "error", headers: { Accept: "application/vnd.github+json, text/plain", "User-Agent": "Pi-Imagin" } });
  if (!response.ok) throw new Error(`Documentation HTTP ${response.status}`);
  const reader = response.body?.getReader(); if (!reader) throw new Error("Empty documentation");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > maxBytes) throw new Error("Documentation too large"); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** 先查真实文件树，再读取该技能的文件；不猜测 README 或其他同名仓库。 */
export async function loadRepositorySkillDoc(source: string, slug: string, signal?: AbortSignal, force = false) {
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(source)) throw new Error("No repository documentation");
  const tree = await trees.load(source, async signal => {
    const data = JSON.parse(await read(new URL(`https://api.github.com/repos/${source}/git/trees/HEAD?recursive=1`), signal, 2000000)) as Tree;
    if (!Array.isArray(data.tree) || data.truncated || !/^[a-f0-9]{40,64}$/.test(data.sha)) throw new Error("Incomplete repository tree");
    return { ...data, tree: data.tree.filter(item => item.type === "blob" && typeof item.path === "string" && /(^|\/)SKILL\.md$/.test(item.path) && !item.path.split("/").some(part => part === ".." || part === ".")) };
  }, signal, force);
  const matching = tree.tree.filter(file => file.path.split("/").at(-2)?.toLowerCase() === slug.toLowerCase());
  const candidates = matching.length ? matching : tree.tree.filter(file => file.path === "SKILL.md");
  if (candidates.length !== 1) throw new Error("Skill documentation path is ambiguous or missing");
  const file = candidates[0];
  const url = new URL(`https://raw.githubusercontent.com/${source}/${tree.sha}/${file.path.split("/").map(encodeURIComponent).join("/")}`);
  const text = await read(url, signal ?? new AbortController().signal, 1048576);
  const parsed = parseFrontmatter(text);
  // 根目录文档须由 frontmatter 确认技能身份，避免展示整个仓库的另一技能。
  if (!matching.length && String(parsed.data?.name ?? "").toLowerCase() !== slug.toLowerCase()) throw new Error("Skill documentation identity mismatch");
  if (!parsed.rest.trim()) throw new Error("Empty skill instructions");
  return { markdown: parsed.rest.trim(), description: typeof parsed.data?.description === "string" ? parsed.data.description : "", documentUrl: url.href, documentPath: file.path };
}
