"use client";
import { useI18n } from "@/hooks/useI18n";
import { useEffect, useRef, useState } from "react";
import { openStackedDialog } from "@/lib/stacked-dialog";
import { discardFileDraft, getFileEditDraft, saveFileDraft } from "@/lib/file-edit-drafts";

export function FileEditCloseDialog({ path, onClose, onCancel }: { path: string; onClose: () => void; onCancel: () => void }) {
  const { t } = useI18n();
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
    <strong id="file-edit-close-title">{t("fileEdit.closeTitle")}</strong><p>{t("fileEdit.unsavedFile", { name: path.replaceAll("\\", "/").split("/").at(-1) ?? path })}</p>
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onCancel}>{t("sidebar.cancel")}</button><button type="button" disabled={busy} onClick={() => {
      if (getFileEditDraft(path)?.saving) { setError(t("fileEdit.stillSaving")); return; }
      discardFileDraft(path); onClose();
    }}>{t("fileEdit.discard")}</button><button type="button" disabled={busy} onClick={async () => {
      busyRef.current = true; setBusy(true);
      try { if (await saveFileDraft(path)) { discardFileDraft(path); onClose(); } else setError(getFileEditDraft(path)?.error ?? t("fileEdit.resolveBeforeClose")); }
      finally { busyRef.current = false; setBusy(false); }
    }}>{busy ? t("i18n.saving") : t("fileEdit.saveClose")}</button></footer>
  </div></div>;
}
