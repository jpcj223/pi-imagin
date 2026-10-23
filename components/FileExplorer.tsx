"use client";

import { forwardRef, useState, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { getFileIcon, FolderIcon } from "./FileIcons";
import { DismissButton } from "./DismissButton";
import { FileActionMenu, openFileActionMenu } from "./FileActionMenu";
import {
  encodeFilePathForApi,
  explorerFolders,
  fileOwnerRoot,
  mergeProjectGitStatuses,
  getFileDirectory,
  getFileName,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "@/lib/file-paths";
import type { GitFileStatus, GitFileStatusKind, GitStatusResponse } from "@/lib/git-types";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import { readDroppedItems, uploadFiles, type UploadConflictStrategy, type UploadError, type UploadResponse } from "@/lib/file-upload-client";
import { buildSearchTree, type SearchTreeNode } from "@/lib/search-tree";
import type { FileTreeHiddenReason } from "@/lib/file-tree-visibility";
import { createExpandedPathsMemory } from "@/lib/file-tree-expansion";
import { useI18n } from "@/hooks/useI18n";
type Translate = ReturnType<typeof useI18n>["t"];

/** Why a listed entry is normally left out; only listings with `hidden=1` report it. */
type HiddenReason = Exclude<FileTreeHiddenReason, "always">;

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
  /** Where a directory link leads when that is outside the browsable roots. */
  outsideLinkTarget?: string;
  /** That target contains the project or the home folder. */
  outsideLinkEncloses?: boolean;
  hidden?: HiddenReason;
}

interface FileNode {
  projectRoot?: boolean;
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
  outsideLinkTarget?: string;
  outsideLinkEncloses?: boolean;
  hidden?: HiddenReason;
}

interface Props {
  cwd: string;
  /** 项目目录直接组成文件树；不要求用户逐个选择工作目录。 */
  folders?: readonly { name: string; path: string }[];
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  refreshKey?: number;
  onDirectoryChange?: (directory: string | null) => void;
  onOpenTerminal?: (directory: string) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  onUploadBusyChange?: (busy: boolean) => void;
  changesCollapsed: boolean;
  onChangesCountChange?: (count: number) => void;
  fileSearchOpen?: boolean;
  onFileSearchOpenChange?: (open: boolean) => void;
  /** Also list what Git ignores, dimmed (the explorer bar's switch). */
  showHidden?: boolean;
}

export interface FileExplorerHandle {
  openUploadPicker: () => void;
}

type UploadPhase = "idle" | "checking" | "uploading";

// Each folder's open directories for the page's life, so moving to another
// project and back (a session picked in another group) does not fold the tree.
const expandedPathsByCwd = createExpandedPathsMemory();

interface UploadSummary {
  directory: string;
  uploaded: string[];
  skipped: string[];
  errors: UploadError[];
}

interface PendingConflict {
  directory: string;
  files: File[];
  conflicts: string[];
  nonReplaceable: string[];
}

async function responseError(res: Response, fallback: string): Promise<Error> {
  let message = `${fallback} (HTTP ${res.status})`;
  try {
    const data = await res.json() as { error?: string };
    if (data.error) message = data.error;
  } catch {
    // ignore non-JSON error bodies
  }
  return new Error(message);
}

async function fetchEntries(dirPath: string, showHidden = false): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await fetch(`/api/files/${encoded}?type=list${showHidden ? "&hidden=1" : ""}`);
  if (!res.ok) throw await responseError(res, "Failed to load files");
  const data = await res.json() as { entries?: FileEntry[] };
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
    outsideLinkTarget: e.outsideLinkTarget,
    outsideLinkEncloses: e.outsideLinkEncloses,
    hidden: e.hidden,
  }));
}

