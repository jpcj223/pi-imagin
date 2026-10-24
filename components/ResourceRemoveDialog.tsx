"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { focusModalPanel, listenForStackedDialogEscape } from "@/lib/stacked-dialog";
import { ConfigButton } from "./SettingsUi";

/** 插件和技能共用确认弹窗，焦点和 Escape 只作用于最上层。 */
export function ResourceRemoveDialog({ name, description, busy, error, onCancel, onConfirm }: {
  name: string; description: string; busy: boolean; error?: string | null; onCancel: () => void; onConfirm: () => void;
}) {
  const { t } = useI18n(), id = useId();
  const panel = useRef<HTMLDivElement>(null), state = useRef({ busy, onCancel });
  state.current = { busy, onCancel };
  useEffect(() => {
    const stopFocus = focusModalPanel(document, panel.current);
    const stopEscape = listenForStackedDialogEscape(document, () => { if (!state.current.busy) state.current.onCancel(); });
    return () => { stopEscape(); stopFocus(); };
  }, []);
  return createPortal(<div className="resource-remove-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div ref={panel} className="resource-remove-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} tabIndex={-1} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      if (!buttons.length) { event.preventDefault(); return; }
      if (!buttons.includes(document.activeElement as HTMLButtonElement) || event.shiftKey && document.activeElement === buttons[0] || !event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus(); }
    }}>
      <h2 id={`${id}-title`}>{t("resources.removeTitle")}</h2>
      <strong className="resource-remove-name">{name}</strong>
      <p id={`${id}-description`}>{description}</p>
      {error && <p role="alert" className="resource-install-error">{error}</p>}
      <footer><ConfigButton disabled={busy} onClick={onCancel}>{t("i18n.cancel")}</ConfigButton><ConfigButton variant="danger" disabled={busy} onClick={onConfirm}>{t(busy ? "i18n.removing" : "resources.confirm")}</ConfigButton></footer>
    </div>
  </div>, document.body);
}
