"use client";

import { useEffect, useState } from "react";
import type { McpErrorResponse, ProjectTrustStatus } from "@/lib/api-types";
import type { NewSessionContext } from "@/lib/new-session-context";
import { useResourceInstallTarget } from "@/hooks/useResourceInstallTarget";
import { McpConfig } from "./McpConfig";
import { ResourceInstallTarget } from "./ResourceInstallTarget";
import { ProjectTrustDialog, type ProjectTrustFailure } from "./ProjectTrustDialog";

/** 范围独立于会话；已访问范围保留自己的草稿、连接测试和登录状态。 */
export function McpWorkspace({ cwd, trust, projectContext, active, onClose, onProjectTrustChanged }: {
  cwd: string | null;
  trust?: ProjectTrustStatus | null;
  projectContext?: NewSessionContext | null;
  active: boolean;
  onClose: () => void;
  onProjectTrustChanged?: (cwd: string, status: ProjectTrustStatus) => void;
}) {
  const target = useResourceInstallTarget(cwd, trust, projectContext, active, "mcp");
  const [visited, setVisited] = useState<(string | null)[]>([null]);
  const [trustDialog, setTrustDialog] = useState<string | null>(null);
  const [trustBusy, setTrustBusy] = useState(false);
  const [trustError, setTrustError] = useState<ProjectTrustFailure | null>(null);
  useEffect(() => {
    setVisited(previous => previous.includes(target.cwd) ? previous : [...previous, target.cwd]);
  }, [target.cwd]);
  const targets = (visited.includes(target.cwd) ? visited : [...visited, target.cwd])
    .filter(path => path === null || target.projects.some(project => project.cwd === path));
  const acceptTrust = (path: string, status: ProjectTrustStatus) => {
    if (target.cwd === path) target.acceptTrust(status);
    onProjectTrustChanged?.(path, status);
  };
  const confirmTrust = async () => {
    if (!trustDialog || trustBusy) return;
    const path = trustDialog;
    setTrustBusy(true);
    setTrustError(null);
    try {
      const response = await fetch("/api/project-trust", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: path }) });
      const data = await response.json() as ProjectTrustStatus & Partial<McpErrorResponse>;
      if (!response.ok || data.error) {
        setTrustError({ error: data.error ?? `HTTP ${response.status}`, ...(data.reason ? { reason: data.reason } : {}) });
      } else {
        acceptTrust(path, data);
        setTrustDialog(null);
      }
    } catch (error) {
      setTrustError({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setTrustBusy(false);
    }
  };
  return <div className="mcp-scope-workspace">
    {targets.map(path => <div key={path ?? "global"} className="mcp-target-page" hidden={path !== target.cwd}>
      <McpConfig embedded cwd={path} active={active && path === target.cwd}
        trust={path === target.cwd ? target.trust : undefined} targetPending={target.selecting}
        renderTarget={pending => <ResourceInstallTarget value={target.value} projects={target.projects}
          pending={pending || target.selecting || !!trustDialog} loading={target.selecting} error={target.error}
          onChange={key => void target.select(key)} />}
        onTrustProject={path ? () => { setTrustError(null); setTrustDialog(path); } : undefined}
        onProjectTrustChanged={acceptTrust} onClose={onClose} />
    </div>)}
    {active && trustDialog && <ProjectTrustDialog cwd={trustDialog} busy={trustBusy} error={trustError}
      onCancel={() => { if (!trustBusy) setTrustDialog(null); }} onConfirm={() => void confirmTrust()}
      onStatus={status => acceptTrust(trustDialog, status)} />}
  </div>;
}