// Sends the target the operator was shown, so a link pointed elsewhere since
// the listing is refused instead of granting a directory nobody looked at.
async function allowOutsideLink(linkPath: string, target: string): Promise<void> {
  const res = await fetch(`/api/files/${encodeFilePathForApi(linkPath)}?type=allow-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) throw await responseError(res, "Failed to allow the linked folder");
}

async function fetchGitStatus(cwd: string): Promise<GitStatusResponse> {
  const params = new URLSearchParams({ cwd });
  const res = await fetch(`/api/git/status?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load Git status (HTTP ${res.status})`);
  return res.json() as Promise<GitStatusResponse>;
}

const GIT_STATUS_KEYS: Record<GitFileStatusKind, string> = {
  modified: "files.modified",
  added: "files.added",
  deleted: "files.deleted",
  renamed: "files.renamed",
  untracked: "files.untracked",
  conflict: "files.conflict",
};

const GIT_STATUS_COLORS: Record<GitFileStatusKind, string> = {
  modified: "#d6a84b",
  added: "#4ade80",
  deleted: "#f87171",
  renamed: "#60a5fa",
  untracked: "#4ade80",
  conflict: "#f87171",
};

function GitStatusBadge({ status, t }: { status: GitFileStatus; t: Translate }) {
  return (
    <span
      title={t(GIT_STATUS_KEYS[status.status])}
      aria-label={t(GIT_STATUS_KEYS[status.status])}
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: GIT_STATUS_COLORS[status.status],
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {status.code}
    </span>
  );
}

function MentionIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

function OutsideLinkIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

// Listed only while the explorer shows ignored files: dimmed like VS Code's
// ignored entries, the reason in the name's tooltip.
const HIDDEN_ENTRY_OPACITY = 0.55;
const HIDDEN_REASON_KEYS = {
  ignored: "files.hiddenIgnored",
  excluded: "files.hiddenExcluded",
} as const satisfies Record<HiddenReason, string>;

export function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshToken,
  highlightedPaths,
  gitStatusByPath,
  changedDirectoryPaths,
  showHidden = false,
  parentHidden,
  uploadTarget,
  t,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshToken?: string;
  highlightedPaths: Set<string>;
  gitStatusByPath: Map<string, GitFileStatus>;
  changedDirectoryPaths: Set<string>;
  showHidden?: boolean;
  /** Set inside a hidden directory: Git has no answer there, so its entries inherit the reason. */
  uploadTarget?: string | null;
  parentHidden?: HiddenReason;
  t: Translate;
}) {
  const open = expandedPaths.has(node.fullPath);
  const hidden = node.hidden ?? parentHidden;
  const highlighted = highlightedPaths.has(node.fullPath);
  const normalizedPath = normalizeFilePathSlashes(node.fullPath);
  const gitStatus = gitStatusByPath.get(normalizedPath);
  const containsGitChanges = node.isDir && (
    gitStatus !== undefined || changedDirectoryPaths.has(normalizedPath)
  );
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [allowedLinkTarget, setAllowedLinkTarget] = useState<string | null>(null);
  const [allowingLink, setAllowingLink] = useState(false);
  const [allowLinkError, setAllowLinkError] = useState<string | null>(null);
  // A link leading outside the project is refused until the operator allows
  // its target, so it asks for that instead of listing (#748).
  const pendingLinkTarget = node.outsideLinkTarget && node.outsideLinkTarget !== allowedLinkTarget
    ? node.outsideLinkTarget
    : null;

  // A listing that reports the link again (a server restart forgets allowed
  // targets, or the link was pointed elsewhere) needs a new decision.
  useEffect(() => {
    setAllowedLinkTarget(null);
    setAllowLinkError(null);
  }, [node.outsideLinkTarget]);

  const loadChildren = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    setLoadError(null);
    try {
      const entries = await fetchEntries(node.fullPath, showHidden);
      setChildren(entries);
      setLoaded(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath, showHidden]);

  // The switch changes what every listing holds: reload an open directory now
  // and a collapsed one when it next opens.
  const listedShowHiddenRef = useRef(showHidden);
  useEffect(() => {
    if (listedShowHiddenRef.current === showHidden) return;
    listedShowHiddenRef.current = showHidden;
    if (!loaded) return;
    if (open && !pendingLinkTarget) loadChildren(true);
    else setLoaded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  // A hidden directory left expanded mounts open again when the switch comes
  // back on, before anything listed it.
  useEffect(() => {
    if (node.isDir && open && !loaded && !pendingLinkTarget) loadChildren();
  }, [node.isDir, open, loaded, pendingLinkTarget, loadChildren]);

  // Re-fetch children when the tree refreshes and the directory is open.
  useEffect(() => {
    if (refreshToken !== undefined && open && loaded && !pendingLinkTarget) {
      loadChildren(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, open, onOpenFile, onToggleExpanded]);

  const handleAllowLink = useCallback(async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!pendingLinkTarget) return;
    // A link to `/`, `~` or a parent of the project opens far more than a
    // sibling folder, and a cloned repository can contain one.
    if (node.outsideLinkEncloses && !window.confirm(t("files.allowEnclosingLinkConfirm", { target: pendingLinkTarget }))) {
      return;
    }
    setAllowingLink(true);
    setAllowLinkError(null);
    try {
      await allowOutsideLink(node.fullPath, pendingLinkTarget);
      setAllowedLinkTarget(pendingLinkTarget);
      await loadChildren(true);
    } catch (error) {
      setAllowLinkError(error instanceof Error ? error.message : String(error));
    } finally {
      setAllowingLink(false);
    }
  }, [node.fullPath, node.outsideLinkEncloses, pendingLinkTarget, loadChildren, t]);

  return (
    <div>
      <div
        className={`workspace-file-row${node.isDir && uploadTarget === node.fullPath ? " is-upload-target" : ""}`}
        data-file-upload-directory={pendingLinkTarget ? undefined : node.isDir ? node.fullPath : getFileDirectory(node.fullPath)}
        onClick={handleClick}
        onContextMenu={event => { event.preventDefault(); if (!pendingLinkTarget) openFileActionMenu({ cwd, path: node.fullPath, name: node.name, isDir: node.isDir, projectRoot: node.projectRoot, x: event.clientX, y: event.clientY }); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 24,
          cursor: "pointer",
          background: hovered ? "var(--bg-hover)" : "transparent",
          borderRadius: 4,
          userSelect: "none",
        }}
      >
        {node.isDir && (
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
        )}
        {!node.isDir && <span style={{ width: 10, flexShrink: 0 }} />}
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", opacity: hidden ? HIDDEN_ENTRY_OPACITY : 1 }}>
          {node.isDir ? <FolderIcon size={14} open={open} /> : getFileIcon(node.name, 14)}
        </span>
        <span
          data-hidden-reason={hidden}
          style={{
            fontSize: 12,
            color: hidden ? "var(--text-muted)" : "var(--text)",
            opacity: hidden ? HIDDEN_ENTRY_OPACITY : 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            marginRight: node.isDir ? 54 : 78,
          }}
          title={hidden ? `${node.fullPath}\n${t(HIDDEN_REASON_KEYS[hidden])}` : node.fullPath}
        >
          {node.name}
        </span>
        {!pendingLinkTarget && <button type="button" className="workspace-file-actions-trigger" aria-label={t("fileEdit.actions", { name: node.name })} onClick={event => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); openFileActionMenu({ cwd, path: node.fullPath, name: node.name, isDir: node.isDir, projectRoot: node.projectRoot, x: rect.left, y: rect.bottom }); }}>···</button>}
        {!hovered && pendingLinkTarget && (
          <span
            title={t("files.outsideLink", { target: pendingLinkTarget })}
            aria-label={t("files.outsideLink", { target: pendingLinkTarget })}
            style={{ width: 14, height: 14, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)" }}
          >
            <OutsideLinkIcon />
          </span>
        )}
        {highlighted && (
          <span
            title={t("files.newlyUploaded")}
            aria-label={t("files.newlyUploaded")}
            style={{ width: 14, height: 14, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3b82f6" }} />
          </span>
        )}
        {!hovered && !node.isDir && gitStatus && (
          <GitStatusBadge status={gitStatus} t={t} />
        )}
        {!hovered && containsGitChanges && (
          <span
            title={t("files.containsChangedFiles")}
            aria-label={t("files.containsChangedFiles")}
            style={{
              width: 14,
              height: 14,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#d6a84b" }} />
          </span>
        )}
        {loading && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
          </svg>
        )}
        {onAtMention && hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir);
            }}
            title={t("files.insertPath")}
            aria-label={t("files.mention")}
            style={{
              position: "absolute",
              right: !node.isDir ? 56 : 30,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: 0,
              width: 20,
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <MentionIcon />
          </button>
        )}
        {hovered && !node.isDir && (
          <a
            href={`/api/files/${encodeFilePathForApi(node.fullPath)}?type=download`}
            download
            onClick={(e) => e.stopPropagation()}
            title={t("files.download")}
            style={{
              position: "absolute",
              right: 30,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "0 5px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
              textDecoration: "none",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
        )}
      </div>
      {node.isDir && open && pendingLinkTarget && (
        <div
          style={{
            paddingLeft: 8 + (depth + 1) * 14,
            paddingRight: 8,
            paddingTop: 3,
            paddingBottom: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 4,
            fontSize: 11,
            color: "var(--text-dim)",
          }}
        >
          <span style={{ wordBreak: "break-all" }}>{t("files.outsideLink", { target: pendingLinkTarget })}</span>
          {node.outsideLinkEncloses && (
            <span style={{ color: "#f59e0b" }}>{t("files.outsideLinkEncloses")}</span>
          )}
          <button
            type="button"
            onClick={handleAllowLink}
            disabled={allowingLink}
            title={t("files.allowOutsideLinkTitle", { target: pendingLinkTarget })}
            style={{
              height: 20,
              padding: "0 8px",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--accent)",
              cursor: allowingLink ? "default" : "pointer",
              opacity: allowingLink ? 0.6 : 1,
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {t("files.allowOutsideLink")}
          </button>
          {allowLinkError && (
            <span role="alert" style={{ color: "#f87171", wordBreak: "break-word" }}>{allowLinkError}</span>
          )}
        </div>
      )}
      {node.isDir && open && !pendingLinkTarget && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              expandedPaths={expandedPaths}
              onToggleExpanded={onToggleExpanded}
              refreshToken={refreshToken}
              highlightedPaths={highlightedPaths}
              gitStatusByPath={gitStatusByPath}
              changedDirectoryPaths={changedDirectoryPaths}
              showHidden={showHidden}
              uploadTarget={uploadTarget}
              parentHidden={hidden}
              t={t}
            />
          ))}
          {children.length === 0 && loaded && !loadError && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: 11, color: "var(--text-dim)", height: 22, display: "flex", alignItems: "center" }}>
              empty
            </div>
          )}
          {loadError && (
            <div role="alert" style={{ paddingLeft: 8 + (depth + 1) * 14, paddingRight: 8, paddingTop: 3, paddingBottom: 3, fontSize: 11, color: "#f87171", wordBreak: "break-word" }}>
              {loadError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type OpenFileOptions = { sourceSessionId?: string | null; modeHint?: "diff" };

type OpenFileHandler = (filePath: string, fileName: string, options?: OpenFileOptions) => void;

function ChangeRow({
  status,
  cwd,
  onOpenFile,
  onAtMention,
  t,
}: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: OpenFileHandler;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  t: Translate;
}) {
  const [hovered, setHovered] = useState(false);
  const name = getFileName(status.filePath);
  const rel = getRelativeFilePath(status.filePath, cwd);
  // Split the path so the directory part ellipsizes while the file name stays fully visible
  const lastSlash = rel.lastIndexOf("/");
  const dirPart = lastSlash >= 0 ? rel.slice(0, lastSlash + 1) : "";
  const baseName = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;
  return (
    <div
      onClick={() => onOpenFile(status.filePath, name, { modeHint: "diff" })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={status.filePath}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingLeft: 10,
        paddingRight: 8,
        height: 24,
        cursor: "pointer",
        background: hovered ? "var(--bg-hover)" : "transparent",
        borderRadius: 4,
        userSelect: "none",
        position: "relative",
      }}
    >
      <GitStatusBadge status={status} t={t} />
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", opacity: 0.85 }}>
        {getFileIcon(name, 13)}
      </span>
      <span
        title={status.filePath}
        style={{
          fontSize: 12,
          color: "var(--text)",
          display: "flex",
          alignItems: "center",
          minWidth: 0,
          flex: 1,
        }}
      >
        {dirPart && (
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: "0 1 auto",
              minWidth: 0,
              color: "var(--text-dim)",
            }}
          >
            {dirPart}
          </span>
        )}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: 0,
            maxWidth: "100%",
          }}
        >
          {baseName}
        </span>
      </span>
      {onAtMention && hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAtMention(rel, false);
          }}
          title={t("files.insertPath")}
          style={{
            position: "absolute",
            right: 4,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            padding: "0 8px",
            height: 20,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--accent)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          <MentionIcon />
          {t("files.mention")}
        </button>
      )}
    </div>
  );
}

export const FileExplorer = forwardRef<FileExplorerHandle, Props>(function FileExplorer({
  cwd,
  folders,
  onOpenFile,
  refreshKey,
  onDirectoryChange,
  onOpenTerminal,
  onAtMention,
  onAtMentions,
  onUploadBusyChange,
  changesCollapsed,
  onChangesCountChange,
  fileSearchOpen = false,
  onFileSearchOpenChange,
  showHidden = false,
}, ref) {
  const { t } = useI18n();
  const folderKey = JSON.stringify(folders?.map(folder => [folder.name, folder.path]) ?? [[getFileName(cwd), cwd]]);
  const browseFolders = useMemo(() => explorerFolders((JSON.parse(folderKey) as [string, string][]).map(([name, path]) => ({ name, path }))), [folderKey]);
  const multiple = browseFolders.length > 1;
  const ownerCwd = (path: string) => fileOwnerRoot(path, browseFolders, cwd);
  const directoryName = (path: string) => browseFolders.find(folder => normalizeFilePathSlashes(folder.path) === normalizeFilePathSlashes(path))?.name ?? getFileName(path);
  // 跨根引用使用真实路径，避免同名文件被解释成当前会话目录下的文件。
  const mentionFrom = (root: string) => onAtMention && ((path: string, isDir: boolean) => onAtMention(
    (multiple || root !== cwd) && !/^(?:[a-z]:[\\/]|[/\\])/i.test(path) ? joinFilePath(root, path) : path, isDir,
  ));
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());
  const [gitFiles, setGitFiles] = useState<GitFileStatus[]>([]);
  const [gitLineStats, setGitLineStats] = useState({ additions: 0, deletions: 0 });
  const [dropDirectory, setDropDirectory] = useState<string | null>(null);
  const uploadDirectoryRef = useRef(cwd);
  const uploadInFlightRef = useRef(false);
  const [uploadDirectory, setUploadDirectory] = useState(cwd);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ root: string; paths: string[] }[]>([]);
  const searchPaths = searchResults.flatMap(result => result.paths);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevCwdRef = useRef<string | null>(null);
  const expandedPathsRef = useRef(expandedPaths);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const refreshToken = `${refreshKey ?? 0}:${treeRefreshKey}`;
  const uploadBusy = uploadPhase !== "idle";
  const hasSearchQuery = searchQuery.trim().length > 0;

  // Reuse the cached, bounded file index used by @ mentions.
  useEffect(() => {
    if (!fileSearchOpen) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError(false);
    const timer = setTimeout(() => {
      Promise.all(browseFolders.map(async folder => {
        const response = await fetch(`/api/file-index?cwd=${encodeURIComponent(folder.path)}&q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search failed");
        const data = await response.json() as { matches?: FileIndexEntry[] };
        return { root: folder.path, paths: (data.matches ?? []).filter(entry => !entry.isDir).map(entry => entry.path) };
      }))
        .then(data => { if (!controller.signal.aborted) setSearchResults(data); })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSearchResults([]);
            setSearchError(true);
          }
        })
        .finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [browseFolders, fileSearchOpen, searchQuery]);

  // Focus the search input whenever the search panel opens.
  useEffect(() => {
    if (fileSearchOpen) searchInputRef.current?.focus();
  }, [fileSearchOpen]);

  const searchRoots = useMemo(() => searchResults.flatMap(result => {
    const toFileNode = (node: SearchTreeNode): FileNode => ({
      name: node.name, fullPath: joinFilePath(result.root, node.path),
      isDir: node.isDir, size: 0, children: node.children.map(toFileNode), loaded: true,
    });
    const children = buildSearchTree(result.paths).map(toFileNode);
    if (!multiple || !children.length) return children;
    return [{ name: browseFolders.find(folder => folder.path === result.root)?.name ?? getFileName(result.root),
      fullPath: result.root, isDir: true, size: 0, children, loaded: true, projectRoot: true }];
  }), [browseFolders, multiple, searchResults]);

  useEffect(() => {
    const dirs = new Set<string>();
    const collect = (nodes: FileNode[]) => nodes.forEach(node => {
      if (node.isDir) { dirs.add(node.fullPath); collect(node.children ?? []); }
    });
    collect(searchRoots);
    setSearchExpanded(previous => new Set([...previous, ...dirs]));
  }, [searchRoots]);

  const gitStatusByPath = useMemo(() => new Map(
    gitFiles.map((status) => [normalizeFilePathSlashes(status.filePath), status]),
  ), [gitFiles]);

  const changedDirectoryPaths = useMemo(() => {
    const directories = new Set<string>();
    for (const status of gitFiles) {
      const normalizedCwd = normalizeFilePathSlashes(fileOwnerRoot(status.filePath, browseFolders, cwd)).replace(/\/$/, "");
      let directory = getFileDirectory(normalizeFilePathSlashes(status.filePath));
      while (directory === normalizedCwd || directory.startsWith(`${normalizedCwd}/`)) {
        directories.add(directory);
        if (directory === normalizedCwd) break;
        const parent = getFileDirectory(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    return directories;
  }, [browseFolders, cwd, gitFiles]);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  const applyUploadResult = useCallback((directory: string, data: UploadResponse) => {
    const uploaded = data.uploaded ?? [];
    setUploadSummary({ directory, uploaded, skipped: data.skipped ?? [], errors: data.errors ?? [] });
    if (uploaded.length > 0) {
      setHighlightedPaths(new Set(uploaded.map(name => joinFilePath(directory, name))));
      setSearchQuery("");
      const owner = fileOwnerRoot(directory, browseFolders, cwd);
      setExpandedPaths(previous => {
        const next = new Set(previous);next.add(owner);next.add(directory);
        let parent = getFileDirectory(directory);
        const normalizedOwner = normalizeFilePathSlashes(owner).replace(/\/$/, "");
        while (parent === normalizedOwner || parent.startsWith(`${normalizedOwner}/`)) {
          next.add(parent);
          const ancestor = getFileDirectory(parent);if (ancestor === parent) break;parent = ancestor;
        }
        return next;
      });
      setTreeRefreshKey(key => key + 1);
    }
  }, [browseFolders, cwd]);

  const performUpload = useCallback(async (directory: string, files: File[], strategy: UploadConflictStrategy) => {
    uploadInFlightRef.current = true;
    setPendingConflict(null);setUploadError(null);setUploadProgress(0);
    setUploadDirectory(directory);setUploadPhase("uploading");
    try {
      const { status, data } = await uploadFiles(directory, files, strategy, setUploadProgress);
      if (status === 409 && data.conflicts?.length) {
        setPendingConflict({ directory, files, conflicts: data.conflicts, nonReplaceable: data.nonReplaceable ?? [] });
        return;
      }
      if (status < 200 || status >= 300) throw new Error(data.error ?? `Upload failed (HTTP ${status})`);
      setUploadProgress(100);applyUploadResult(directory, data);
    } catch (cause) { setUploadError(cause instanceof Error ? cause.message : String(cause)); }
    finally { uploadInFlightRef.current = false;setUploadPhase("idle"); }
  }, [applyUploadResult]);

  const prepareUpload = useCallback(async (directory: string, files: File[]) => {
    if (!files.length || uploadInFlightRef.current || pendingConflict) return;
    uploadInFlightRef.current = true;
    setUploadDirectory(directory);setUploadSummary(null);setHighlightedPaths(new Set());
    setPendingConflict(null);setUploadError(null);setUploadProgress(0);setUploadPhase("checking");
    try {
      const response = await fetch(`/api/files/${encodeFilePathForApi(directory)}?type=upload-check`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileNames: files.map(file => file.name) }),
      });
      const data = await response.json().catch(() => ({})) as UploadResponse;
      if (!response.ok) throw new Error(data.error ?? `Upload check failed (HTTP ${response.status})`);
      if (data.conflicts?.length) {
        setPendingConflict({ directory, files, conflicts: data.conflicts, nonReplaceable: data.nonReplaceable ?? [] });
        return;
      }
      await performUpload(directory, files, "error");
    } catch (cause) { setUploadError(cause instanceof Error ? cause.message : String(cause)); }
    finally { uploadInFlightRef.current = false;setUploadPhase("idle"); }
  }, [pendingConflict, performUpload]);

  const openUploadPicker = useCallback((directory: string) => {
    if (uploadInFlightRef.current || pendingConflict) return;
    onDirectoryChange?.(directory);
    uploadDirectoryRef.current = directory;uploadInputRef.current?.click();
  }, [onDirectoryChange, pendingConflict]);
  const handleUploadInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);event.target.value = "";
    void prepareUpload(uploadDirectoryRef.current, files);
  }, [prepareUpload]);
  useImperativeHandle(ref, () => ({ openUploadPicker: () => openUploadPicker(cwd) }), [cwd, openUploadPicker]);

  useEffect(() => { onDirectoryChange?.(multiple ? null : browseFolders[0]?.path ?? null);setDropDirectory(null); }, [browseFolders, multiple, onDirectoryChange]);
  useEffect(() => () => onDirectoryChange?.(null), [onDirectoryChange]);

  function targetDirectory(target: EventTarget | null): string | null {
    const row = target instanceof Element ? target.closest<HTMLElement>(".workspace-file-row") : null;
    return row ? row.dataset.fileUploadDirectory ?? null : multiple ? null : browseFolders[0]?.path ?? null;
  }
  function hasFiles(transfer: DataTransfer) { return Array.from(transfer.types).includes("Files"); }
  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();event.stopPropagation();
    const directory = uploadBusy || pendingConflict ? null : targetDirectory(event.target);
    setDropDirectory(directory);event.dataTransfer.dropEffect = directory ? "copy" : "none";
  }
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();event.stopPropagation();setDropDirectory(null);
    const directory = targetDirectory(event.target);
    if (!directory) { setUploadError(t("fileEdit.dropTargetRequired"));return; }
    const items = readDroppedItems(event.dataTransfer);
    if (items.some(item => item.kind === "folder")) { setUploadError(t("fileEdit.noFolderUpload"));return; }
    void prepareUpload(directory, items.flatMap(item => item.kind === "file" ? [item.file] : []));
  }

  useEffect(() => {
    onUploadBusyChange?.(uploadBusy);
  }, [onUploadBusyChange, uploadBusy]);

  useEffect(() => () => onUploadBusyChange?.(false), [onUploadBusyChange]);

  // Declared before the cwd effect, so that one saves the set the user last saw.
  useEffect(() => {
    expandedPathsRef.current = expandedPaths;
  }, [expandedPaths]);

  // An explorer that unmounts (its cwd gone, then back) saves its folder's set too, so it comes back open.
  useEffect(() => () => {
    if (prevCwdRef.current !== null) expandedPathsByCwd.save(prevCwdRef.current, expandedPathsRef.current);
  }, []);

  useEffect(() => {
    const previousCwd = prevCwdRef.current;
    const cwdChanged = previousCwd !== cwd;
    prevCwdRef.current = cwd;

    // Swap the open directories only when cwd changes, not on refreshKey bumps.
    // The roots unmount while the new cwd loads, so each restored directory
    // mounts open and lists itself; one that is gone is never listed to look.
    if (cwdChanged) {
      if (previousCwd !== null) expandedPathsByCwd.save(previousCwd, expandedPathsRef.current);
      const restored = expandedPathsByCwd.restore(cwd);
      expandedPathsRef.current = restored;
      setExpandedPaths(restored);
      setHighlightedPaths(new Set());
      setUploadSummary(null);
      setPendingConflict(null);
      setUploadError(null);
    }

    setLoading(cwdChanged);
    setError(null);
    let cancelled = false;
    // 单目录保持原来的平铺；多个目录自然展示为文件树根节点，按需读取。
    (multiple ? Promise.resolve(browseFolders.map(folder => ({
      name: folder.name, fullPath: folder.path, isDir: true, size: 0, children: [], loaded: false, projectRoot: true,
    }))) : fetchEntries(browseFolders[0]?.path ?? cwd, showHidden))
      .then((entries) => { if (!cancelled) setRoots(entries); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cwd, browseFolders, multiple, refreshKey, treeRefreshKey, showHidden]);

  // 窗口重新聚焦时刷新文件，显示编辑器或终端在应用之外产生的改动。
  useEffect(() => {
    const refresh = () => setTreeRefreshKey((key) => key + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(browseFolders.map(async folder => ({ cwd: folder.path, status: await fetchGitStatus(folder.path).catch(() => null) })))
      .then(statuses => {
        if (cancelled) return;
        const merged = mergeProjectGitStatuses(statuses);
        setGitFiles(merged.files);
        setGitLineStats({ additions: merged.additions, deletions: merged.deletions });
      });
    return () => { cancelled = true; };
  }, [browseFolders, refreshKey, treeRefreshKey]);

  useEffect(() => {
    onChangesCountChange?.(gitFiles.length);
  }, [gitFiles, onChangesCountChange]);

  const showUploadFeedback = uploadBusy || pendingConflict !== null || uploadError !== null || uploadSummary !== null;

  const addUploadedFilesToChat = useCallback(() => {
    if (!uploadSummary || uploadSummary.uploaded.length === 0) return;
    onAtMentions?.(
      uploadSummary.uploaded.map((name) => multiple ? joinFilePath(uploadSummary.directory, name) : getRelativeFilePath(joinFilePath(uploadSummary.directory, name), cwd)),
    );
  }, [cwd, multiple, onAtMentions, uploadSummary]);

  return (
    <div className="file-explorer" style={{ minHeight: "100%" }}
      onDragOver={handleDragOver} onDrop={handleDrop}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropDirectory(null); }}
      onContextMenu={event => {
        if ((event.target as Element).closest(".workspace-file-row") || multiple) return;
        const directory = browseFolders[0]?.path;if (!directory) return;
        event.preventDefault();openFileActionMenu({ cwd: directory, path: directory, name: getFileName(directory), isDir: true, projectRoot: true, x: event.clientX, y: event.clientY });
      }}
      onClickCapture={event => { if (!event.currentTarget.contains(event.target as Node)) return;const directory = targetDirectory(event.target);if (directory) onDirectoryChange?.(directory); }}>
      {dropDirectory && <div className="file-explorer-drop-hint" role="status" title={dropDirectory}>{t("fileEdit.uploadTo", { name: directoryName(dropDirectory) })}</div>}
      {browseFolders.map(folder => <FileActionMenu key={folder.path} cwd={folder.path} onUpload={openUploadPicker} onOpenTerminal={onOpenTerminal} onChanged={() => setTreeRefreshKey(key => key + 1)} />)}
      <input ref={uploadInputRef} type="file" multiple hidden onChange={handleUploadInput} />
      {showUploadFeedback && (
        <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
        <div className="file-explorer-upload-target" title={uploadDirectory}>{t("fileEdit.uploadTarget", { name: directoryName(uploadDirectory) })}</div>
        {uploadBusy && (
          <div role="status" aria-live="polite" aria-label={uploadPhase === "checking" ? t("files.checking") : t("files.uploading", { progress: uploadProgress })}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 14, color: "var(--text-muted)" }}>
              {uploadPhase === "checking" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-5.7-8.4" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 16V4" />
                  <path d="m7 9 5-5 5 5" />
                  <path d="M5 20h14" />
                </svg>
              )}
              {uploadPhase === "uploading" && <span style={{ fontSize: 10 }}>{uploadProgress}%</span>}
            </div>
            {uploadPhase === "uploading" && (
              <div style={{ height: 3, marginTop: 4, overflow: "hidden", borderRadius: 2, background: "var(--border)" }}>
                <div style={{ width: `${uploadProgress}%`, height: "100%", background: "var(--text-muted)", transition: "width 120ms ease" }} />
              </div>
            )}
          </div>
        )}

        {pendingConflict && (
          <div role="alert" style={{ padding: 7, border: "1px solid color-mix(in srgb, #f59e0b 55%, var(--border))", borderRadius: 4, background: "color-mix(in srgb, #f59e0b 9%, var(--bg-panel))" }}>
            <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.35, overflowWrap: "anywhere" }}>
              {t("files.conflictSummary", { count: pendingConflict.conflicts.length, countSuffix: pendingConflict.conflicts.length === 1 ? "" : "s", files: pendingConflict.conflicts.join(", ") })}
            </div>
            {pendingConflict.nonReplaceable.length > 0 && (
              <div style={{ marginTop: 3, fontSize: 10, color: "#f59e0b", lineHeight: 1.35, overflowWrap: "anywhere" }}>
                {t("files.cannotReplace", { files: pendingConflict.nonReplaceable.join(", ") })}
              </div>
            )}
            <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
              <button type="button" disabled={uploadBusy} onClick={() => { if (!uploadInFlightRef.current) void performUpload(pendingConflict.directory, pendingConflict.files, "overwrite"); }} style={{ height: 22, padding: "0 7px", border: "1px solid #ef4444", borderRadius: 4, background: "transparent", color: "#ef4444", cursor: "pointer", fontSize: 10 }}>
                {t("files.replace")}
              </button>
              <button type="button" disabled={uploadBusy} onClick={() => { if (!uploadInFlightRef.current) void performUpload(pendingConflict.directory, pendingConflict.files, "skip"); }} style={{ height: 22, padding: "0 7px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 10 }}>
                {t("files.skipExisting")}
              </button>
              <button type="button" onClick={() => setPendingConflict(null)} style={{ height: 22, padding: "0 7px", border: "none", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 10 }}>
                {t("files.cancel")}
              </button>
            </div>
          </div>
        )}

        {uploadError && (
          <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, lineHeight: 1.35, color: "#f87171" }}>
            <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>{uploadError}</span>
            <DismissButton onClick={() => setUploadError(null)} title={t("files.dismissError")} />
          </div>
        )}

        {uploadSummary && (
          <div aria-live="polite">
            <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 22, fontSize: 11 }}>
              <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                {uploadSummary.uploaded.length > 0 && (
                  <span title={`${uploadSummary.uploaded.length} uploaded`} aria-label={`${uploadSummary.uploaded.length} uploaded`} style={{ display: "flex", alignItems: "center", gap: 3, color: "#22c55e" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                    <span>{uploadSummary.uploaded.length}</span>
                  </span>
                )}
                {uploadSummary.skipped.length > 0 && (
                  <span title={`${uploadSummary.skipped.length} skipped`} aria-label={`${uploadSummary.skipped.length} skipped`} style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--text-dim)" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M8 12h8" />
                    </svg>
                    <span>{uploadSummary.skipped.length}</span>
                  </span>
                )}
                {uploadSummary.errors.length > 0 && (
                  <span title={`${uploadSummary.errors.length} failed`} aria-label={`${uploadSummary.errors.length} failed`} style={{ display: "flex", alignItems: "center", gap: 3, color: "#f87171" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 3 2.5 20h19L12 3Z" />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                    <span>{uploadSummary.errors.length}</span>
                  </span>
                )}
              </div>
              {uploadSummary.uploaded.length > 0 && onAtMentions && (
                <button
                  type="button"
                  onClick={addUploadedFilesToChat}
                  title={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                  aria-label={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                  style={{ height: 22, padding: "0 7px", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-panel)", color: "var(--accent)", cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}
                >
                  <MentionIcon />
                  {t("files.mention")}
                </button>
              )}
              <DismissButton onClick={() => setUploadSummary(null)} title={t("files.dismissUploadResults")} />
            </div>
            {uploadSummary.errors.map((item) => (
              <div key={item.name} title={item.error} style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, minWidth: 0, fontSize: 10, color: "#f87171" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5" />
                  <path d="M12 17h.01" />
                </svg>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
              </div>
            ))}
          </div>
        )}
        </div>
      )}

      {fileSearchOpen && (
      <div style={{ padding: "2px 8px 6px" }}>
        <div style={{ position: "relative" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
          </svg>
          <input
            ref={searchInputRef}
            id="file-search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") onFileSearchOpenChange?.(false); }}
            placeholder={t("sidebar.searchFilesPlaceholder")}
            aria-label={t("sidebar.searchFiles")}
            style={{ width: "100%", boxSizing: "border-box", padding: "6px 24px", border: "1px solid var(--border)", borderRadius: 8, outline: "none", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11 }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              title={t("sidebar.clearSearch")}
              aria-label={t("sidebar.clearSearch")}
              style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, padding: 0, border: "none", borderRadius: 4, background: "none", color: "var(--text-dim)", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>
        {hasSearchQuery && (
          <div style={{ paddingTop: 3 }}>
            {searchLoading && <div role="status" style={{ padding: "6px 2px", fontSize: 10, color: "var(--text-dim)" }}>{t("sidebar.searchingFiles")}</div>}
            {!searchLoading && searchError && <div role="alert" style={{ padding: "6px 2px", fontSize: 10, color: "#f87171" }}>{t("i18n.networkError")}</div>}
            {!searchLoading && !searchError && searchPaths.length === 0 && <div style={{ padding: "6px 2px", fontSize: 10, color: "var(--text-dim)" }}>{t("sidebar.noMatchingFiles")}</div>}
            {!searchLoading && !searchError && searchPaths.length > 0 && (
              <div>
                {searchRoots.map((node) => (
                  <TreeNode
                    key={`${searchQuery}:${node.fullPath}`}
                    node={node}
                    depth={0}
                    cwd={ownerCwd(node.fullPath)}
                    onOpenFile={onOpenFile}
                    onAtMention={mentionFrom(ownerCwd(node.fullPath))}
                    expandedPaths={searchExpanded}
                    onToggleExpanded={(fullPath, open) => {
                      setSearchExpanded((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(fullPath); else next.delete(fullPath);
                        return next;
                      });
                    }}
                    uploadTarget={dropDirectory}
                    highlightedPaths={highlightedPaths}
                    gitStatusByPath={gitStatusByPath}
                    changedDirectoryPaths={changedDirectoryPaths}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {!changesCollapsed && gitFiles.length > 0 && (
        <div style={{ padding: "0 4px 2px" }}>
          <div
            aria-label={t("files.changeStats", {
              count: gitFiles.length,
              additions: gitLineStats.additions,
              deletions: gitLineStats.deletions,
            })}
            style={{ display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", fontSize: 12 }}
          >
            <span style={{ color: "var(--text-dim)" }}>
              {t("files.changedCount", { count: gitFiles.length })}
            </span>
            <span style={{ color: GIT_STATUS_COLORS.added, fontFamily: "var(--font-mono)" }}>+{gitLineStats.additions}</span>
            <span style={{ color: GIT_STATUS_COLORS.deleted, fontFamily: "var(--font-mono)" }}>-{gitLineStats.deletions}</span>
          </div>
          {gitFiles.map((status) => (
            <ChangeRow
              key={status.filePath}
              status={status}
              cwd={ownerCwd(status.filePath)}
              onOpenFile={onOpenFile}
              onAtMention={mentionFrom(ownerCwd(status.filePath))}
              t={t}
            />
          ))}
        </div>
      )}

      {(changesCollapsed || gitFiles.length === 0) && (!fileSearchOpen || !hasSearchQuery) && (
        <div style={{ padding: "2px 4px" }}>
          {loading ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>Loading files...</div>
          ) : error ? (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "#f87171" }}>{error}</div>
          ) : (
            roots.map((node) => (
              <TreeNode
                key={node.fullPath}
                node={node}
                depth={0}
                cwd={ownerCwd(node.fullPath)}
                onOpenFile={onOpenFile}
                onAtMention={mentionFrom(ownerCwd(node.fullPath))}
                expandedPaths={expandedPaths}
                onToggleExpanded={handleToggleExpanded}
                refreshToken={refreshToken}
                highlightedPaths={highlightedPaths}
                gitStatusByPath={gitStatusByPath}
                changedDirectoryPaths={changedDirectoryPaths}
                showHidden={showHidden}
                uploadTarget={dropDirectory}
                t={t}
              />
            ))
          )}
          {!loading && !error && roots.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
              {t("files.noFiles")}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
