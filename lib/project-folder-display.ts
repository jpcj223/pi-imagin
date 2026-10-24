/** 展示身份仅用于名称匹配与最近列表，不参与文件授权。 */
export function folderDisplayName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}
export function folderDisplayKey(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:|^\/\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}
export const REMOVED_RECENT_FOLDERS_KEY = "pi-imagin-removed-recent-folders-v1";
