/**
 * Display-only path shortening for the settings panels. Nothing reads these
 * strings back: authorization and API calls always use the full path.
 */

/** A path with a macOS or Linux home folder shown as `~`. */
export function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

/** 仅省略中间路径，优先保留根目录和项目／资源目录；完整值不回传 API。 */
export function compactDisplayPath(path: string, limit = 42): string {
  const display = shortenPath(path);
  const budget = Math.max(12, Math.floor(limit));
  if (display.length <= budget) return display;
  const separator = display.includes("\\") ? "\\" : "/";
  const parts = display.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean);
  if (parts.length < 2) return `${display.slice(0, budget - 7)}…${display.slice(-6)}`;
  const count = parts.length >= 3 && [".pi", ".agents"].includes(parts.at(-2)!) ? 3 : 2;
  let tail = parts.slice(-count).join(separator);
  const root = display.startsWith("\\\\") ? `\\\\${parts[0]}` : display.startsWith("/") ? `/${parts[0]}` : parts[0];
  const head = parts.length > count + 1 ? `${root}${separator}${parts[1]}` : root;
  for (const prefix of [head, root]) {
    const result = `${prefix}${separator}…${separator}${tail}`;
    if (result.length <= budget) return result;
  }
  const prefix = root.length > Math.floor(budget / 3) ? `${root.slice(0, Math.floor(budget / 3) - 1)}…` : root;
  const room = budget - prefix.length - 3;
  if (tail.length > room) {
    // 尽量保留末尾资源目录，并给过长的项目名留出可辨识前缀。
    const end = tail.slice(tail.indexOf(separator));
    tail = end.length < room - 4 ? `${tail.slice(0, room - end.length - 1)}…${end}` : room > 5 ? `${tail.slice(0, 4)}…${tail.slice(-(room - 5))}` : `…${tail.slice(-(room - 1))}`;
  }
  return `${prefix}${separator}…${separator}${tail}`;
}

/**
 * A path inside `root` as `./relative`, anything else as `shortenPath()`.
 * Only a whole leading folder counts, so `/repo-other/x` is not inside `/repo`.
 */
export function displayPathWithin(path: string, root: string): string {
  const base = root.replace(/[/\\]+$/, "");
  if (base && (path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}\\`))) {
    return `./${path.slice(base.length).replace(/^[/\\]/, "")}`;
  }
  return shortenPath(path);
}
