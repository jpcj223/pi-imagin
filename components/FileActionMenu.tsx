"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FILE_MUTATION_EVENT, type FileMutation } from "@/lib/file-mutation";
import { forgetCleanFileEditsWithin, hasFileEditsWithin } from "@/lib/file-edit-drafts";

type Target = { cwd: string; path: string; name: string; x: number; y: number; isDir?: boolean; projectRoot?: boolean };
type Undo = { path: string; token: string };
function readUndo(cwd: string): Undo | null {
  try { const value = JSON.parse(localStorage.getItem(`pi-imagin:file-undo:${cwd}`) || "null");return typeof value?.path === "string" && typeof value?.token === "string" ? value : null; } catch { return null; }
}
export function openFileActionMenu(target: Target) { window.dispatchEvent(new CustomEvent("pi-imagin:file-actions", { detail: target })); }

export function FileActionMenu({ cwd, onChanged, onUpload, onOpenTerminal }: { cwd: string; onChanged: () => void; onUpload?: (directory: string) => void; onOpenTerminal?: (directory: string) => void }) {
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
    if (action !== "restore" && hasFileEditsWithin(path)) { setError("该文件或目录中有未保存修改，请先保存或关闭对应文件。"); return; }
    setBusy(true);setError("");
    try {
      const response = await fetch("/api/file-actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, path, action, name, token: undo?.token }) });
      const data = await response.json();if (!response.ok) throw new Error(data.error || "文件操作失败");
      if (action === "delete") saveUndo({ path, token: data.token });
      if (action === "restore") saveUndo(null);
      const mutation: FileMutation = { action, path, nextPath: data.path };
      if (action !== "restore") forgetCleanFileEditsWithin(path);
      window.dispatchEvent(new CustomEvent(FILE_MUTATION_EVENT, { detail: mutation }));
      setTarget(null);onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function openDirectory() {
    if (!target?.isDir || busy) return;
    setBusy(true);setError("");
    try {
      const response = await fetch("/api/open-in-explorer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: target.path }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error === "remote" ? "仅支持在本机打开文件管理器。" : data.error || "打开文件管理器失败");
      setTarget(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <>
    {undo && <div className="workspace-file-undo" role="status">文件已移入回收目录<button disabled={busy} onClick={() => void operate("restore")}>撤销</button>{error && <span role="alert">{error}</span>}</div>}
    {target && createPortal(<div ref={menuRef} role="dialog" aria-label={`${target.name}的操作`} className="workspace-file-menu" style={{ left: Math.max(8, Math.min(target.x, window.innerWidth - 260)), top: Math.max(8, Math.min(target.y, window.innerHeight - 320)) }}>
      <strong>{target.name}</strong>
      {mode === "menu" ? <>
        {target.isDir && <>
          {onUpload && <button disabled={busy} onClick={() => { onUpload(target.path);setTarget(null); }}>上传文件到此目录…</button>}
          {onOpenTerminal && <button disabled={busy} onClick={() => { onOpenTerminal(target.path);setTarget(null); }}>在此目录打开终端</button>}
          <button disabled={busy} onClick={() => void openDirectory()}>在文件管理器中打开</button>
        </>}
        {!target.projectRoot && <><button onClick={() => setMode("rename")}>重命名</button><button className="is-danger" onClick={() => setMode("delete")}>删除</button></>}
      </> : mode === "rename" ? <form onSubmit={event => { event.preventDefault(); void operate("rename"); }}><label>新名称<input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={200} /></label><button disabled={busy || !name.trim()} type="submit">保存</button></form> : <><p>移入项目回收目录，之后可以撤销。</p><button disabled={busy} className="is-danger" onClick={() => void operate("delete")}>确认删除</button></>}
      {error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => setTarget(null)}>取消</button>
    </div>, document.body)}
  </>;
}
