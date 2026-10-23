"use client";
import { useI18n } from "@/hooks/useI18n";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { chooseDesktopDirectory } from "@/lib/desktop-bridge";
import { listenForStackedDialogEscape } from "@/lib/stacked-dialog";
import { defaultProjectFolder, projectExecutionFolders, type ManagedProject, type ManagedProjectState, type ProjectChange } from "@/lib/managed-projects-shared";
import { DirectoryPicker } from "./DirectoryPicker";
import { FolderIcon, PlusIcon } from "./SidebarIcons";

export function ProjectEditor({ project, initialPath, initialName, mode = "edit", recentPaths, onClose, onChange, onStart, onBrowse }: {
  project?: ManagedProject; initialPath?: string; initialName?: string; mode?: "edit" | "start"; recentPaths: string[];
  onClose: () => void;
  onChange: (request: ProjectChange) => Promise<ManagedProjectState>;
  onStart: (cwd: string) => void;
  onBrowse: (cwd: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(project?.name ?? initialName ?? (initialPath?.split(/[\\/]/).filter(Boolean).pop() || ""));
  const [folders, setFolders] = useState(project?.folders.map(f => ({ path: f.path, name: f.name })) ?? (initialPath ? [{ path: initialPath, name: initialPath.split(/[\\/]/).pop() || initialPath }] : []));
  const [defaultPath, setDefaultPath] = useState((project && defaultProjectFolder(project)?.path) ?? initialPath ?? "");
  const [startPath, setStartPath] = useState(defaultPath);
  const [picking, setPicking] = useState(false);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const busyRef = useRef(busy); busyRef.current = busy;
  useEffect(() => {
    active.current = true;
    const opener = document.activeElement;
    (input.current ?? dialog.current)?.focus({ preventScroll: true });
    return () => {
      active.current = false;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    // 子选择器自行处理 Esc；父级捕获监听会提前吞键并丢弃整个项目草稿。
    if (picking) return;
    return listenForStackedDialogEscape(document, () => { if (!busyRef.current) closeRef.current(); });
  }, [picking]);
  useEffect(() => {
    if (!picking && document.activeElement === document.body) dialog.current?.focus({ preventScroll: true });
  }, [busy, confirmRemove, picking]);
  const add = async (candidate: string) => {
    if (!active.current || !candidate.trim() || busy) return;
    setBusy(true);setError(null);
    try {
      const response = await fetch("/api/cwd/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: candidate.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("project.directoryUnavailable"));
      if (!active.current) return;
      const key = (p: string) => /^[a-z]:|^[\\/]{2}/i.test(p) ? p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() : p.replace(/\/+$/, "");
      if (folders.some(f => key(f.path) === key(data.cwd))) throw new Error(t("project.alreadyLinked"));
      const folderName = data.cwd.split(/[\\/]/).filter(Boolean).pop() || data.cwd;
      setFolders(previous => [...previous, { path: data.cwd, name: folderName }]);
      if (!folders.length || !defaultPath) { setDefaultPath(data.cwd);setStartPath(data.cwd); }
      if (!name.trim()) setName(folderName);
      setPicking(false);setPath("");
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (active.current) setBusy(false); }
  };
  const choose = async () => {
    setError(null);
    try { const candidate = await chooseDesktopDirectory(); if (candidate === undefined) setPicking(true); else if (candidate) await add(candidate); }
    catch (error) { setError(String(error)); }
  };
  const save = async (remove = false) => {
    if (busy) return;
    setBusy(true);setError(null);
    try {
      await onChange(remove && project ? { action: "remove", id: project.id, revision: project.revision }
        : { action: "save", ...(project ? { id: project.id, revision: project.revision } : {}), name, folders, defaultPath });
      if (active.current) onClose();
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (active.current) setBusy(false); }
  };
  const start = mode === "start";
  return createPortal(<div className="project-editor-backdrop" onKeyDownCapture={event => {
    // 输入法取消候选词的 Esc 由输入法保留，不触发子选择器取消。
    if (picking && event.key === "Escape" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.stopPropagation();
  }} onKeyDown={event => {
    // 子选择器已处理的 Esc 不再冒泡到全局“停止运行”快捷键。
    if (picking && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
  }}>
    <div className="project-editor" role="dialog" aria-modal="true" aria-labelledby="project-editor-title" tabIndex={-1} ref={dialog} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') ?? []).filter(el => el.getClientRects().length);
      if (!controls.includes(document.activeElement as HTMLElement) && controls.length) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus(); return; }
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }}>
      <header><div><h2 id="project-editor-title">{start ? t("project.startSession") : confirmRemove ? t("project.remove") : project ? t("project.edit") : t("project.create")}</h2><p>{start ? project?.name : t("project.description")}</p></div><button type="button" aria-label={t("project.close")} disabled={busy} onClick={onClose}>×</button></header>
      <div className="project-editor-body">
        {confirmRemove ? <p>{t("project.removeHint")}</p> : start ? <>
          <label>{t("project.sessionDirectory")}<select aria-label={t("project.sessionDirectory")} value={startPath} onChange={event => setStartPath(event.target.value)}>{(project ? projectExecutionFolders(project) : folders).map(f => <option key={f.path} value={f.path}>{project?.workspace?.path === f.path ? t("project.workspace") : f.name}{f.path === defaultPath ? ` · ${t("i18n.default")}` : ""}</option>)}</select></label>
          <p className="project-editor-hint">{startPath}</p><p className="project-editor-hint">{t("project.sessionScopeHint")}</p>
        </> : <>
          <label>{t("sidebar.projectName")}<input ref={input} value={name} maxLength={80} disabled={busy} placeholder={t("project.namePlaceholder")} onChange={event => setName(event.target.value)} /></label>
          <div><div className="project-editor-label">{t("project.linkedFolders")}<span>{folders.length} / 16</span></div>
            <div className="project-editor-folders">{folders.map(folder => <div className="project-editor-folder" key={folder.path}>
              <FolderIcon size={16} /><div><input aria-label={t("project.folderName", { name: folder.name })} disabled={busy} value={folder.name} onChange={event => setFolders(previous => previous.map(f => f.path === folder.path ? { ...f, name: event.target.value } : f))} /><small>{folder.path}</small></div>
              <button type="button" disabled={busy} aria-pressed={defaultPath === folder.path} onClick={() => setDefaultPath(folder.path)}>{defaultPath === folder.path ? t("i18n.default") : t("project.setDefault")}</button>
              {project && <button type="button" disabled={busy} aria-label={t("project.browseFolder", { name: folder.name })} onClick={() => { onBrowse(folder.path);onClose(); }}>{t("project.browse")}</button>}
              <button type="button" disabled={busy} aria-label={t("project.unlinkFolder", { name: folder.name })} onClick={() => { setFolders(previous => previous.filter(f => f.path !== folder.path));if (defaultPath === folder.path) setDefaultPath(folders.find(f => f.path !== folder.path)?.path ?? ""); }}>×</button>
            </div>)}
            {!folders.length && <p className="project-editor-empty">{t("project.noFolders")}</p>}
            <button type="button" className="project-editor-add" disabled={busy || folders.length >= 16} onClick={() => void choose()}><PlusIcon size={14} />{t("project.addFolder")}</button></div>
          </div>
          <details className="project-editor-recents"><summary>{t("project.recentPaths")}</summary><div><input aria-label={t("project.folderPath")} value={path} disabled={busy} placeholder={t("project.pathPlaceholder")} onChange={event => setPath(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault();void add(path); } }} /><button type="button" disabled={busy || !path.trim()} onClick={() => void add(path)}>{t("project.addPath")}</button></div>{[...new Set(recentPaths)].slice(0,5).map(p => <button type="button" key={p} disabled={busy} onClick={() => void add(p)}>{p}</button>)}</details>
          <p className="project-editor-hint">{t("project.scopeHint")}</p>
        </>}
        {error && <p role="alert" className="project-editor-error">{error}</p>}
      </div>
      <footer>{project && !start && !confirmRemove && <button type="button" className="project-editor-remove" disabled={busy} onClick={() => setConfirmRemove(true)}>{t("project.remove")}</button>}
        <button type="button" disabled={busy} onClick={() => confirmRemove ? setConfirmRemove(false) : onClose()}>{t("sidebar.cancel")}</button>
        <button type="button" className="project-editor-primary" disabled={busy || (!confirmRemove && !start && !name.trim()) || (start && !startPath)} onClick={() => start ? (onStart(startPath), onClose()) : void save(confirmRemove)}>{busy ? t("i18n.saving") : start ? t("i18n.newSession") : confirmRemove ? t("project.confirmRemove") : project ? t("i18n.save") : t("project.create")}</button>
      </footer>
    </div>
    {picking && <DirectoryPicker busy={busy} error={error} initialPath={path || folders[0]?.path || recentPaths[0]} onCancel={() => { setPicking(false);setError(null); }} onSelect={candidate => void add(candidate)} />}
  </div>, document.body);
}
