"use client";
import { useI18n } from "@/hooks/useI18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FILE_MUTATION_EVENT, type FileMutation } from "@/lib/file-mutation";
import { forgetCleanFileEditsWithin, lockFileEditsWithin } from "@/lib/file-edit-drafts";

type Target = { cwd: string; path: string; name: string; x: number; y: number; isDir?: boolean; projectRoot?: boolean };
type Undo = { path: string; token: string };
function readUndo(cwd: string): Undo | null {
  try { const value = JSON.parse(localStorage.getItem(`pi-imagin:file-undo:${cwd}`) || "null");return typeof value?.path === "string" && typeof value?.token === "string" ? value : null; } catch { return null; }
}
export function openFileActionMenu(target: Target) { window.dispatchEvent(new CustomEvent("pi-imagin:file-actions", { detail: target })); }

export function FileActionMenu({ cwd, onChanged, onUpload, onOpenTerminal }: { cwd: string; onChanged: () => void; onUpload?: (directory: string) => void; onOpenTerminal?: (directory: string) => void }) {
  const { t } = useI18n();
  const [target, setTarget] = useState<Target | null>(null);
  const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setUndo(readUndo(cwd));setTarget(null);setError(""); }, [cwd]);
  function saveUndo(value: Undo | null) { setUndo(value);try { if (value) localStorage.setItem(`pi-imagin:file-undo:${cwd}`, JSON.stringify(value));else localStorage.removeItem(`pi-imagin:file-undo:${cwd}`); } catch { /* 存储不可用时保留当前窗口中的恢复入口。 */ } }
  useEffect(() => {
    const open = (event: Event) => { const item = (event as CustomEvent<Target>).detail; if (item.cwd !== cwd) return; setTarget(item); setName(item.name); setMode("menu"); setError(""); };
    window.addEventListener("pi-imagin:file-actions", open);
    return () => window.removeEventListener("pi-imagin:file-actions", open);
  }, [cwd]);
  useEffect(() => {
    if (!target) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node) && !busy) setTarget(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); setTarget(null); } };
    document.addEventListener("pointerdown", close);document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close);document.removeEventListener("keydown", escape); };
  }, [target, busy]);
  async function operate(action: "rename" | "delete" | "restore") {
    const path = action === "restore" ? undo?.path : target?.path;
    if (!path || busy) return;
    let unlock: (() => void) | undefined;
    try { unlock = lockFileEditsWithin(path); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("fileEdit.unavailable")); return; }
    setBusy(true);setError("");
    try {
      const response = await fetch("/api/file-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, path, action, name, token: undo?.token }) });
      const data = await response.json();if (!response.ok) throw new Error(data.error || t("fileEdit.actionFailed"));
      if (action === "delete") saveUndo({ path, token: data.token });
      if (action === "restore") saveUndo(null);
      const mutation: FileMutation = { action, path, nextPath: data.path };
      if (action !== "restore") forgetCleanFileEditsWithin(path);
      window.dispatchEvent(new CustomEvent(FILE_MUTATION_EVENT, { detail: mutation }));
      setTarget(null);onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { unlock?.(); setBusy(false); }
  }
  async function openDirectory() {
    if (!target?.isDir || busy) return;
    setBusy(true);setError("");
    try {
      const response = await fetch("/api/open-in-explorer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: target.path }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error === "remote" ? t("sidebar.openInExplorerRemoteOnly") : data.error || t("fileEdit.openManagerFailed"));
      setTarget(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <>
    {undo && <div className="workspace-file-undo" role="status">{t("fileEdit.movedToTrash")}<button disabled={busy} onClick={() => void operate("restore")}>{t("sidebar.undo")}</button>{error && <span role="alert">{error}</span>}</div>}
    {target && createPortal(<div ref={menuRef} role="dialog" aria-label={t("fileEdit.actions", { name: target.name })} className="workspace-file-menu" style={{ left: Math.max(8, Math.min(target.x, window.innerWidth - 260)), top: Math.max(8, Math.min(target.y, window.innerHeight - 320)) }}>
      <strong>{target.name}</strong>
      {mode === "menu" ? <>
        {target.isDir && <>
          {onUpload && <button disabled={busy} onClick={() => { onUpload(target.path);setTarget(null); }}>{t("fileEdit.uploadHere")}</button>}
          {onOpenTerminal && <button disabled={busy} onClick={() => { onOpenTerminal(target.path);setTarget(null); }}>{t("fileEdit.terminalHere")}</button>}
          <button disabled={busy} onClick={() => void openDirectory()}>{t("fileEdit.openManager")}</button>
        </>}
        {!target.projectRoot && <><button onClick={() => setMode("rename")}>{t("sidebar.rename")}</button><button className="is-danger" onClick={() => setMode("delete")}>{t("sidebar.delete")}</button></>}
      </> : mode === "rename" ? <form onSubmit={event => { event.preventDefault(); void operate("rename"); }}><label>{t("fileEdit.newName")}<input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={200} /></label><button disabled={busy || !name.trim()} type="submit">{t("i18n.save")}</button></form> : <><p>{t("fileEdit.trashHint")}</p><button disabled={busy} className="is-danger" onClick={() => void operate("delete")}>{t("fileEdit.confirmDelete")}</button></>}
      {error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => setTarget(null)}>{t("sidebar.cancel")}</button>
    </div>, document.body)}
  </>;
}
