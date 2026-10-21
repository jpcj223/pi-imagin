"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { adoptDiskFileDraft, changeFileDraft, fileDraftDirty, getFileEditDraft, isFileEditLocked, refreshFileDraft, rememberFileCursor, saveComparedFileDraft, saveFileDraft, selectedFileLines, subscribeFileDraft } from "@/lib/file-edit-drafts";
import { simpleCodeTokens } from "@/lib/simple-code-highlight";

export default function FileTextEditor({ path, wrap, fallback, onSelectedLines }: { path: string; wrap: boolean; fallback: ReactNode; onSelectedLines: (range: { startLine: number; endLine: number } | null) => void }) {
  const draft = useSyncExternalStore(subscribeFileDraft, () => getFileEditDraft(path), () => null);
  const locked = useSyncExternalStore(subscribeFileDraft, () => isFileEditLocked(path), () => false);
  const [reason, setReason] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [comparison, setComparison] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), code = useRef<HTMLPreElement>(null), gutter = useRef<HTMLDivElement>(null);
  const live = useRef({ path, refresh: () => {} });
  const text = draft?.text ?? "";
  const hasDraft = Boolean(draft);
  const tokens = useMemo(() => simpleCodeTokens(text, !/\.(txt|log)$/i.test(path)), [text, path]);
  useEffect(() => {
    let active = true;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      void refreshFileDraft(path).then(snapshot => {
        if (!snapshot) return;
        if (active) { setLoaded(true); setReason(snapshot.editable ? null : `只读：${snapshot.reason ?? "该文件仅支持查看。"}`); }
      }).catch(error => {
        if (active) { setLoaded(true); setReason(error.message); }
      }).finally(() => { pending = false; });
    };
    live.current = { path, refresh };
    refresh();
    window.addEventListener("focus", refresh);
    const saved = (event: Event) => { if ((event as CustomEvent).detail?.path === path) refresh(); };
    window.addEventListener("pi-imagin:file-saved", saved);
    // 沿用文件查看器的按需监听，不另开轮询或第二条文件监听连接。
    window.addEventListener("pi-imagin:file-observed", saved);
    return () => { active = false; window.removeEventListener("focus", refresh); window.removeEventListener("pi-imagin:file-saved", saved); window.removeEventListener("pi-imagin:file-observed", saved); };
  }, [path]);
  const syncScroll = () => {
    const el = input.current; if (!el) return;
    if (code.current) code.current.style.transform = `translate(${-el.scrollLeft}px,${-el.scrollTop}px)`;
    if (gutter.current) gutter.current.style.transform = `translateY(${-el.scrollTop}px)`;
    rememberFileCursor(path, { selectionStart: el.selectionStart, selectionEnd: el.selectionEnd, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft });
  };
  useLayoutEffect(() => {
    const el = input.current, state = getFileEditDraft(path); if (!el || !state) return;
    el.setSelectionRange(state.selectionStart ?? 0, state.selectionEnd ?? 0);
    el.scrollTop = state.scrollTop ?? 0; el.scrollLeft = state.scrollLeft ?? 0;
    if (code.current) code.current.style.transform = `translate(${-el.scrollLeft}px,${-el.scrollTop}px)`;
    if (gutter.current) gutter.current.style.transform = `translateY(${-el.scrollTop}px)`;
  }, [path, hasDraft]);
  useEffect(() => {
    const el = input.current, pre = code.current;
    if (!el || !pre) return;
    const resize = () => { if (wrap) pre.style.width = `${el.clientWidth}px`; else pre.style.width = "max-content"; };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    return () => observer.disconnect();
  }, [hasDraft, wrap]);
  if (!draft || (reason && !fileDraftDirty(draft))) return <>{reason && <div className="file-edit-status" role="status">{reason}</div>}{!loaded && <div className="file-edit-status">正在准备文本编辑器…</div>}{fallback}</>;
  return <div className={`file-text-editor${wrap ? " is-wrapped" : ""}`}>
    {(draft.error || draft.conflict || reason) && <div className="file-edit-status is-error" role="alert">
      <span>{draft.error ?? (draft.conflict ? "磁盘文件已变化，当前修改已保留。请比较后处理冲突。" : reason)}</span>
      <button type="button" onClick={() => live.current.refresh()}>重新检查</button>
      {draft.conflict && <><button type="button" onClick={() => setComparison(value => !value)} aria-expanded={comparison}>比较磁盘版本</button><button type="button" disabled={draft.saving} onClick={() => { if (window.confirm("放弃当前未保存修改，使用磁盘版本？")) adoptDiskFileDraft(path); }}>使用磁盘版本</button>{comparison && <button type="button" disabled={draft.saving} onClick={() => { if (window.confirm("确认已比较并处理差异？当前编辑内容将替换已显示的磁盘版本，之后发生的新修改仍会阻止保存。")) void saveComparedFileDraft(path); }}>保存当前合并内容</button>}</>}
    </div>}
    {comparison && draft.conflict && <div className="file-edit-comparison"><div><strong>当前修改</strong><pre>{text.slice(0, 20000)}</pre></div><div><strong>磁盘版本</strong><pre>{draft.conflict.text?.slice(0, 20000)}</pre></div><small>对比最多展示每侧 20,000 字符；完整编辑内容仍保留。</small></div>}
    <div className="file-editor-surface">
      {!wrap && <div className="file-editor-gutter" aria-hidden="true"><div ref={gutter}>{text.split("\n").map((_, index) => <div key={index}>{index + 1}</div>)}</div></div>}
      <div className="file-editor-overlay" aria-hidden="true"><pre ref={code}>{tokens.map((token, index) => <span className={`file-code-${token.kind}`} key={index}>{token.text}</span>)}{"\n"}</pre></div>
      <textarea ref={input} data-file-editor spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label={`文件编辑器 ${path.replaceAll("\\", "/").split("/").at(-1)}`} value={text} wrap={wrap ? "soft" : "off"}
        readOnly={locked} aria-busy={locked}
        onChange={event => changeFileDraft(path, event.currentTarget.value)} onScroll={syncScroll}
        onSelect={event => {
          syncScroll(); const el = event.currentTarget;
          onSelectedLines(selectedFileLines(el.value, el.selectionStart, el.selectionEnd));
        }}
        onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void saveFileDraft(path); }
          else if (event.key === "Tab" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (locked) return;
            if (!document.execCommand("insertText", false, "  ")) {
              const el = event.currentTarget; el.setRangeText("  ", el.selectionStart, el.selectionEnd, "end"); changeFileDraft(path, el.value);
            }
          }
        }} />
    </div>
    <footer className="file-editor-statusbar" aria-label="文件编辑状态">
      <span>{locked ? "正在处理文件操作，暂时只读" : "可直接编辑"}</span><span role="status">{draft.saving ? "正在保存…" : fileDraftDirty(draft) ? "未保存 · Ctrl+S 保存" : "已保存"}</span>
    </footer>
  </div>;
}
