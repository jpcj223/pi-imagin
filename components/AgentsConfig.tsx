"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invalidateResourceOverviews, peekResourceOverview, readResourceOverview } from "@/lib/resource-overview-cache";
import { useDeferredLoading } from "@/hooks/useDeferredLoading";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { ProjectTrustStatus, SubagentProfilesResponse, SubagentSettingsResponse } from "@/lib/api-types";
import { sendAgentCommand } from "@/lib/agent-client";
import { shortenPath } from "@/lib/display-path";
import type { NewSessionContext } from "@/lib/new-session-context";
import { useResourceInstallTarget } from "@/hooks/useResourceInstallTarget";
import type { ModelsData } from "@/lib/models-cache";
import { isSubagentProfileOverridden } from "@/lib/subagent-profile-precedence";
import type { SubagentProfile, SubagentScope, SubagentWritableScope } from "@/lib/subagents";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigEmptyState,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPanelShell,
  ConfigScopeTag,
  ConfigSidebar,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
} from "./SettingsUi";
import { InlineResourcePath } from "./ResourcePath";
import { ResourceInstallTarget } from "./ResourceInstallTarget";
import { ResourceRemoveDialog } from "./ResourceRemoveDialog";
import { ResourceSidebarRow } from "./ResourceSidebarGroups";
import { ModelSelector } from "./ModelSelector";
import { projectTrustReloadKey } from "./settings-ui-helpers";

const TOOL_OPTIONS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const THINKING_OPTIONS = ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type EditableProfile = Omit<SubagentProfile, "scope" | "filePath">;
type EditorMode = "view" | "edit" | "create";

const EMPTY_PROFILE: EditableProfile = {
  name: "custom-agent",
  displayName: "",
  description: "",
  systemPrompt: "",
  tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  loadSkills: false,
  loadExtensions: false,
  codemode: "off",
  mcp: "off",
  promptMode: "append",
  inheritContext: false,
  runInBackground: false,
  enabled: true,
};

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 34,
  padding: "0 9px",
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
};

const disabledInputStyle: CSSProperties = {
  background: "var(--bg-panel)",
  color: "var(--text-dim)",
  cursor: "default",
};

/** 只翻译内置角色的展示资料，不改写 ID、原始指令或自定义配置。 */
function profilePresentation(profile: SubagentProfile, t: (key: string) => string) {
  const builtin = profile.scope === "builtin" && ["explore", "general-purpose", "plan"].includes(profile.name);
  return {
    name: builtin ? t(`agents.role.${profile.name}.name`) : profile.displayName,
    description: builtin ? t(`agents.role.${profile.name}.description`) : profile.description,
    systemPrompt: builtin ? t(`agents.role.${profile.name}.prompt`) : profile.systemPrompt,
  };
}

function editableProfile(profile: SubagentProfile): EditableProfile {
  return {
    name: profile.name,
    displayName: profile.displayName,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    tools: [...profile.tools],
    loadSkills: profile.loadSkills,
    ...(profile.skills !== undefined ? { skills: [...profile.skills] } : {}),
    loadExtensions: profile.loadExtensions,
    codemode: profile.codemode ?? "off",
    mcp: profile.mcp ?? "off",
    ...(profile.extensions !== undefined ? { extensions: [...profile.extensions] } : {}),
    promptMode: profile.promptMode,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.thinking ? { thinking: profile.thinking } : {}),
    ...(profile.maxTurns ? { maxTurns: profile.maxTurns } : {}),
    inheritContext: profile.inheritContext,
    runInBackground: profile.runInBackground,
    enabled: profile.enabled,
  };
}

/**
 * The model a profile reference names. It may end in pi's `:<thinking level>` (`provider/model:high`),
 * which the runtime reads as the model plus its level; a listed id that contains a colon matches whole.
 */
function profileModelBase(reference: string, isListed: (reference: string) => boolean): string {
  if (isListed(reference)) return reference;
  const colon = reference.lastIndexOf(":");
  const level = reference.slice(colon + 1);
  return colon > 0 && level && (THINKING_OPTIONS as readonly string[]).includes(level) ? reference.slice(0, colon) : reference;
}

