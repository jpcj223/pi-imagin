import { getDraft, setDraft } from "./draft-store";
import { isBase64ImageWithinLimits, MAX_ATTACHED_IMAGES } from "./image-attachments";

const STORAGE_KEY = "pi-imagin:active-new-session-draft";
const MAX_SNAPSHOT_CHARS = 2 * 1024 * 1024;
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

/** 仅在页面离开时保存本标签当前的新会话草稿，不逐字写入、不保存其他会话正文。 */
export function saveNewSessionDraft(key: string | null, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    const draft = key?.startsWith("new:") ? getDraft(key) : null;
    if (!draft) { storage.removeItem(STORAGE_KEY); return true; }
    const snapshot = JSON.stringify({ version: 1, key, draft });
    if (snapshot.length > MAX_SNAPSHOT_CHARS) throw new Error("草稿超出标签存储预算");
    storage.setItem(STORAGE_KEY, snapshot);
    return true;
  } catch {
    // 配额不足时继续保留内存草稿，并清除旧快照，避免刷新后恢复过期内容。
    try { storage.removeItem(STORAGE_KEY); } catch { /* 浏览器可能完全禁用存储。 */ }
    return false;
  }
}

export function restoreNewSessionDraft(key: string, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage || !key.startsWith("new:") || getDraft(key)) return false;
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text || text.length > MAX_SNAPSHOT_CHARS) return false;
    const snapshot = JSON.parse(text);
    const draft = snapshot?.draft;
    if (snapshot.version !== 1 || snapshot.key !== key || typeof draft?.value !== "string"
      || !Array.isArray(draft.images) || draft.images.length > MAX_ATTACHED_IMAGES
      || !draft.images.every(isBase64ImageWithinLimits)) return false;
    setDraft(key, { value: draft.value, images: draft.images });
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch { return false; }
}
