import type { FileViewerState } from "@/lib/file-viewer-state";
import type { Tab } from "./TabBar";
import type { FileMutation } from "../lib/file-mutation";

/** 文件夹操作同步子文件标签；Windows 路径按大小写不敏感比较。 */
function mutatedFilePath(filePath: string, mutation: FileMutation): string | null {
  if (mutation.action === "restore") return filePath;
  const windows = /^[a-zA-Z]:[\\/]/.test(mutation.path) || mutation.path.startsWith("\\\\");
  const normalize = (value: string) => {
    const slashes = windows ? value.replace(/\\/g, "/") : value;
    return windows ? slashes.toLowerCase() : slashes;
  };
  const original = normalize(mutation.path).replace(/\/$/, "");
  const current = normalize(filePath);
  if (current !== original && !current.startsWith(`${original}/`)) return filePath;
  if (mutation.action === "delete") return null;
  return mutation.nextPath + filePath.slice(original.length);
}

export function mutateFileWorkspace(workspace: FileWorkspaceState, mutation: FileMutation): FileWorkspaceState {
  let activeTabId = workspace.activeTabId;
  const tabs = workspace.tabs.flatMap(tab => {
    const filePath = mutatedFilePath(tab.filePath, mutation);
    if (filePath === tab.filePath) return [tab];
    if (filePath === null) return [];
    const id = `file:${filePath}`;
    if (activeTabId === tab.id) activeTabId = id;
    return [{ ...tab, id, filePath, label: filePath.replace(/\\/g, "/").split("/").at(-1) ?? filePath, viewerRevision: (tab.viewerRevision ?? 0) + 1 }];
  });
  if (activeTabId?.startsWith("file:") && !tabs.some(tab => tab.id === activeTabId)) activeTabId = tabs.at(-1)?.id ?? null;
  return { ...workspace, tabs, activeTabId };
}

export interface FileWorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  open: boolean;
}

// A parked workspace keeps the generation its tabs were live in: the viewer
// that unmounts after the switch reports under it, so its state lands in these
// tabs even when the workspace switched to has the same file open.
export interface ParkedFileWorkspace extends FileWorkspaceState {
  generation: number;
}

export function switchFileWorkspace(
  states: Map<string, ParkedFileWorkspace>,
  currentKey: string | null,
  nextKey: string,
  current: FileWorkspaceState,
  generation: number,
): FileWorkspaceState {
  if (currentKey === nextKey) return current;
  if (currentKey) states.set(currentKey, { ...current, generation });
  const parked = states.get(nextKey);
  if (!parked) return { tabs: [], activeTabId: null, open: false };
  // Live tabs are never parked: the map holds only the workspaces left.
  states.delete(nextKey);
  return { tabs: parked.tabs, activeTabId: parked.activeTabId, open: parked.open };
}

interface OpenFileTabInput {
  fileName: string;
  filePath: string;
  modeHint?: "diff";
  page?: number;
  sourceSessionId?: string | null;
  tabId: string;
}

export function openFileTab(tabs: Tab[], input: OpenFileTabInput): Tab[] {
  const existing = tabs.find((tab) => tab.id === input.tabId);
  if (!existing) {
    return [...tabs, {
      id: input.tabId,
      label: input.fileName,
      filePath: input.filePath,
      sourceSessionId: input.sourceSessionId,
      initialDisplayMode: input.modeHint,
      page: input.page,
      viewerState: input.modeHint ? {
        displayMode: input.modeHint,
        wrapLines: false,
        scrollTop: 0,
        scrollLeft: 0,
      } : undefined,
      viewerRevision: 0,
    }];
  }

  const sourceChanged = Boolean(
    input.sourceSessionId && existing.sourceSessionId !== input.sourceSessionId,
  );
  const sourceUnchanged = !sourceChanged;
  const pageChanged = existing.page !== input.page;
  if (sourceUnchanged && !input.modeHint && !pageChanged) return tabs;

  return tabs.map((tab) => {
    if (tab.id !== input.tabId) return tab;
    const next: Tab = { ...tab };
    let bumpRevision = false;
    if (sourceChanged) {
      next.sourceSessionId = input.sourceSessionId;
      bumpRevision = true;
    }
    if (pageChanged) {
      next.page = input.page;
      bumpRevision = true;
    }
    if (input.modeHint) {
      next.initialDisplayMode = input.modeHint;
      next.viewerState = {
        displayMode: input.modeHint,
        wrapLines: tab.viewerState?.wrapLines ?? false,
        scrollTop: 0,
        scrollLeft: 0,
      };
      bumpRevision = true;
    }
    if (bumpRevision) next.viewerRevision = (tab.viewerRevision ?? 0) + 1;
    return next;
  });
}

export function saveParkedFileViewerState(
  states: Map<string, ParkedFileWorkspace>,
  generation: number,
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
): void {
  for (const [key, workspace] of states) {
    if (workspace.generation !== generation) continue;
    states.set(key, { ...workspace, tabs: saveFileViewerState(workspace.tabs, tabId, viewerRevision, viewerState) });
    return;
  }
}

export function saveFileViewerState(
  tabs: Tab[],
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1 || (tabs[index].viewerRevision ?? 0) !== viewerRevision) return tabs;

  const next = [...tabs];
  next[index] = { ...next[index], viewerState };
  return next;
}
