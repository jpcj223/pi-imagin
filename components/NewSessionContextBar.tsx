"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { NewSessionContext, NewSessionTarget, ProjectChoice } from "@/lib/new-session-context";
import { focusIfLost } from "@/lib/stacked-dialog";
import { ProjectWorktreePicker, type ProjectWorktreeControl, type ProjectWorktreePickerHandle } from "./ProjectWorktreePicker";
import { NewSessionProjectPicker, type NewSessionProjectPickerHandle } from "./NewSessionProjectPicker";

/** 记录项目、执行目录或工作树入口，切换后恢复到对应控件的焦点。 */
export type NewSessionContextControl = ProjectWorktreeControl | "directory";

interface Props {
  context: NewSessionContext;
  /** A phone: the menus open as bottom sheets. */
  mobile: boolean;
  /** The control the move that mounted this bar came from: it takes focus once, if focus fell to the page. */
  initialFocus: NewSessionContextControl | null;
  onInitialFocusDone: () => void;
  /** Start the fresh composer over in `target`; the shell ignores a move to where it already is. */
  onPick: (target: NewSessionTarget, from: NewSessionContextControl) => void;
  /** "Use default directory": today's folder, which goes to `onPick`. */
  onUseDefaultDirectory: () => void;
  /** 统一项目弹窗保存后再关联目录，取消不改变当前会话。 */
  onAddProject: (opener: HTMLElement | null) => void;
  onRefreshWorktrees: () => void;
  onCreateWorktree: (project: ProjectChoice, branch: string) => Promise<{ path: string } | { error: string }>;
}

// The home folder the paths (the menus', a detached checkout's in the
// worktree button) show as ~, asked for once per page: the bar mounts again
// with every move of the fresh composer.
let homeDirCheck: Promise<string> | null = null;
let homeDirFound = "";
function loadHomeDir(): Promise<string> {
  homeDirCheck ??= fetch("/api/home")
    .then((response) => response.json())
    .then((data: { home?: string }) => {
      homeDirFound = data.home ?? "";
      return homeDirFound;
    })
    .catch(() => {
      homeDirCheck = null;
      return "";
    });
  return homeDirCheck;
}

/** 输入框下方分别提供项目、执行目录及工作树入口，切换时携带草稿与模型选择。 */
export function NewSessionContextBar({
  context,
  mobile,
  initialFocus,
  onInitialFocusDone,
  onPick,
  onUseDefaultDirectory,
  onAddProject,
  onRefreshWorktrees,
  onCreateWorktree,
}: Props) {
  const { t } = useI18n();
  const [homeDir, setHomeDir] = useState(() => homeDirFound);
  const pickerRef = useRef<ProjectWorktreePickerHandle>(null);
  const projectPickerRef = useRef<NewSessionProjectPickerHandle>(null);
  const initialFocusRef = useRef(initialFocus);
  const onInitialFocusDoneRef = useRef(onInitialFocusDone);
  onInitialFocusDoneRef.current = onInitialFocusDone;

  useEffect(() => {
    if (homeDirFound) return;
    let cancelled = false;
    void loadHomeDir().then((home) => {
      if (!cancelled && home) setHomeDir(home);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The control that moved the composer went away with it: its counterpart
  // here takes focus, so a keyboard user goes on from where they were.
  useEffect(() => {
    const from = initialFocusRef.current;
    if (!from) return;
    initialFocusRef.current = null;
    onInitialFocusDoneRef.current();
    const picker = pickerRef.current;
    focusIfLost(document, (from === "worktree" ? picker?.button("worktree") : projectPickerRef.current?.button(from)) ?? projectPickerRef.current?.button("project") ?? null);
  }, []);

  return (
    <div className="new-session-context">
      <NewSessionProjectPicker context={context} mobile={mobile} handleRef={projectPickerRef} onPick={onPick}
        onClear={onUseDefaultDirectory} onAdd={onAddProject} />
      {context.worktrees && context.worktrees.length > 0 && <ProjectWorktreePicker
        handleRef={pickerRef}
        layout="inline"
        hideProject
        context={context}
        projectLabel={context.defaultWorkspace ? t("sidebar.selectProject") : undefined}
        mobile={mobile}
        label={t("workspace.newSessionContext")}
        homeDir={homeDir}
        newWorktreeTitle={t("sidebar.newWorktreeForSession")}
        onPick={onPick}
        onUseDefaultDirectory={onUseDefaultDirectory}
        onOpenFolder={onAddProject}
        onRefreshWorktrees={onRefreshWorktrees}
        onCreateWorktree={onCreateWorktree}
      />}
    </div>
  );
}
