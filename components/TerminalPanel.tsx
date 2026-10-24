"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TerminalSearchAddon as SearchAddon, type TerminalSearchOptions as ISearchOptions } from "@/lib/terminal-search-addon";
import { terminalTheme, terminalSearchColors } from "@/lib/terminal-theme";
import { TerminalToolbar } from "./TerminalToolbar";
import { TerminalIcon } from "./TerminalIcon";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useI18n } from "@/hooks/useI18n";
import { subscribeFontPreferences } from "@/hooks/useFontPreferences";
import { readFontWeight } from "@/lib/font-preferences";
import { createTerminalWriter, terminalRequest } from "@/lib/terminal-client";
import {
  applyTerminalModifiers,
  NO_TERMINAL_MODIFIERS,
  terminalExtraKeySequence,
  type TerminalExtraKey,
  type TerminalModifier,
  type TerminalModifiers,
} from "@/lib/terminal-extra-keys";
import type { TerminalEvent } from "@/lib/terminal-manager";
import { TerminalExtraKeys, useTerminalExtraKeysVisible } from "./TerminalExtraKeys";
import type { TerminalTab } from "./terminal-tab-state";

interface Props {
  tab: TerminalTab;
  active: boolean;
  onRestart: (shell?: string) => void;
  onClosed: () => void;
  onCloseError: () => void;
  toolbarHost?: HTMLElement | null;
  onNew?: (shell: string) => void;
  onDuplicate: (cwd: string, shell?: string) => void;
  layoutKey?: string;
}

