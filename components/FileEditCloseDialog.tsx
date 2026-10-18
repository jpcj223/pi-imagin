"use client";
import { useEffect, useRef, useState } from "react";
import { openStackedDialog } from "@/lib/stacked-dialog";
import { discardFileDraft, getFileEditDraft, saveFileDraft } from "@/lib/file-edit-drafts";

export function FileEditCloseDialog({ path, onClose, onCancel }: { path: string; onClose: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null), busyRef = useRef(false), cancel = useRef(onCancel);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  cancel.current = onCancel;
  useEffect(() => openStackedDialog(document, ref.current, () => { if (!busyRef.current) cancel.current(); }), []);
  return <div className="file-edit-close-backdrop"><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="file-edit-close-title" className="file-edit-close-dialog" onKeyDown={event => {
    if (event.key !== "Tab") return;
    const buttons = ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (!buttons?.length) { event.preventDefault(); return; }
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>
    <strong id="file-edit-close-title">保存文件修改？</strong><p>{path.replaceAll("\\", "/").split("/").at(-1)} 存在未保存内容。</p>
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="button" disabled={busy} onClick={() => {
      if (getFileEditDraft(path)?.saving) { setError("文件仍在保存，请稍后重试。"); return; }
      discardFileDraft(path); onClose();
    }}>放弃修改</button><button type="button" disabled={busy} onClick={async () => {
      busyRef.current = true; setBusy(true);
      try { if (await saveFileDraft(path)) { discardFileDraft(path); onClose(); } else setError(getFileEditDraft(path)?.error ?? "文件仍有未保存内容，请先处理后再关闭。"); }
      finally { busyRef.current = false; setBusy(false); }
    }}>{busy ? "正在保存…" : "保存并关闭"}</button></footer>
  </div></div>;
}
