"use client";

export interface FileEditSnapshot { editable: boolean; reason?: string; text?: string; version?: string; encoding?: string; newline?: string }
export interface FileEditDraft {
  path: string; text: string; baseText: string; version: string;
  saving: boolean; error: string | null; conflict: FileEditSnapshot | null;
  selectionStart?: number; selectionEnd?: number; scrollTop?: number; scrollLeft?: number;
}
const drafts = new Map<string, FileEditDraft>();
const readVersions = new Map<string, number>();
const listeners = new Set<() => void>();
const summaries = new Set<() => void>();
let revision = 0;
const key = (path: string) => /^[a-z]:[\\/]|^\\\\/i.test(path) ? path.replaceAll("\\", "/").toLowerCase() : path;
function invalidateRead(path: string) { const id = key(path), next = (readVersions.get(id) ?? 0) + 1; readVersions.set(id, next); return next; }
export const getFileEditDraft = (path: string) => drafts.get(key(path)) ?? null;
export const fileDraftDirty = (draft: FileEditDraft | null | undefined) => Boolean(draft && draft.text !== draft.baseText);
export const hasFileEdits = () => [...drafts.values()].some(draft => fileDraftDirty(draft) || draft.saving);
export function hasFileEditsWithin(path: string) {
  const prefix = key(path).replace(/\/$/, "");
  return [...drafts.values()].some(draft => (key(draft.path) === prefix || key(draft.path).startsWith(prefix + "/")) && (fileDraftDirty(draft) || draft.saving));
}
export function forgetCleanFileEditsWithin(path: string) {
  const prefix = key(path).replace(/\/$/, "");
  for (const draft of drafts.values()) if ((key(draft.path) === prefix || key(draft.path).startsWith(prefix + "/")) && !fileDraftDirty(draft) && !draft.saving) publish(draft.path, null);
}
export const fileEditRevision = () => revision;
export function selectedFileLines(text: string, start: number, end: number) {
  if (start < 0 || end <= start || end > text.length) return null;
  return { startLine: text.slice(0, start).split("\n").length, endLine: text.slice(0, end).replace(/\n$/, "").split("\n").length };
}
export function subscribeFileEdits(listener: () => void) { summaries.add(listener); return () => { summaries.delete(listener); }; }
export function subscribeFileDraft(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(path: string, next: FileEditDraft | null) {
  const previous = getFileEditDraft(path);
  if (next) drafts.set(key(path), next); else drafts.delete(key(path));
  for (const listener of listeners) listener();
  if (fileDraftDirty(previous) !== fileDraftDirty(next) || previous?.saving !== next?.saving) {
    revision++; for (const listener of summaries) listener();
  }
}

export async function requestFileEdit(path: string, action: "read" | "save", values = {}): Promise<FileEditSnapshot> {
  const response = await fetch("/api/file-edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, action, ...values }) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? "文件操作失败。"), { status: response.status });
  return data;
}

export async function refreshFileDraft(path: string) {
  const requestVersion = invalidateRead(path);
  const snapshot = await requestFileEdit(path, "read");
  if (readVersions.get(key(path)) !== requestVersion) return null;
  const current = getFileEditDraft(path);
  if (current?.saving) return snapshot;
  if (snapshot.editable && typeof snapshot.text === "string" && snapshot.version) {
    if (current && fileDraftDirty(current)) {
      if (snapshot.version !== current.version) {
        // 原子替换即使内容相同也会换版本；只在基线内容一致时安全更新基线。
        publish(path, snapshot.text === current.baseText
          ? { ...current, version: snapshot.version, conflict: null }
          : { ...current, conflict: snapshot });
      }
    } else publish(path, { path, text: snapshot.text, baseText: snapshot.text, version: snapshot.version, saving: false, error: null, conflict: null,
      selectionStart: current?.selectionStart, selectionEnd: current?.selectionEnd, scrollTop: current?.scrollTop, scrollLeft: current?.scrollLeft });
  } else if (current && fileDraftDirty(current)) publish(path, { ...current, error: snapshot.reason ?? "文件已变为只读，修改仍保留。" });
  return snapshot;
}

export function changeFileDraft(path: string, text: string) {
  const current = getFileEditDraft(path);
  if (current) publish(path, { ...current, text, error: null });
}
export function rememberFileCursor(path: string, position: Pick<FileEditDraft, "selectionStart" | "selectionEnd" | "scrollTop" | "scrollLeft">) {
  const current = getFileEditDraft(path); if (current) drafts.set(key(path), { ...current, ...position });
}
export async function saveFileDraft(path: string): Promise<boolean> {
  const current = getFileEditDraft(path);
  if (!current) return true;
  if (current.saving) return false;
  if (!fileDraftDirty(current)) return true;
  const sent = current.text;
  invalidateRead(path);
  publish(path, { ...current, saving: true, error: null });
  try {
    const result = await requestFileEdit(path, "save", { text: sent, version: current.version });
    if (!result.version || typeof result.text !== "string") throw new Error("保存响应不完整，请重新核对磁盘内容。" );
    const latest = getFileEditDraft(path) ?? current;
    invalidateRead(path);
    // 保存期间继续输入的内容仍为脏草稿，不能被响应里的旧文本覆盖。
    publish(path, { ...latest, baseText: result.text, version: result.version, saving: false, error: null, conflict: null });
    window.dispatchEvent(new CustomEvent("pi-imagin:file-saved", { detail: { path } }));
    return !fileDraftDirty(getFileEditDraft(path));
  } catch (error) {
    const latest = getFileEditDraft(path) ?? current;
    invalidateRead(path);
    publish(path, { ...latest, saving: false, error: error instanceof Error ? error.message : "保存失败，内容仍保留。" });
    if ((error as { status?: number }).status === 409) await refreshFileDraft(path).catch(() => {});
    return false;
  }
}
export function discardFileDraft(path: string) { if (!getFileEditDraft(path)?.saving) { invalidateRead(path); publish(path, null); } }
export function adoptDiskFileDraft(path: string) {
  const current = getFileEditDraft(path), disk = current?.conflict;
  if (current && !current.saving && typeof disk?.text === "string" && disk.version) {
    invalidateRead(path);
    publish(path, { ...current, text: disk.text, baseText: disk.text, version: disk.version, conflict: null, error: null });
  }
}
export async function saveComparedFileDraft(path: string) {
  const current = getFileEditDraft(path), disk = current?.conflict;
  if (!current || current.saving || !disk?.editable || typeof disk.text !== "string" || !disk.version) return false;
  invalidateRead(path);
  // 仅在用户明确比较并确认后，以所显示的磁盘版本作为新基线；新变化仍由服务端拒绝。
  publish(path, { ...current, baseText: disk.text, version: disk.version, conflict: null });
  return saveFileDraft(path);
}

/** 刷新/离开前提供浏览器原生保护；只在页面离开时备份草稿，不逐字写存储。 */
export function installFileEditGuards() {
  const storageKey = "pi-imagin:file-edit-drafts";
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(stored)) for (const draft of stored) if (typeof draft?.path === "string" && typeof draft.text === "string" && typeof draft.baseText === "string" && /^[a-f0-9]{64}$/.test(draft.version)) {
      if (!getFileEditDraft(draft.path)) publish(draft.path, { ...draft, saving: false, error: null, conflict: null });
    }
    sessionStorage.removeItem(storageKey);
  } catch { /* 存储不可用时仍有内存草稿和离开提醒。 */ }
  const warn = (event: BeforeUnloadEvent) => { if (hasFileEdits()) { backup(); event.preventDefault(); event.returnValue = ""; } };
  const backup = () => {
    try {
      const value = JSON.stringify([...drafts.values()].filter(fileDraftDirty));
      if (value.length <= 2 * 1024 * 1024) sessionStorage.setItem(storageKey, value);
      else sessionStorage.removeItem(storageKey);
    } catch { /* 超出配额时不能保证刷新恢复，离开提醒仍然有效。 */ }
  };
  window.addEventListener("beforeunload", warn); window.addEventListener("pagehide", backup);
  return () => { window.removeEventListener("beforeunload", warn); window.removeEventListener("pagehide", backup); };
}