export function TerminalPanel({ tab, active, onRestart, onClosed, onCloseError, toolbarHost, onNew, onDuplicate, layoutKey }: Props) {
  const { t } = useI18n();
  const { id, cwd, restored } = tab;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const startRef = useRef<Promise<void>>(Promise.resolve());
  const writerRef = useRef<ReturnType<typeof createTerminalWriter> | null>(null);
  const callbacksRef = useRef({ onClosed, onCloseError });
  callbacksRef.current = { onClosed, onCloseError };
  const [status, setStatus] = useState<"connecting" | "ready" | "exited" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [shellLabel, setShellLabel] = useState("");
  const [shells, setShells] = useState<{ id: string; label: string }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchOptions, setSearchOptions] = useState<ISearchOptions>({});
  const [results, setResults] = useState({ resultIndex: -1, resultCount: 0 });
  const [regexInvalid, setRegexInvalid] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [preferredShell, setPreferredShell] = useState<string | undefined>();
  const [resolvedShellId, setResolvedShellId] = useState<string | undefined>(tab.shell);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchStateRef = useRef({ open: searchOpen, query, options: searchOptions });
  searchStateRef.current = { open: searchOpen, query, options: searchOptions };
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshShells = useCallback(async (signal?: AbortSignal) => {
    const value = await terminalRequest<{ shells: { id: string; label: string }[]; defaultShell?: string }>("/api/terminal", { signal });
    setShells(value.shells);
    let preferred = value.defaultShell;
    try { const saved = localStorage.getItem("pi-terminal-shell"); if (value.shells.some(shell => shell.id === saved)) preferred = saved!; } catch {}
    setPreferredShell(preferred);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refreshShells(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [refreshShells]);
  useEffect(() => {
    const sync = () => {
      try { const saved = localStorage.getItem("pi-terminal-shell"); if (shells.some(shell => shell.id === saved)) setPreferredShell(saved!); } catch {}
    };
    if (active) sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [active, shells]);
  const applySearch = useCallback((direction: "refresh" | "next" | "previous" = "refresh") => {
    const addon = searchAddonRef.current;
    const state = searchStateRef.current;
    if (!addon) return;
    if (!state.open || !state.query) {
      addon.clearDecorations(); terminalRef.current?.clearSelection(); setRegexInvalid(false); setResults({ resultIndex: -1, resultCount: 0 }); return;
    }
    try {
      if (state.options.regex) new RegExp(state.query, state.options.caseSensitive ? "g" : "gi");
    } catch {
      addon.clearDecorations(); terminalRef.current?.clearSelection(); setRegexInvalid(true); setResults({ resultIndex: -1, resultCount: 0 }); return;
    }
    setRegexInvalid(false);
    // 匹配选项、主题或查询变化后统一重算高亮与计数。
    if (direction === "refresh") addon.clearDecorations();
    const options = { ...state.options, incremental: direction === "refresh", decorations: terminalSearchColors(document.documentElement.dataset.theme) };
    if (direction === "previous") addon.findPrevious(state.query, options);
    else addon.findNext(state.query, options);
  }, []);
  useEffect(() => {
    searchTimer.current = setTimeout(() => { searchTimer.current = null; applySearch(); }, 100);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchOpen, query, searchOptions, status, applySearch]);
  useEffect(() => { if (searchOpen && active) searchRef.current?.focus(); }, [searchOpen, active]);
  const navigateSearch = (backward = false) => {
    if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null; }
    applySearch(backward ? "previous" : "next");
  };
  const closeSearch = () => { setSearchOpen(false); searchStateRef.current.open = false; applySearch(); terminalRef.current?.focus(); };
  const duplicate = async () => {
    if (duplicating || tab.closing) return;
    setDuplicating(true);
    try {
      const info = await terminalRequest<{ shellId?: string; currentCwd?: string }>(`/api/terminal/${encodeURIComponent(id)}`);
      onDuplicate(info.currentCwd ?? cwd, info.shellId ?? resolvedShellId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDuplicating(false); }
  };
  const [modifiers, setModifiers] = useState<TerminalModifiers>(NO_TERMINAL_MODIFIERS);
  const modifiersRef = useRef(modifiers);
  const showExtraKeys = useTerminalExtraKeysVisible();

  const consumeModifiers = useCallback(() => {
    const current = modifiersRef.current;
    if (current.ctrl || current.alt) {
      modifiersRef.current = NO_TERMINAL_MODIFIERS;
      setModifiers(NO_TERMINAL_MODIFIERS);
    }
    return current;
  }, []);
  const sendExtraKey = (key: TerminalExtraKey) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const sequence = terminalExtraKeySequence(key, consumeModifiers(), terminal.modes.applicationCursorKeysMode);
    terminal.input(sequence, true);
  };
  const toggleModifier = (modifier: TerminalModifier) => {
    const next = { ...modifiersRef.current, [modifier]: !modifiersRef.current[modifier] };
    modifiersRef.current = next;
    setModifiers(next);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let events: EventSource | null = null;
    let offset: number | undefined;
    let connected = false;
    let exited = false;
    let inputFailed = false;
    setStatus("connecting");
    setError(null);
    setExitCode(null);

    const readTerminalFont = () => {
      const style = getComputedStyle(container);
      return {
        fontFamily: style.getPropertyValue("--font-mono").trim() || "monospace",
        // Base weights stop at 600, so xterm's default bold (700) stays heavier.
        fontWeight: readFontWeight(style.getPropertyValue("--font-mono-weight")),
      };
    };
    // 使用实际主题变量，切换外观只更新终端颜色，不重启终端进程。
    const readTerminalTheme = () => terminalTheme(document.documentElement.dataset.theme);
    const terminal = new Terminal({
      cursorBlink: true,
      allowProposedApi: true,
      minimumContrastRatio: 4.5,
      ...readTerminalFont(),
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 8000,
      screenReaderMode: true,
      disableStdin: true,
      theme: readTerminalTheme(),
    });
    terminalRef.current = terminal;
    const themeObserver = new MutationObserver(() => { terminal.options.theme = readTerminalTheme(); searchAddonRef.current?.clearDecorations(); applySearch(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    const searchAddon = new SearchAddon({ highlightLimit: 10000 });
    terminal.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;
    const searchResults = searchAddon.onDidChangeResults(setResults);
    applySearch();
    // 字体加载后的真实字宽可能不同于回退字体，重新测量避免终端字距被拉开。
    const refreshLoadedFont = () => {
      if (disposed) return;
      terminal.options.fontFamily = "monospace";
      terminal.options.fontFamily = readTerminalFont().fontFamily;
      fit.fit();
    };
    void document.fonts.ready.then(refreshLoadedFont);
    document.fonts.addEventListener("loadingdone", refreshLoadedFont);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "f") { event.preventDefault(); setSearchOpen(true); return false; }
      if ((event.ctrlKey || event.metaKey) && key === "v") return false;
      if ((event.ctrlKey || event.metaKey) && key === "c" && terminal.hasSelection()) return false;
      return true;
    });

    const writer = createTerminalWriter(id, (reason) => {
      if (disposed) return;
      inputFailed = true;
      terminal.options.disableStdin = true;
      setError(reason.message);
      setStatus("error");
    });
    writerRef.current = writer;
    const onData = terminal.onData((data) => {
      if (connected && !exited && !inputFailed) writer.write(applyTerminalModifiers(data, consumeModifiers()));
    });
    const fitAndResize = () => {
      if (!container.offsetWidth || !container.offsetHeight) return;
      fit.fit();
    };
    const onResize = terminal.onResize(({ cols, rows }) => {
      if (!connected || exited || inputFailed) return;
      writer.resize(Math.max(2, cols), Math.max(2, rows));
    });
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(container);
    const updateFont = () => {
      if (disposed) return;
      const font = readTerminalFont();
      terminal.options.fontFamily = font.fontFamily;
      terminal.options.fontWeight = font.fontWeight;
      fitAndResize();
    };
    const unsubscribeFonts = subscribeFontPreferences(updateFont);

    const connect = () => {
      if (disposed || exited || !navigator.onLine) return;
      events?.close();
      events = new EventSource(`/api/terminal/${encodeURIComponent(id)}/events${offset === undefined ? "" : `?after=${offset}`}`);
      events.onmessage = (message) => {
        const event = JSON.parse(message.data) as TerminalEvent;
        if (event.type === "output") {
          if (event.reset) terminal.reset();
          else if (offset !== undefined && event.offset <= offset) return;
          terminal.write(event.data);
          offset = event.offset;
        } else {
          exited = true;
          connected = false;
          terminal.options.disableStdin = true;
          events?.close();
          setExitCode(event.type === "exit" ? event.exitCode : null);
          setStatus("exited");
        }
      };
      events.onopen = () => {
        connected = true;
        if (inputFailed) return;
        terminal.options.disableStdin = false;
        setStatus("ready");
        fitAndResize();
        writer.resize(Math.max(2, terminal.cols), Math.max(2, terminal.rows));
        if (container.offsetWidth && container.offsetHeight) terminal.focus();
      };
      events.onerror = () => {
        if (disposed || exited) return;
        connected = false;
        terminal.options.disableStdin = true;
        setStatus(events?.readyState === EventSource.CLOSED ? "error" : "connecting");
      };
    };

    startRef.current = (async () => {
      fitAndResize();
      if (restored || reconnectKey > 0) {
        // Restoring a tab must never silently launch a replacement shell.
        const info = await terminalRequest<{ shell?: string; shellId?: string }>(`/api/terminal/${encodeURIComponent(id)}`);
        if (!disposed) { setShellLabel(info.shell ?? "Shell"); setResolvedShellId(info.shellId ?? tab.shell); }
      } else {
        const info = await terminalRequest<{ shell?: string; shellId?: string }>("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, cwd, shell: tab.shell, cols: terminal.cols, rows: terminal.rows }),
        });
        if (!disposed) { setShellLabel(info.shell ?? "Shell"); setResolvedShellId(info.shellId ?? tab.shell); }
      }
      connect();
    })().catch((reason: Error) => {
      if (disposed) return;
      setError(reason.message);
      setStatus("error");
    });

    const pageHide = () => {
      connected = false;
      terminal.options.disableStdin = true;
      events?.close();
      if (!exited && !inputFailed) setStatus("connecting");
    };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) connect(); };
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("offline", pageHide);
    window.addEventListener("online", connect);
    return () => {
      disposed = true;
      events?.close();
      void writer.stop();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      document.fonts.removeEventListener("loadingdone", refreshLoadedFont);
      unsubscribeFonts();
      onData.dispose();
      onResize.dispose();
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("offline", pageHide);
      window.removeEventListener("online", connect);
      searchResults.dispose();
      searchAddonRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [id, cwd, restored, tab.shell, reconnectKey, consumeModifiers, applySearch]);

  useEffect(() => {
    if (active) terminalRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (!tab.closing) return;
    let cancelled = false;
    if (terminalRef.current) terminalRef.current.options.disableStdin = true;
    void (async () => {
      await startRef.current;
      await writerRef.current?.stop();
      await terminalRequest(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
      if (!cancelled) callbacksRef.current.onClosed();
    })().catch((reason: Error) => {
      if (cancelled) return;
      setError(reason.message);
      setStatus("error");
      callbacksRef.current.onCloseError();
    });
    return () => { cancelled = true; };
  }, [id, tab.closing]);

  const controls = <TerminalToolbar status={status} shellLabel={shellLabel} cwd={cwd} shells={shells} preferredShell={preferredShell} layoutKey={layoutKey}
    onRefreshShells={refreshShells}
    disabled={Boolean(tab.closing) || duplicating} onNew={onNew ? shell => { try { localStorage.setItem("pi-terminal-shell", shell); } catch {} setPreferredShell(shell); onNew(shell); } : undefined}
    onSearch={() => { if (searchOpen) closeSearch(); else setSearchOpen(true); }} onClear={() => { terminalRef.current?.clear(); applySearch(); terminalRef.current?.focus(); }}
    onDuplicate={() => void duplicate()} onRestart={() => onRestart(resolvedShellId)} onReconnect={() => setReconnectKey(key => key + 1)} />;
  return (
    <section className={`terminal-panel${onNew ? " is-docked" : ""}`} aria-label={t("terminal.title")}>
      {toolbarHost ? active && createPortal(controls, toolbarHost) : !onNew && <header className="terminal-panel-header">{controls}</header>}
      {searchOpen && <div className="terminal-search" role="search" aria-label={t("terminal.search")}>
        <div className={`terminal-search-field${regexInvalid ? " is-invalid" : ""}`}>
          <input ref={searchRef} aria-label={t("terminal.search")} placeholder={t("terminal.search")} value={query} maxLength={1024} aria-invalid={regexInvalid} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (["Enter", "ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); navigateSearch(event.shiftKey || event.key === "ArrowUp"); }
            if (event.key === "Escape") { event.stopPropagation(); closeSearch(); }
          }} />
          {([['caseSensitive', 'Aa', 'caseSensitive'], ['wholeWord', 'ab', 'wholeWord'], ['regex', '.*', 'regex']] as const).map(([key, label, text]) => <button type="button" key={key} className={`terminal-search-option is-${key}`} aria-label={t(`terminal.${text}`)} title={t(`terminal.${text}`)} aria-pressed={Boolean(searchOptions[key])} onClick={() => setSearchOptions(options => ({ ...options, [key]: !options[key] }))}>{label}</button>)}
        </div>
        <span className="terminal-search-count" role="status" aria-live="polite">{regexInvalid ? t("terminal.invalidRegex") : !query ? "" : results.resultCount >= 10000 ? "10000+" : `${results.resultIndex + 1}/${results.resultCount}`}</span>
        <div className="terminal-search-navigation">
          <button type="button" disabled={regexInvalid || !results.resultCount} aria-label={t("terminal.previousMatch")} title={t("terminal.previousMatch")} onClick={() => navigateSearch(true)}><TerminalIcon name="up" /></button>
          <button type="button" disabled={regexInvalid || !results.resultCount} aria-label={t("terminal.nextMatch")} title={t("terminal.nextMatch")} onClick={() => navigateSearch()}><TerminalIcon name="down" /></button>
          <button type="button" aria-label={t("i18n.close")} title={t("i18n.close")} onClick={closeSearch}><TerminalIcon name="close" /></button>
        </div>
      </div>}
      <div>
        {error && <div className="terminal-panel-error" role="alert">{error}</div>}
        {status === "exited" && <div className="terminal-panel-exit" role="status">{exitCode === null ? t("terminal.exited") : t("terminal.exitCode", { code: exitCode })}</div>}
      </div>
      <div className="terminal-xterm"><div ref={containerRef} className="terminal-xterm-host" /></div>
      {showExtraKeys && <TerminalExtraKeys modifiers={modifiers} onKey={sendExtraKey} onToggleModifier={toggleModifier} />}
    </section>
  );
}
