"use client";

import { useEffect, useRef, useState } from "react";
import type { ProjectTrustStatus } from "@/lib/api-types";
import type { NewSessionContext } from "@/lib/new-session-context";
import { newSessionProjectOptions } from "@/lib/new-session-project";
import type { ResourceProjectOption } from "@/components/ResourceInstallTarget";
import { validateWorkspaceSelection } from "@/lib/workspace-selection";

export function useResourceInstallTarget(cwd: string | null, inheritedTrust: ProjectTrustStatus | null | undefined, context: NewSessionContext | null | undefined, active: boolean) {
  const [selection, setSelection] = useState("default");
  const [remote, setRemote] = useState<{ cwd: string; status?: ProjectTrustStatus; error?: string } | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const pickSequence = useRef(0);
  const projects: ResourceProjectOption[] = context ? newSessionProjectOptions(context).map(option => ({ key: option.key, name: option.name, cwd: option.target.cwd, projectId: option.target.managedProjectId })) : [];
  const currentProject = projects.find(project => project.cwd === cwd || context?.cwd === cwd && project.projectId === context?.managedProjectId && project.projectId !== undefined);
  const current = cwd && inheritedTrust && !inheritedTrust.defaultWorkspace
    ? currentProject ? { ...currentProject, cwd } : { key: "current", name: cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || cwd, cwd }
    : null;
  if (current && !projects.some(project => project.key === current.key)) projects.unshift(current);
  const chosen = projects.find(project => project.key === selection) ?? null;
  // 全局是独立的安装范围，不借用当前会话或默认日期目录读取项目资源。
  const targetCwd = chosen?.cwd ?? null;
  const scope = chosen ? "project" as const : "global" as const;
  const status = targetCwd === cwd ? inheritedTrust : remote?.cwd === targetCwd ? remote.status : null;
  useEffect(() => {
    if (!active || !targetCwd || targetCwd === cwd) return;
    const controller = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(targetCwd)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) setRemote({ cwd: targetCwd, status: data });
      }).catch(error => { if (!controller.signal.aborted) setRemote({ cwd: targetCwd, error: String(error) }); });
    return () => controller.abort();
  }, [active, cwd, targetCwd]);
  return { projects, value: chosen?.key ?? "default", cwd: targetCwd, scope, trust: status, selecting,
    error: selectionError ?? (remote?.cwd === targetCwd ? remote.error : null),
    select: async (key: string) => {
      const sequence = ++pickSequence.current;
      setSelectionError(null);
      if (key === "default") { setSelection(key); setSelecting(false); return; }
      const project = projects.find(project => project.key === key);
      if (!project) { setSelecting(false); return; }
      setSelecting(true);
      try {
        await validateWorkspaceSelection(project.cwd, fetch, undefined, project.projectId);
        if (sequence === pickSequence.current) setSelection(key);
      } catch (error) { if (sequence === pickSequence.current) setSelectionError(String(error)); }
      finally { if (sequence === pickSequence.current) setSelecting(false); }
    },
    acceptTrust: (next: ProjectTrustStatus) => { if (targetCwd) setRemote({ cwd: targetCwd, status: next }); },
  };
}
