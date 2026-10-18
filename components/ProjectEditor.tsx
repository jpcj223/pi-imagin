"use client";
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
      if (!response.ok) throw new Error(data.error || "无法访问目录");
      if (!active.current) return;
      const key = (p: string) => /^[a-z]:|^[\\/]{2}/i.test(p) ? p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() : p.replace(/\/+$/, "");
      if (folders.some(f => key(f.path) === key(data.cwd))) throw new Error("此文件夹已经关联。");
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
      <header><div><h2 id="project-editor-title">{start ? "在项目中新建会话" : confirmRemove ? "移除项目" : project ? "编辑项目" : "创建项目"}</h2><p>{start ? project?.name : "统一组织文件夹与会话"}</p></div><button type="button" aria-label="关闭项目设置" disabled={busy} onClick={onClose}>×</button></header>
      <div className="project-editor-body">
        {confirmRemove ? <p>移除后文件与历史会话仍保留，已有会话的执行目录不会改变。</p> : start ? <>
          <label>本次会话工作目录<select aria-label="本次会话工作目录" value={startPath} onChange={event => setStartPath(event.target.value)}>{(project ? projectExecutionFolders(project) : folders).map(f => <option key={f.path} value={f.path}>{f.name}{f.path === defaultPath ? " · 默认" : ""}</option>)}</select></label>
          <p className="project-editor-hint">{startPath}</p><p className="project-editor-hint">此会话可处理项目中已关联的所有目录，命令执行时需明确工作位置。</p>
        </> : <>
          <label>项目名称<input ref={input} value={name} maxLength={80} disabled={busy} placeholder="例如：Pi Imagin" onChange={event => setName(event.target.value)} /></label>
          <div><div className="project-editor-label">关联文件夹<span>{folders.length} / 16</span></div>
            <div className="project-editor-folders">{folders.map(folder => <div className="project-editor-folder" key={folder.path}>
              <FolderIcon size={16} /><div><input aria-label={`文件夹名称：${folder.name}`} disabled={busy} value={folder.name} onChange={event => setFolders(previous => previous.map(f => f.path === folder.path ? { ...f, name: event.target.value } : f))} /><small>{folder.path}</small></div>
              <button type="button" disabled={busy} aria-pressed={defaultPath === folder.path} onClick={() => setDefaultPath(folder.path)}>{defaultPath === folder.path ? "默认" : "设为默认"}</button>
              {project && <button type="button" disabled={busy} aria-label={`浏览${folder.name}`} onClick={() => { onBrowse(folder.path);onClose(); }}>浏览</button>}
              <button type="button" disabled={busy} aria-label={`解除关联${folder.name}`} onClick={() => { setFolders(previous => previous.filter(f => f.path !== folder.path));if (defaultPath === folder.path) setDefaultPath(folders.find(f => f.path !== folder.path)?.path ?? ""); }}>×</button>
            </div>)}
            {!folders.length && <p className="project-editor-empty">可稍后添加文件夹，当前使用独立的项目工作区</p>}
            <button type="button" className="project-editor-add" disabled={busy || folders.length >= 16} onClick={() => void choose()}><PlusIcon size={14} />添加文件夹</button></div>
          </div>
          <details className="project-editor-recents"><summary>粘贴路径或使用最近目录</summary><div><input aria-label="文件夹路径" value={path} disabled={busy} placeholder="输入完整目录路径" onChange={event => setPath(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault();void add(path); } }} /><button type="button" disabled={busy || !path.trim()} onClick={() => void add(path)}>添加</button></div>{[...new Set(recentPaths)].slice(0,5).map(p => <button type="button" key={p} disabled={busy} onClick={() => void add(p)}>{p}</button>)}</details>
          <p className="project-editor-hint">新会话可以跨关联目录工作。已有会话保留原目录快照；命令进程按当前系统账户权限执行。</p>
        </>}
        {error && <p role="alert" className="project-editor-error">{error}</p>}
      </div>
      <footer>{project && !start && !confirmRemove && <button type="button" className="project-editor-remove" disabled={busy} onClick={() => setConfirmRemove(true)}>移除项目</button>}
        <button type="button" disabled={busy} onClick={() => confirmRemove ? setConfirmRemove(false) : onClose()}>取消</button>
        <button type="button" className="project-editor-primary" disabled={busy || (!confirmRemove && !start && !name.trim()) || (start && !startPath)} onClick={() => start ? (onStart(startPath), onClose()) : void save(confirmRemove)}>{busy ? "保存中…" : start ? "新建会话" : confirmRemove ? "确认移除" : project ? "保存" : "创建项目"}</button>
      </footer>
    </div>
    {picking && <DirectoryPicker busy={busy} error={error} initialPath={path || folders[0]?.path || recentPaths[0]} onCancel={() => { setPicking(false);setError(null); }} onSelect={candidate => void add(candidate)} />}
  </div>, document.body);
}
