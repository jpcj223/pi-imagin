"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { openStackedDialog } from "@/lib/stacked-dialog";
import { DEFAULT_MCP_CATALOGS, MCP_CATALOGS_STORAGE_KEY, readMcpCatalogs, validMcpCatalog, type McpCatalog } from "@/lib/mcp-catalogs";
import { ConfigButton } from "./SettingsUi";

const changeEvent = "pi-mcp-catalogs-change";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changeEvent, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(changeEvent, callback); };
}
function snapshot() {
  try { return localStorage.getItem(MCP_CATALOGS_STORAGE_KEY); } catch { return null; }
}

export function McpCatalogs() {
  const { t } = useI18n();
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const catalogs = useMemo(() => readMcpCatalogs(raw), [raw]);
  const [editing, setEditing] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  return <>
    <details className="mcp-add-catalogs" ref={menu}>
      <summary>{t("mcp.add.findServers")}</summary>
      <div>{catalogs.map((catalog, index) => <a key={index} href={catalog.href} target="_blank" rel="noopener noreferrer">{catalog.label}</a>)}
        <button type="button" className="mcp-catalog-manage" onClick={() => { setEditing(true); }}>{t("mcp.catalog.manage")}</button>
      </div>
    </details>
    {editing && <McpCatalogDialog catalogs={catalogs} onClose={() => setEditing(false)} onSave={value => {
      localStorage.setItem(MCP_CATALOGS_STORAGE_KEY, JSON.stringify(value));
      window.dispatchEvent(new Event(changeEvent));
      setEditing(false);
    }} />}
  </>;
}

function McpCatalogDialog({ catalogs, onClose, onSave }: {
  catalogs: readonly McpCatalog[]; onClose: () => void; onSave: (value: McpCatalog[]) => void;
}) {
  const { t } = useI18n(), id = useId();
  const [rows, setRows] = useState(() => catalogs.map(item => ({ ...item })));
  const [error, setError] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null), close = useRef(onClose);
  close.current = onClose;
  useEffect(() => openStackedDialog(document, panel.current, () => close.current()), []);
  const change = (index: number, patch: Partial<McpCatalog>) => {
    setRows(previous => previous.map((item, i) => i === index ? { ...item, ...patch } : item));
    setError(null);
  };
  return createPortal(<div className="resource-remove-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="resource-remove-dialog mcp-catalog-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)") ?? []);
      const first = items[0], last = items.at(-1);
      if (!panel.current?.contains(document.activeElement) || document.activeElement === panel.current || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    }}>
      <h2 id={`${id}-title`}>{t("mcp.catalog.manage")}</h2>
      <p>{t("mcp.catalog.hint")}</p>
      <form onSubmit={event => {
        event.preventDefault();
        if (rows.some(row => !validMcpCatalog(row))) { setError(t("mcp.catalog.invalid")); return; }
        try { onSave(rows.map(row => ({ label: row.label.trim(), href: row.href.trim() }))); }
        catch { setError(t("mcp.catalog.saveFailed")); }
      }}>
        <div className="mcp-catalog-edit-list">{rows.map((row, index) => <div className="mcp-catalog-edit-row" key={index}>
          <label>{t("config.name")}<input value={row.label} onChange={event => change(index, { label: event.target.value })} /></label>
          <label>{t("mcp.catalog.url")}<input type="url" value={row.href} placeholder="https://" onChange={event => change(index, { href: event.target.value })} /></label>
          <ConfigButton size="small" variant="ghost" aria-label={t("mcp.catalog.delete", { name: row.label || String(index + 1) })} onClick={() => { addButton.current?.focus({ preventScroll: true }); setRows(previous => previous.filter((_, i) => i !== index)); setError(null); }}>×</ConfigButton>
        </div>)}</div>
        <div className="mcp-catalog-edit-tools">
          <ConfigButton ref={addButton} onClick={() => setRows(previous => [...previous, { label: "", href: "" }])}>{t("mcp.catalog.add")}</ConfigButton>
          <ConfigButton variant="ghost" onClick={() => { setRows(DEFAULT_MCP_CATALOGS.map(item => ({ ...item }))); setError(null); }}>{t("mcp.catalog.reset")}</ConfigButton>
        </div>
        {error && <p className="resource-install-error" role="alert">{error}</p>}
        <footer><ConfigButton onClick={onClose}>{t("i18n.cancel")}</ConfigButton><ConfigButton type="submit" variant="primary">{t("i18n.save")}</ConfigButton></footer>
      </form>
    </div>
  </div>, document.body);
}