function profileKey(profile: Pick<SubagentProfile, "scope" | "name">): string {
  return `${profile.scope}:${profile.name}`;
}

function duplicateProfileName(name: string, profiles: readonly SubagentProfile[]): string {
  const existing = new Set(profiles.map((profile) => profile.name.toLowerCase()));
  const base = `${name}-copy`;
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate.toLowerCase())) candidate = `${base}-${suffix++}`;
  return candidate;
}

function isWritableScope(scope: SubagentScope): scope is SubagentWritableScope {
  return scope === "global" || scope === "project";
}

/**
 * A built-in has no file to edit, so its fields stay read-only, but its switch is
 * live: the server records the name in `agents/settings.json` instead of writing a
 * copy of the profile to disk.
 */
function isTogglableScope(scope: SubagentScope): boolean {
  return isWritableScope(scope) || scope === "builtin";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <ConfigField label={label}>{children}</ConfigField>;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 7, color: disabled ? "var(--text-dim)" : "var(--text-muted)", fontSize: 12, cursor: disabled ? "default" : "pointer" }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export function AgentsConfig({
  cwd,
  sessionId = null,
  onClose,
  onReloaded,
  embedded = false,
  trust,
  projectContext,
  active = true,
}: {
  cwd: string | null;
  projectContext?: NewSessionContext | null;
  active?: boolean;
  sessionId?: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
  /** The page's trust status for `cwd`; a new decision loads the model list again. */
  trust?: ProjectTrustStatus | null;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const installTarget = useResourceInstallTarget(cwd, trust, projectContext, active, "agents");
  const configCwd = installTarget.cwd;
  const targetKey = configCwd ?? "global";
  const [profiles, setProfiles] = useState<SubagentProfile[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelsData["modelList"]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableProfile>(EMPTY_PROFILE);
  const [mode, setMode] = useState<EditorMode>("view");
  const [targetScope, setTargetScope] = useState<SubagentWritableScope>("global");
  const [loading, setLoading] = useState(true);
  const showLoading = useDeferredLoading(loading);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [builtInEnabled, setBuiltInEnabled] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(10);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [loadedTarget, setLoadedTarget] = useState<string | null>(null);
  const [paths, setPaths] = useState<{ global?: string; project?: string }>({});
  const [expanded, setExpanded] = useState({ builtin: false, global: true, project: true });
  const [removeTarget, setRemoveTarget] = useState<{ profile: SubagentProfile; cwd: string | null } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const editors = useRef(new Map<string, { selectedKey: string | null; draft: EditableProfile; mode: EditorMode; scope: SubagentWritableScope; dirty: boolean }>());
  const targetPending = loadedTarget !== targetKey || loading || installTarget.selecting;
  const busy = saving || toggling || removing;

  const selected = useMemo(
    () => profiles.find((profile) => profileKey(profile) === selectedKey) ?? null,
    [profiles, selectedKey],
  );
  // 每个配置范围保留独立草稿；返回原项目时恢复，不把草稿带到另一个目录。
  useEffect(() => {
    if (loadedTarget !== null) editors.current.set(loadedTarget, { selectedKey, draft, mode, scope: targetScope, dirty: mode === "create" || !!selected && JSON.stringify(draft) !== JSON.stringify(editableProfile(selected)) });
  }, [loadedTarget, selectedKey, draft, mode, targetScope, selected]);


  const modelSelectorOptions = useMemo(() => modelOptions.map((model) => ({
    provider: model.provider,
    modelId: model.id,
    name: model.name,
  })), [modelOptions]);

  const loadProfiles = useCallback(async (preferredKey?: string, signal?: AbortSignal, restore = false) => {
    if (!restore) invalidateResourceOverviews("agents");
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    const apply = (data: Partial<SubagentProfilesResponse>) => {
      const next = data.profiles ?? [];
      const cached = preferredKey === undefined ? editors.current.get(targetKey) : undefined;
      setProfiles(next);
      setPaths({ global: data.globalAgentsPath, project: data.projectAgentsPath });
      setLoadedTarget(targetKey);
      if (cached?.dirty && (cached.mode === "create" || next.some(profile => profileKey(profile) === cached.selectedKey))) {
        setSelectedKey(cached.selectedKey); setDraft(cached.draft); setMode(cached.mode); setTargetScope(cached.scope);
      } else {
        const rememberedKey = preferredKey ?? cached?.selectedKey ?? getLastSettingsSelection("agents", configCwd);
        const chosen = preferredKey === "" ? null : next.find(profile => profileKey(profile) === rememberedKey)
          ?? next.find(profile => profile.scope === "global") ?? null;
        setSelectedKey(chosen ? profileKey(chosen) : null);
        setMode(chosen && isWritableScope(chosen.scope) ? "edit" : "view");
        if (chosen) { setDraft(editableProfile(chosen)); if (isWritableScope(chosen.scope)) setTargetScope(chosen.scope); }
      }
    };
    if (restore) {
      const cached = peekResourceOverview<SubagentProfilesResponse>("agents", configCwd);
      if (cached) apply(cached);
      else { setProfiles([]); setPaths({}); setLoadedTarget(null); setSelectedKey(null); setMode("view"); }
    }
    try {
      const data = await readResourceOverview<SubagentProfilesResponse>("agents", configCwd, signal, restore);
      if (sequence !== requestSequence.current || signal?.aborted) return;
      apply(data);
    } catch (cause) {
      if (sequence === requestSequence.current && !signal?.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === requestSequence.current && !signal?.aborted) setLoading(false);
    }
  }, [configCwd, targetKey]);

  useLayoutEffect(() => {
    const controller = new AbortController();
    void loadProfiles(undefined, controller.signal, true);
    return () => controller.abort();
  }, [loadProfiles]);

  useEffect(() => {
    const controller = new AbortController();
    setSettingsLoading(true);
    setSettingsError(null);
    void (async () => {
      try {
        const response = await fetch("/api/subagents/settings", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
        if (!response.ok || data.error || typeof data.enabled !== "boolean") {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        setBuiltInEnabled(data.enabled);
        if (typeof data.maxConcurrent === "number") setMaxConcurrent(data.maxConcurrent);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setSettingsError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setSettingsLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedKey && !targetPending) setLastSettingsSelection("agents", selectedKey, configCwd);
  }, [configCwd, selectedKey, targetPending]);

  // The model list follows the folder's trust: GET /api/models leaves out an
  // untrusted project's extensions, which can register providers. Trust can
  // change while this section stays mounted (hidden) in Settings, by trusting
  // from Settings › MCP; a new decision loads the list again in place, keeping
  // any profile draft.
  const trustKey = projectTrustReloadKey(installTarget.trust);
  useEffect(() => {
    const controller = new AbortController();
    setModelsLoading(true);
    setModelsError(null);
    void (async () => {
      try {
        const response = await fetch(configCwd ? `/api/models?cwd=${encodeURIComponent(configCwd)}` : "/api/models?scope=global", { signal: controller.signal });
        const data = await response.json() as Partial<ModelsData> & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setModelOptions(data.modelList ?? []);
        setModelsError(data.modelError ?? null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setModelsError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setModelsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [configCwd, trustKey]);

  const selectProfile = (profile: SubagentProfile) => {
    if (targetPending || busy) return;
    setSavedOk(false);
    setSelectedKey(profileKey(profile));
    setDraft(editableProfile(profile));
    setMode(isWritableScope(profile.scope) ? "edit" : "view");
    if (isWritableScope(profile.scope)) setTargetScope(profile.scope);
    setError(null);
  };

  const beginCreate = () => {
    if (targetPending || busy) return;
    setSavedOk(false);
    let name = "custom-agent";
    let suffix = 2;
    while (profiles.some((profile) => profile.name === name)) name = `custom-agent-${suffix++}`;
    setSelectedKey(null);
    setDraft({ ...EMPTY_PROFILE, name, displayName: t("agents.newDisplayName") });
    setMode("create");
    setTargetScope(installTarget.scope);
    setError(null);
  };

  const beginDuplicate = () => {
    if (!selected || targetPending || busy) return;
    setSavedOk(false);
    const name = duplicateProfileName(selected.name, profiles);
    setSelectedKey(null);
    setDraft({
      ...editableProfile(selected),
      name,
      displayName: t("agents.copyName", { name: profilePresentation(selected, t).name }),
    });
    setMode("create");
    setTargetScope(installTarget.scope);
    setError(null);
  };

  const save = async () => {
    if (targetPending || busy) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: targetScope === "global" ? null : configCwd, scope: targetScope, profile: draft }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles(profileKey(data.profile));
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!removeTarget || targetPending || busy) return;
    const target = removeTarget;
    setRemoving(true); setRemoveError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: target.cwd, scope: target.profile.scope, name: target.profile.name }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      const removedSelected = selectedKey === profileKey(target.profile);
      if (removedSelected) editors.current.delete(targetKey);
      await loadProfiles(removedSelected ? "" : undefined);
      setRemoveTarget(null);
    } catch (cause) { setRemoveError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRemoving(false); }
  };

  const editing = mode !== "view";
  const creating = mode === "create";
  const disabled = !editing || busy || targetPending;
  const displayedScope = creating ? targetScope : selected?.scope;
  const creationDirectory = targetScope === "global" ? paths.global : paths.project;
  const fullPath = creating && creationDirectory ? `${creationDirectory.replace(/[\\/]+$/, "")}/${draft.name || "..."}.md` : selected?.filePath;
  const isListedModel = (reference: string) => modelOptions.some((model) => `${model.provider}/${model.id}` === reference);
  const draftModelBase = draft.model && profileModelBase(draft.model, isListedModel);
  const selectedModelAvailable = !draftModelBase || isListedModel(draftModelBase);
  const selectedModel = (() => {
    if (!draftModelBase) return null;
    const separator = draftModelBase.indexOf("/");
    return separator < 0
      ? { provider: "", modelId: draftModelBase }
      : { provider: draftModelBase.slice(0, separator), modelId: draftModelBase.slice(separator + 1) };
  })();
  const presentation = selected && !creating ? profilePresentation(selected, t) : null;
  const controlStyle = disabled ? { ...inputStyle, ...disabledInputStyle } : inputStyle;
  const switchDisabled = creating
    ? disabled
    : !selected || !isTogglableScope(selected.scope) || busy || targetPending;
  const update = <K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  // As `buildSubagentPromptPlan()` decides: no tools, skills or extensions.
  const chatOnlyDraft = draft.tools.length === 0 && !draft.loadSkills && !draft.loadExtensions;

  const toggleEnabled = async (enabled: boolean) => {
    if (creating) {
      update("enabled", enabled);
      return;
    }
    if (!selected || !isTogglableScope(selected.scope) || busy || targetPending) return;
    setToggling(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: selected.scope === "project" ? configCwd : null, scope: selected.scope, name: selected.name, enabled }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      const saved = data.profile;
      invalidateResourceOverviews("agents");
      setProfiles((current) => current.map((profile) => profileKey(profile) === profileKey(saved) ? saved : profile));
      setDraft((current) => ({ ...current, enabled: saved.enabled }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setToggling(false);
    }
  };

  const toggleBuiltInSubagents = async (enabled: boolean) => {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const response = await fetch("/api/subagents/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
      if (!response.ok || data.error || typeof data.enabled !== "boolean") {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setBuiltInEnabled(data.enabled);
      setReloadNeeded(Boolean(sessionId));
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSettingsSaving(false);
    }
  };

  const updateMaxConcurrent = async (value: number) => {
    setMaxConcurrent(value);
    setSettingsError(null);
    try {
      const response = await fetch("/api/subagents/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrent: value }),
      });
      const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
      if (!response.ok || data.error || typeof data.maxConcurrent !== "number") throw new Error(data.error ?? `HTTP ${response.status}`);
      setMaxConcurrent(data.maxConcurrent);
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const reloadSession = async () => {
    if (!sessionId) return;
    setReloading(true);
    setSettingsError(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      setReloadNeeded(false);
      onReloaded?.();
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReloading(false);
    }
  };

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.agents")} subtitle={cwd ? shortenPath(cwd) : undefined} closeLabel={t("agents.close")} onClose={onClose}>
      <div className="agents-feature-setting settings-feature-header" aria-busy={settingsLoading}>
        <div className="agents-feature-copy">
          <div className="agents-feature-title"><strong>{t("agents.builtInTitle")}</strong><span className={`agents-state-badge${builtInEnabled ? " is-enabled" : ""}`} role="status">{settingsLoading ? t("agents.loadingSettings") : builtInEnabled ? t("agents.state.enabled") : t("agents.state.disabled")}</span></div>
          <span role="status" className={reloadNeeded ? "agents-feature-reload-notice" : undefined}>{t(reloadNeeded ? "agents.reloadRequired" : "agents.builtInDescription")}</span>
        </div>
        <div className="agents-feature-actions">
          {reloadNeeded && sessionId && (
            <ConfigButton size="small" onClick={() => void reloadSession()} disabled={reloading || settingsSaving}>
              {reloading ? t("agents.reloading") : t("agents.reloadSession")}
            </ConfigButton>
          )}
          <label className="agents-concurrency-control" title={t("agents.maxConcurrentDescription")}>
            <span>{t("agents.maxConcurrent")}</span>
            <input
              aria-label={t("agents.maxConcurrent")}
              type="number"
              min={1}
              max={32}
              value={maxConcurrent}
              disabled={settingsLoading || settingsSaving}
              onChange={(event) => setMaxConcurrent(Number(event.target.value))}
              onBlur={() => void updateMaxConcurrent(maxConcurrent)}
            />
          </label>
          <ConfigSwitch
            checked={builtInEnabled}
            disabled={settingsLoading || reloading}
            loading={settingsSaving}
            label={t("agents.builtInTitle")}
            onChange={(enabled) => void toggleBuiltInSubagents(enabled)}
          />
        </div>
      </div>
      <div className="agents-target-toolbar">
        <ResourceInstallTarget value={installTarget.value} projects={installTarget.projects} label={t("agents.configTarget")} loadingLabel={t("agents.loading")}
          pending={busy || !!removeTarget || installTarget.selecting} loading={targetPending} error={installTarget.error}
          onChange={key => void installTarget.select(key)} />
      </div>
      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
              {loading && loadedTarget === null ? <div className="config-sidebar-message">{showLoading ? t("agents.loading") : null}</div> :
                (["builtin", "global", "project"] as const).filter(scope => scope !== "project" || configCwd !== null).map(scope => {
                  const scopedProfiles = profiles.filter(profile => scope === "project" ? profile.scope === "project" || profile.scope === "workspace" : profile.scope === scope);
                  return <section key={scope} className="config-sidebar-group" data-agent-group={scope} aria-busy={targetPending}>
                    <div className="resource-sidebar-group-header">
                      <button type="button" className="resource-sidebar-group-toggle" aria-expanded={expanded[scope]} onClick={() => setExpanded(current => ({ ...current, [scope]: !current[scope] }))}>
                        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" className={expanded[scope] ? "is-expanded" : ""}><path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg><span>{t(`agents.scope.${scope}`)}</span>
                      </button><span className="agents-group-count">{scopedProfiles.length}</span>
                    </div>
                    <div hidden={!expanded[scope]}>
                      {scopedProfiles.map(profile => {
                        const label = profilePresentation(profile, t).name;
                        const row = <ConfigSidebarItem active={selectedKey === profileKey(profile) && !creating} disabled={busy || targetPending} onClick={() => selectProfile(profile)}>
                          <ConfigStatusDot active={profile.enabled && builtInEnabled} />
                          <ConfigSidebarText className={`is-grow${profile.enabled ? "" : " is-muted"}`}>{label}</ConfigSidebarText>
                          {isSubagentProfileOverridden(profile, profiles) && <span className="agents-overridden-label">{t("agents.overridden")}</span>}
                        </ConfigSidebarItem>;
                        return isWritableScope(profile.scope) ? <ResourceSidebarRow key={profileKey(profile)} name={label} disabled={busy || targetPending}
                          onRemove={() => { setRemoveError(null); setRemoveTarget({ profile, cwd: profile.scope === "global" ? null : configCwd }); }}>{row}</ResourceSidebarRow> : <div key={profileKey(profile)}>{row}</div>;
                      })}
                      {!scopedProfiles.length && <div className="config-sidebar-message is-empty">{t(scope === "project" && !configCwd ? "agents.chooseProject" : "agents.noProfiles")}</div>}
                    </div>
                  </section>;
                })}

          </ConfigSidebarList>
          <ConfigListAction
                active={creating}
                onClick={beginCreate}
                disabled={busy || targetPending}
              >
                {t("agents.new")}
          </ConfigListAction>
        </ConfigSidebar>

        <ConfigDetail>
          <ConfigDetailStack className="is-fill">
              {!selected && !creating ? (
                <ConfigEmptyState>{t("agents.empty")}</ConfigEmptyState>
              ) : (
                <ConfigDetailStack>
                  <ConfigDetailHeader>
                    <ConfigDetailHeaderInfo>
                      {displayedScope && <ConfigScopeTag scope={displayedScope}>{t(`agents.scope.${displayedScope}`)}</ConfigScopeTag>}
                      {fullPath ? <InlineResourcePath path={fullPath} disabled={targetPending} /> : <span className="config-detail-path">{t("agents.builtinPath")}</span>}

                    </ConfigDetailHeaderInfo>
                    <ConfigDetailActions>
                      {selected && (mode === "view" || mode === "edit") && <ConfigButton size="small" onClick={beginDuplicate} disabled={busy || targetPending}>{t(mode === "view" ? "agents.duplicateEdit" : "agents.duplicate")}</ConfigButton>}
                      <span className="agents-role-state">{t(draft.enabled ? "agents.role.enabled" : "agents.role.disabled")}</span>
                      <ConfigSwitch checked={draft.enabled} disabled={switchDisabled} label={draft.enabled ? t("agents.disable") : t("agents.enable")} onChange={(checked) => void toggleEnabled(checked)} />
                    </ConfigDetailActions>
                  </ConfigDetailHeader>

                  {!editing && presentation ? (
                    <div className="agents-role-overview">
                      <div className="agents-role-heading"><h2>{presentation.name}</h2><span className="agents-permission-tag">{t(draft.tools.some(tool => tool === "edit" || tool === "write") ? "agents.permission.edit" : draft.tools.every(tool => ["read", "grep", "find", "ls"].includes(tool)) && !draft.loadExtensions && draft.mcp !== "on" ? "agents.permission.readOnly" : "agents.permission.configured")}</span></div>
                      <p>{presentation.description}</p>
                      <div className="agents-role-identity"><span>{t("agents.name")}</span><code>{draft.name}</code></div>
                      {selected?.scope === "builtin" && <p className="agents-role-hint">{t("agents.builtinHint")}</p>}
                    </div>
                  ) : <>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                      <Field label={t("agents.name")}>
                        {creating ? (
                          <input aria-label={t("agents.name")} aria-describedby="agents-profile-id-hint" placeholder={t("agents.namePlaceholder")} value={draft.name} disabled={disabled} onChange={(event) => update("name", event.target.value)} style={inputStyle} />
                        ) : (
                          <code style={{ minHeight: 34, display: "flex", alignItems: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 12 }}>
                            {draft.name}
                          </code>
                        )}
                        {creating && <span id="agents-profile-id-hint" className="agents-field-hint">{t("agents.nameHint")}</span>}
                      </Field>
                      <Field label={t("agents.displayName")}>
                        <input aria-label={t("agents.displayName")} placeholder={t("agents.displayNamePlaceholder")} value={draft.displayName} disabled={disabled} onChange={(event) => update("displayName", event.target.value)} style={controlStyle} />
                      </Field>
                    </div>
                    <Field label={t("agents.description")}>
                      <input aria-label={t("agents.description")} placeholder={t("agents.descriptionPlaceholder")} value={draft.description} disabled={disabled} onChange={(event) => update("description", event.target.value)} style={controlStyle} />
                    </Field>
                  </>}
                  <Field label={t("agents.prompt")}>
                    {!editing ? <pre className="agents-prompt-preview" aria-label={t("agents.prompt")} tabIndex={0}>{presentation?.systemPrompt ?? draft.systemPrompt}</pre> : (
                      <textarea className="agents-system-prompt" aria-label={t("agents.prompt")} placeholder={t("agents.promptPlaceholder")} value={draft.systemPrompt} disabled={disabled} onChange={(event) => update("systemPrompt", event.target.value)} style={{ ...controlStyle, height: 132, minHeight: 108, maxHeight: "40vh", padding: 9, overflow: "auto", resize: disabled ? "none" : "vertical", lineHeight: 1.5 }} />
                    )}
                  </Field>

                  <Field label={t("agents.tools")}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px" }}>
                      {!editing ? draft.tools.map(tool => <code key={tool} className="agents-tool-tag">{tool}</code>) : TOOL_OPTIONS.map((tool) => (
                        <Toggle key={tool} label={tool} disabled={disabled} checked={draft.tools.includes(tool)} onChange={(checked) => update("tools", checked ? [...draft.tools, tool] : draft.tools.filter((item) => item !== tool))} />
                      ))}
                    </div>
                  </Field>

                  <Field label={t("agents.resources")}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
                      {!editing ? <span className="agents-readonly-value">{[
                        draft.loadSkills && t("agents.loadSkills"), draft.loadExtensions && t("agents.loadExtensions"), draft.mcp === "on" && t("agents.mcp"),
                      ].filter(Boolean).join(" · ") || t("agents.resources.none")}</span> : <>
                        <Toggle label={t("agents.loadSkills")} disabled={disabled} checked={draft.loadSkills} onChange={(checked) => update("loadSkills", checked)} />
                        <Toggle label={t("agents.loadExtensions")} disabled={disabled} checked={draft.loadExtensions} onChange={(checked) => update("loadExtensions", checked)} />
                        {/* A chat-only child cannot start with MCP on; the switch still turns it off. */}
                        <Toggle label={t("agents.mcp")} disabled={disabled || (chatOnlyDraft && draft.mcp !== "on")} checked={draft.mcp === "on"} onChange={(checked) => update("mcp", checked ? "on" : "off")} />
                      </>}
                    </div>
                    {/* `skills:` and `extensions:` lists are edited in the profile file; show what they load. */}
                    {draft.loadSkills && draft.skills !== undefined && (
                      <span style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                        {draft.skills.length > 0
                          ? t("agents.skillsOnly", { skills: draft.skills.join(", ") })
                          : t("agents.skillsNone")}
                      </span>
                    )}
                    {draft.loadExtensions && draft.extensions !== undefined && (
                      <span style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                        {draft.extensions.length > 0
                          ? t("agents.extensionsOnly", { extensions: draft.extensions.join(", ") })
                          : t("agents.extensionsNone")}
                      </span>
                    )}
                    {!disabled && chatOnlyDraft ? (
                      <span style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4 }}>
                        {t("agents.mcpChatOnly")}
                      </span>
                    ) : draft.mcp === "on" && (
                      <span style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4 }}>
                        {t("agents.mcpHint")}
                      </span>
                    )}
                  </Field>

                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.5fr) minmax(120px, 1fr)", gap: 12 }}>
                    <Field label={t("agents.model")}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <ModelSelector
                          options={modelSelectorOptions}
                          value={selectedModel}
                          onChange={(provider, modelId) => update("model", `${provider}/${modelId}`)}
                          onClear={() => update("model", undefined)}
                          emptyLabel={modelsLoading ? t("agents.modelsLoading") : t("agents.inherit")}
                          selectedLabel={draft.model && !selectedModelAvailable
                            ? t("agents.modelUnavailable", { model: draft.model })
                            : draft.model !== draftModelBase ? draft.model : undefined}
                          disabled={disabled || modelsLoading || (modelOptions.length === 0 && !draft.model)}
                          ariaLabel={t("agents.model")}
                          variant="field"
                          placement="auto"
                        />
                        {modelsError && <span style={{ color: "#ef4444", fontSize: 10 }}>{modelsError}</span>}
                      </div>
                    </Field>
                    <Field label={t("agents.thinking")}>
                      <select aria-label={t("agents.thinking")} value={draft.thinking ?? ""} disabled={disabled} onChange={(event) => update("thinking", (event.target.value || undefined) as EditableProfile["thinking"])} style={controlStyle}>
                        {THINKING_OPTIONS.map((value) => <option key={value || "default"} value={value}>{value || t("agents.inherit")}</option>)}
                      </select>
                    </Field>

                  </div>

                  <details className="agents-advanced" key={creating ? "create" : selectedKey}>
                    <summary>{t("agents.advanced")}<span>{t("agents.advancedHint")}</span></summary>
                    <div className="config-detail-stack agents-advanced-content">
                      <Field label={t("agents.codemode")}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <select
                            aria-label={t("agents.codemode")}
                            value={draft.codemode ?? "off"}
                            disabled={disabled}
                            onChange={(event) => update("codemode", event.target.value as EditableProfile["codemode"])}
                            style={{ ...controlStyle, width: "auto", minWidth: 180, alignSelf: "flex-start" }}
                          >
                            <option value="inherit">{t("agents.codemode.inherit")}</option>
                            <option value="on">{t("agents.codemode.on")}</option>
                            <option value="off">{t("agents.codemode.off")}</option>
                          </select>
                          <span style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4 }}>
                            {t("agents.codemodeHint")}
                          </span>
                        </div>
                      </Field>

                        <Field label={t("agents.maxTurns")}>
                          <input aria-label={t("agents.maxTurns")} type="number" min={1} value={draft.maxTurns ?? ""} disabled={disabled} onChange={(event) => update("maxTurns", event.target.value ? Number(event.target.value) : undefined)} style={controlStyle} />
                        </Field>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 20px" }}>
                        <Toggle label={t("agents.inheritContext")} disabled={disabled} checked={draft.inheritContext} onChange={(checked) => update("inheritContext", checked)} />
                        <Toggle label={t("agents.background")} disabled={disabled} checked={draft.runInBackground} onChange={(checked) => update("runInBackground", checked)} />
                      </div>
                    </div>
                  </details>
                </ConfigDetailStack>
              )}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigSplitView>
      <ConfigFooter status={(settingsError || error) && <span role="alert" style={{ color: "#ef4444" }}>{settingsError || error}</span>}>
        {error && !loading && <ConfigButton disabled={busy} onClick={() => void loadProfiles()}>{t("common.retry")}</ConfigButton>}
        {editing && (
          <ConfigButton
            variant="primary"
            onClick={() => void save()}
            disabled={busy || targetPending || savedOk || !draft.name.trim()}
            className={savedOk ? "is-success" : undefined}
          >
            {savedOk && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="config-button-success-icon">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            <span>{savedOk ? t("i18n.saved") : saving ? t("agents.saving") : t("agents.save")}</span>
          </ConfigButton>
        )}
      </ConfigFooter>
      {removeTarget && <ResourceRemoveDialog name={profilePresentation(removeTarget.profile, t).name} busy={removing} error={removeError}
        description={t("agents.removeDescription", { scope: removeTarget.profile.scope === "global" ? t("agents.scope.global") : installTarget.projects.find(project => project.cwd === removeTarget.cwd)?.name ?? t("agents.scope.project") })}
        onCancel={() => { if (!removing) setRemoveTarget(null); }} onConfirm={() => void remove()} />}
    </ConfigPanelShell>
  );
}
