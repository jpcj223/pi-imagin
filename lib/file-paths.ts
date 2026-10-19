export function normalizeFilePathSlashes(filePath: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\")) {
    return filePath.replace(/\\/g, "/");
  }
  return filePath;
}

export function encodeFilePathForApi(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath);
  const segments = normalized.split("/").filter(Boolean);
  // A literal "//" prefix is normalized away by URL routing before it reaches
  // the catch-all handler, so a UNC root must live inside the first segment:
  // "//host" encodes as "%2F%2Fhost" and decodes back as a single segment.
  if (normalized.startsWith("//") && segments.length > 0) {
    segments[0] = `//${segments[0]}`;
  }
  return segments.map(encodeURIComponent).join("/");
}

export function getFileName(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  return normalized.split("/").pop() ?? normalized;
}

export function getFileDirectory(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return "";
  if (lastSlash === 0) return "/";
  if (lastSlash === 2 && /^[a-zA-Z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, lastSlash);
}

export function getRelativeFilePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;

  const normalizedFile = normalizeFilePathSlashes(filePath);
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
  if (normalizedFile.startsWith(normalizedCwd + "/")) {
    return normalizedFile.slice(normalizedCwd.length + 1);
  }
  return filePath;
}

export function joinFilePath(parent: string, child: string): string {
  return `${normalizeFilePathSlashes(parent).replace(/\/$/, "")}/${child}`;
}

export interface ExplorerFolder { name: string; path: string }

function pathKey(path: string): string {
  const normalized = normalizeFilePathSlashes(path).replace(/\/$/, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}

export function fileOwnerRoot(path: string, folders: readonly ExplorerFolder[], fallback: string): string {
  const target = pathKey(path);
  return [...folders].sort((a, b) => b.path.length - a.path.length).find(folder => {
    const root = pathKey(folder.path);
    return target === root || target.startsWith(`${root}/`);
  })?.path ?? fallback;
}

/** 同名根仅补充父目录；目录身份始终使用真实路径。 */
export function explorerFolders(folders: readonly ExplorerFolder[]): ExplorerFolder[] {
  const unique = [...new Map(folders.map(folder => [pathKey(folder.path), folder])).values()];
  return unique.map(folder => ({ ...folder, name: unique.filter(other => other.name === folder.name).length > 1
    ? `${folder.name} · ${getFileDirectory(folder.path) || getFileName(folder.path)}` : folder.name }));
}

/** Git 按目录返回统计，嵌套根只查询外层，避免文件和增删行重复计数。 */
export function independentRoots(folders: readonly ExplorerFolder[]): ExplorerFolder[] {
  return folders.filter(folder => !folders.some(other => other !== folder && pathKey(folder.path).startsWith(`${pathKey(other.path)}/`)));
}
