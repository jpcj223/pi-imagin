"use client";
import { useI18n } from "@/hooks/useI18n";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { DEFAULT_SECTION_SHARE, loadSidebarSections, saveSidebarSections, sidebarSectionLayout, type SidebarSectionPreferences } from "@/lib/sidebar-sections";

type Section = "default" | "archive";
interface Props { projects: ReactNode; defaultSessions?: ReactNode; archive?: ReactNode; archiveOpen: boolean; isMobile: boolean }
interface Drag { target: HTMLDivElement; id: number; section: Section; y: number; start: number; height: number; min: number; max: number; cursor: string; select: string; moved: boolean }

/** 分区只管理显示尺寸，列表、会话选择和排序仍由原侧栏持有。 */
export function SidebarSessionSections({ projects, defaultSessions, archive, archiveOpen, isMobile }: Props) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [prefs, setPrefs] = useState<SidebarSectionPreferences>({ defaultShare: DEFAULT_SECTION_SHARE, archiveShare: DEFAULT_SECTION_SHARE, archiveOpen: false });
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const drag = useRef<Drag | null>(null);
  const [resizing, setResizing] = useState<Section | null>(null);
  const hasDefault = defaultSessions != null, hasArchive = archive != null;
  const layout = sidebarSectionLayout(height, hasDefault, hasArchive, archiveOpen, prefs);

  useLayoutEffect(() => { setPrefs(loadSidebarSections()); }, []);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const finish = useCallback((persist: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    document.body.style.cursor = current.cursor;
    document.body.style.userSelect = current.select;
    if (current.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
    setResizing(null);
    if (persist && current.moved) {
      saveSidebarSections({ [`${current.section}Share`]: prefsRef.current[`${current.section}Share`] });
    }
  }, []);
  useEffect(() => {
    const stop = () => finish(true);
    const visibility = () => { if (document.visibilityState !== "visible") stop(); };
    window.addEventListener("blur", stop); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("blur", stop); document.removeEventListener("visibilitychange", visibility); finish(false); };
  }, [finish]);
  useLayoutEffect(() => { finish(true); }, [archiveOpen, hasArchive, hasDefault, isMobile, height, finish]);

  const update = (section: Section, pixels: number, persist: boolean) => {
    if (layout.available <= 0) return;
    const min = section === "default" ? layout.defaultMin : layout.archiveMin;
    const max = section === "default" ? layout.defaultMax : layout.archiveMax;
    const share = Math.max(min, Math.min(pixels, max)) / layout.available;
    const next = { ...prefsRef.current, [`${section}Share`]: share };
    prefsRef.current = next; setPrefs(next);
    if (persist) saveSidebarSections({ [`${section}Share`]: share });
  };
  const reset = (section: Section) => {
    const next = { ...prefsRef.current, [`${section}Share`]: DEFAULT_SECTION_SHARE };
    prefsRef.current = next; setPrefs(next); saveSidebarSections({ [`${section}Share`]: DEFAULT_SECTION_SHARE });
  };
  const separator = (section: Section, active: boolean) => {
    const label = section === "default" ? t("sidebar.resizeDefault") : t("sidebar.resizeArchive");
    const min = section === "default" ? layout.defaultMin : layout.archiveMin;
    const max = section === "default" ? layout.defaultMax : layout.archiveMax;
    const value = layout[section];
    const interactive = active && !isMobile;
    return <div className={`workspace-section-divider${interactive ? " is-adjustable" : ""}${resizing === section ? " is-resizing" : ""}`}
      data-section-divider={section} role={interactive ? "separator" : undefined} aria-hidden={!interactive || undefined}
      aria-label={interactive ? label : undefined} aria-orientation={interactive ? "horizontal" : undefined}
      aria-controls={interactive ? `workspace-${section}-section` : undefined}
      aria-valuemin={interactive ? Math.round(min) : undefined} aria-valuemax={interactive ? Math.round(max) : undefined}
      aria-valuenow={interactive ? Math.round(value) : undefined} tabIndex={interactive ? 0 : undefined}
      title={interactive ? t("sidebar.resizeSectionHint", { label }) : undefined}
      onDoubleClick={interactive ? () => reset(section) : undefined}
      onKeyDown={interactive ? (event: KeyboardEvent<HTMLDivElement>) => {
        if (["ArrowUp", "ArrowDown", "Home", "End", "Enter"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Enter") reset(section);
          else update(section, event.key === "Home" ? min : event.key === "End" ? max
            : value + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 32 : 12), true);
        }
      } : undefined}
      onPointerDown={interactive ? (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || layout.available <= 0) return;
        event.preventDefault(); event.stopPropagation(); finish(true);
        const target = event.currentTarget; target.focus({ preventScroll: true }); target.setPointerCapture(event.pointerId);
        drag.current = { target, id: event.pointerId, section, y: event.clientY, start: value, height: layout.available, min, max,
          cursor: document.body.style.cursor, select: document.body.style.userSelect, moved: false };
        document.body.style.cursor = "row-resize"; document.body.style.userSelect = "none"; setResizing(section);
      } : undefined}
      onPointerMove={interactive ? (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        if (event.pointerType === "mouse" && event.buttons === 0) { finish(true); return; }
        event.preventDefault();
        const share = Math.max(current.min, Math.min(current.start + current.y - event.clientY, current.max)) / current.height;
        if (Math.abs(share * current.height - current.start) > 0.5) current.moved = true;
        const next = { ...prefsRef.current, [`${current.section}Share`]: share }; prefsRef.current = next; setPrefs(next);
      } : undefined}
      onPointerUp={interactive ? () => finish(true) : undefined}
      onPointerCancel={interactive ? () => finish(true) : undefined}
      onLostPointerCapture={interactive ? () => finish(true) : undefined} />;
  };

  return <div ref={root} className={`sidebar-sessions-view workspace-session-sections${isMobile ? " is-mobile" : ""}`}>
    <div className="workspace-project-tree" style={height ? { height: layout.project, flex: "0 0 auto" } : undefined}>{projects}</div>
    {hasDefault && <>{separator("default", true)}<section id="workspace-default-section" className="workspace-default-sessions" aria-label={t("sidebar.defaultGroup")} style={height ? { height: layout.default } : undefined}>{defaultSessions}</section></>}
    {hasArchive && <>{separator("archive", archiveOpen)}<section id="workspace-archive-section" className={`workspace-archive-section${archiveOpen ? " is-open" : ""}`} aria-label={t("sidebar.archivedSessions")} style={height ? { height: layout.archive } : undefined}>{archive}</section></>}
  </div>;
}
