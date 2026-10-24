"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { CopyButton } from "./CopyButton";
import { ResourceRemoveDialog } from "./ResourceRemoveDialog";
import { ResourceSidebarGroups, ResourceSidebarRow } from "./ResourceSidebarGroups";
import { RESOURCE_GROUPS, resourceGroup } from "@/lib/resource-sidebar";
import type {
  SkillInfo as Skill,
  SkillsResponse,
  SkillToggleResult,
  SkillUpdateResult,
  ProjectTrustStatus,
} from "@/lib/api-types";
import { shortenPath } from "@/lib/display-path";
import { parseFrontmatter } from "@/lib/frontmatter";
import {
  ConfigButton,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigField,
  ConfigFooter,
  ConfigPanelShell,
  ConfigScopeTag,
  ConfigSidebar,
  ConfigSidebarGroupStatus,
  ConfigSidebarGroupSwitch,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
} from "./SettingsUi";
import { itemsToSwitch, projectTrustReloadKey } from "./settings-ui-helpers";
import { MarkdownBody } from "./MarkdownBody";
import { ResourcePath } from "./ResourcePath";
import { SkillCatalog } from "./SkillCatalog";
import { loadInstalledSkillContent, invalidateInstalledSkillContent } from "@/lib/skills-browser-cache";

type SkillScope = "global" | "project" | "path";
type Translate = ReturnType<typeof useI18n>["t"];

function sourceLabel(skill: Skill): SkillScope {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

function scopeLabel(scope: SkillScope, t: Translate): string {
  if (scope === "project") return t("skills.scope.project");
  if (scope === "global") return t("skills.scope.global");
  return t("skills.scope.path");
}

export function orderSkillsByDormancy<
  T extends Pick<Skill, "disableModelInvocation">,
>(skills: T[]): T[] {
  return [
    ...skills.filter((skill) => !skill.disableModelInvocation),
    ...skills.filter((skill) => skill.disableModelInvocation),
  ];
}

/**
 * The skills a group switch would change: those of the group not already in
 * the requested state.
 */
export function skillsToSwitch<
  T extends Pick<Skill, "disableModelInvocation">,
>(skills: T[], enabled: boolean): T[] {
  return itemsToSwitch(skills, enabled, (skill) => !skill.disableModelInvocation);
}

/** Applies a bulk toggle's results; a skill whose file reported an error keeps its state. */
export function applySkillToggleResults<
  T extends Pick<Skill, "filePath" | "disableModelInvocation">,
>(skills: T[], results: SkillToggleResult[], disableModelInvocation: boolean): T[] {
  const changed = new Set(results.filter((result) => !result.error).map((result) => result.filePath));
  return skills.map((skill) =>
    changed.has(skill.filePath) ? { ...skill, disableModelInvocation } : skill,
  );
}

function updateKey(skill: Skill): string | null {
  return skill.install
    ? `${skill.install.scope}\0${skill.install.package}`
    : null;
}

function shortVersion(version: string | undefined, unknown: string): string {
  return version ? version.slice(0, 8) : unknown;
}

export function skillInstructionsBody(content: string): string {
  return parseFrontmatter(content).rest.trim();
}

function SkillDetail({
  skill,
  cwd,
  onToggle,
  toggling,
  saveError,
  updateStatus,
  checkingUpdate,
  updating,
  updateError,
  onCheckUpdate,
  onUpdate,
}: {
  skill: Skill;
  cwd: string | null;
  onToggle: (skill: Skill) => void;
  toggling: boolean;
  saveError: string | null;
  updateStatus?: SkillUpdateResult;
  checkingUpdate: boolean;
  updating: boolean;
  updateError: string | null;
  onCheckUpdate: () => void;
  onUpdate: () => void;
}) {
  const { t } = useI18n();
  const label = sourceLabel(skill);
  const enabled = !skill.disableModelInvocation;
  const [instructions, setInstructions] = useState<string | null>(null);
  const [instructionsError, setInstructionsError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setInstructions(null);
    setInstructionsError(null);

    const load = async () => {
      try {
        const data = await loadInstalledSkillContent(cwd, skill.filePath, controller.signal);
        if (controller.signal.aborted) return;
        setInstructions(skillInstructionsBody(data.content));
      } catch (error) {
        if (controller.signal.aborted) return;
        setInstructionsError(error instanceof Error ? error.message : String(error));
      }
    };

    void load();
    return () => controller.abort();
  }, [cwd, skill.filePath]);

  return (
    <ConfigDetailStack>
      {/* Path + tag + toggle, with a stable status row below. */}
      <div className="skill-detail-heading">
        <ConfigDetailHeader>
          <ConfigDetailHeaderInfo>
            <ConfigScopeTag scope={label}>{scopeLabel(label, t)}</ConfigScopeTag>
            <ResourcePath path={skill.filePath} />
          </ConfigDetailHeaderInfo>
          <ConfigDetailActions>
            <ConfigSwitch
              checked={enabled}
              loading={toggling}
              label={enabled ? t("i18n.visibleInPrompt") : t("i18n.hiddenFromPrompt")}
              onChange={() => onToggle(skill)}
            />
          </ConfigDetailActions>
        </ConfigDetailHeader>
        <div className="skill-detail-status-row">
          {!enabled && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {t("i18n.hiddenButInvocable")}
            </span>
          )}
          {saveError && (
            <span style={{ fontSize: 12, color: "#f87171", overflowWrap: "anywhere" }}>
              {saveError}
            </span>
          )}
        </div>
      </div>

      {skill.install?.skillsShUrl && (
        <ConfigField label={t("config.source")}>
          <a
            href={skill.install.skillsShUrl}
            target="_blank"
            rel="noreferrer"
            title={skill.install.skillsShUrl}
            className="skill-source-link"
          >
            <span className="skill-source-link-text">
              {skill.install.skillsShUrl.replace(/^https?:\/\//, "")} ↗
            </span>
          </a>
        </ConfigField>
      )}

      {skill.install && (
        <ConfigField label={t("i18n.version")}>
          <div className="skill-version-row">
            <span className="skill-version-value">
              {shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash, t("i18n.unknown"))}
            </span>
            {skill.install.canCheckForUpdates && (
              <ConfigButton
                size="small"
                onClick={onCheckUpdate}
                disabled={checkingUpdate || updating}
              >
                 {t("i18n.check")}
              </ConfigButton>
            )}
            {updateStatus?.state === "update-available" && (
              <span className="skill-version-value is-update">
                {shortVersion(updateStatus.latestVersion, t("i18n.unknown"))}
              </span>
            )}
            {(checkingUpdate ||
              (updateStatus && updateStatus.state !== "update-available")) && (
              <span
                className={`skill-update-status ${checkingUpdate
                  ? "is-checking"
                  : updateStatus?.state === "up-to-date"
                    ? "is-success"
                    : updateStatus?.state === "error"
                      ? "is-error"
                      : "is-muted"}`}
              >
                {checkingUpdate
                   ? t("i18n.checking")
                  : updateStatus?.state === "up-to-date"
                     ? t("i18n.upToDate")
                    : updateStatus?.state === "unsupported"
                         ? t("i18n.automaticChecksUnavailable")
                         : updateStatus?.message || t("i18n.checkFailed")}
              </span>
            )}
            {updateStatus?.state === "update-available" && (
              <ConfigButton
                variant="primary"
                size="small"
                onClick={onUpdate}
                disabled={updating || checkingUpdate}
              >
                 {updating ? t("i18n.updating") : t("i18n.update")}
              </ConfigButton>
            )}
          </div>
          {updateError && (
            <span style={{ fontSize: 12, color: "#ef4444" }}>{updateError}</span>
          )}
        </ConfigField>
      )}

      <ConfigField label={t("config.name")}>
        <span className="skill-name-value">
          {skill.name}
        </span>
      </ConfigField>

      <ConfigField label={t("i18n.description")}>
        <span className="skill-description">
          {skill.description}
        </span>
      </ConfigField>

      <ConfigField label={t("skills.instructions")}>
        {instructionsError ? (
          <span role="alert" className="skill-instructions-status is-error">{instructionsError}</span>
        ) : instructions === null ? (
          <span role="status" className="skill-instructions-status">{t("i18n.loading")}</span>
        ) : instructions ? (
          <MarkdownBody className="skill-instructions" cwd={skill.baseDir}>
            {instructions}
          </MarkdownBody>
        ) : (
          <span className="skill-instructions-status">{t("skills.noInstructions")}</span>
        )}
      </ConfigField>
    </ConfigDetailStack>
  );
}

export function SkillsConfig({
  cwd,
  onClose,
  embedded = false,
  active = true,
  workspace = false,
  trust,
  targetScope,
  targetPending = false,
  renderInstallTarget,
}: {
  cwd: string | null;
  onClose: () => void;
  embedded?: boolean;
  active?: boolean;
  workspace?: boolean;
  /** The page's trust status for `cwd`; a new decision loads the list again. */
  trust?: ProjectTrustStatus | null;
  targetScope?: "global" | "project";
  renderInstallTarget?: (path?: string, state?: { loading?: boolean; busy?: boolean }) => ReactNode;
  targetPending?: boolean;
}) {
  const { t } = useI18n();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loadedCwd, setLoadedCwd] = useState<string | null>();
  const switchingTarget = loadedCwd !== cwd;
  const resourcePending = targetPending || switchingTarget;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  // The group switch that is running, and what the last one left undone.
  const [bulkGroup, setBulkGroup] = useState<string | null>(null);
  const [groupStatus, setGroupStatus] = useState<{ group: string; error: string } | null>(null);
  const [mobileList, setMobileList] = useState(false);
  const [catalogBrowse, setCatalogBrowse] = useState(0);
  const returnToCatalog = () => { setSelected(null); setMobileList(false); setCatalogBrowse(value => value + 1); };
  const [filter, setFilter] = useState("");
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmController = useRef<AbortController | null>(null);
  const stopWarm = () => { if (warmTimer.current) clearTimeout(warmTimer.current); warmController.current?.abort(); };
  const warmSkill = (skill: Skill) => {
    stopWarm();
    warmTimer.current = setTimeout(() => {
      const controller = new AbortController(); warmController.current = controller;
      void loadInstalledSkillContent(cwd, skill.filePath, controller.signal).catch(() => {});
    }, 180);
  };
  useEffect(() => () => { if (warmTimer.current) clearTimeout(warmTimer.current); warmController.current?.abort(); }, []);
  useEffect(() => { if (active) { setSelected(null); setMobileList(false); } }, [active]);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, SkillUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [projectResourcesLoaded, setProjectResourcesLoaded] = useState(true);
  const [globalSkillsPath, setGlobalSkillsPath] = useState("~/.pi/agent/skills/");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const loadSequence = useRef(0);
  const currentCwd = useRef(cwd);
  useEffect(() => { currentCwd.current = cwd; }, [cwd]);
  const loadSkills = useCallback(async () => {
    if (currentCwd.current !== cwd) return [];
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`);
      const d = (await res.json()) as Partial<SkillsResponse> & { error?: string };
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      const list = d.skills ?? [];
      if (sequence !== loadSequence.current || currentCwd.current !== cwd) return list;
      setSkills(list);
      setLoadedCwd(cwd);
      setGlobalSkillsPath(d.globalSkillsPath ?? "~/.pi/agent/skills/");
      setProjectResourcesLoaded(d.projectResourcesLoaded ?? true);
      setSelected((current) => {
        if (current && list.some((skill) => skill.filePath === current)) return current;
        return null;
      });
      return list;
    } catch (e) {
      if (sequence === loadSequence.current && currentCwd.current === cwd) setError(String(e));
      throw e;
    } finally {
      if (sequence === loadSequence.current && currentCwd.current === cwd) setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    setSaveError(null); setRemoveError(null); setConfirmRemove(null);
    void loadSkills().catch(() => {});
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeSelectedSkill = async (skill: Skill) => {
    if (removing) return;
    setRemoving(true); setRemoveError(null);
    try {
      const response = await fetch("/api/skills", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filePath: skill.filePath, cwd }) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error ?? `HTTP ${response.status}`);
      invalidateInstalledSkillContent(cwd, skill.filePath);
      await loadSkills();
      setConfirmRemove(null); if (selected === skill.filePath) returnToCatalog();
    } catch (error) { setRemoveError(error instanceof Error ? error.message : String(error)); }
    finally { setRemoving(false); }
  };

  // Whether the project's skills load follows its trust, which can change while
  // this section stays mounted (hidden) in Settings: trusting from Settings ›
  // MCP. A new decision loads the list again in place, keeping the selection and
  // any update checks; the first load is the effect above.
  const trustKey = projectTrustReloadKey(trust);
  const loadedTrustKeyRef = useRef(trustKey);
  useEffect(() => {
    if (loadedTrustKeyRef.current === trustKey) return;
    loadedTrustKeyRef.current = trustKey;
    if (trust && loadedCwd === cwd && trust.trusted !== projectResourcesLoaded) void loadSkills().catch(() => {});
  }, [trustKey, loadSkills, trust, loadedCwd, cwd, projectResourcesLoaded]);


  const checkForUpdates = useCallback(async (skill?: Skill) => {
    const targets = skill
      ? [skill]
      : skills.filter((item) => Boolean(item.install));
    const keys = targets
      .map(updateKey)
      .filter((key): key is string => Boolean(key));
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!skill) setCheckingAll(true);
    try {
      const res = await fetch("/api/skills/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill?.install?.package,
          scope: skill?.install?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: SkillUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[`${update.scope}\0${update.package}`] = update;
        }
        return next;
      });
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!skill) setCheckingAll(false);
    }
  }, [cwd, skills]);

  const updateInstalledSkill = useCallback(async (skill: Skill) => {
    if (!skill.install) return;
    const key = updateKey(skill)!;
    setUpdatingSkill(key);
    setUpdateError(null);
    try {
      const res = await fetch("/api/skills/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill.install.package,
          scope: skill.install.scope,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        skill?: Skill;
        error?: string;
      };
      if (!res.ok || data.error || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      invalidateInstalledSkillContent(cwd, skill.filePath);
      await loadSkills();
      const versionHash = data.skill?.install?.versionHash;
      setUpdateStatuses((current) => ({
        ...current,
        [key]: {
          package: skill.install!.package,
          scope: skill.install!.scope,
          state: "up-to-date",
          currentVersion: versionHash,
          latestVersion: versionHash,
        },
      }));
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingSkill(null);
    }
  }, [cwd, loadSkills]);

  const toggle = useCallback(async (skill: Skill) => {
    const next = !skill.disableModelInvocation;
    setToggling((s) => new Set(s).add(skill.filePath));
    setSaveError(null);
    setGroupStatus(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: skill.filePath,
          disableModelInvocation: next,
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setSkills((prev) =>
        prev.map((s) =>
          s.filePath === skill.filePath
            ? { ...s, disableModelInvocation: next }
            : s,
        ),
      );
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(skill.filePath);
        return n;
      });
    }
  }, []);

  // One PATCH for the whole group: each file is edited on its own and
  // reported separately, so the skills the route refuses keep their state and
  // are named under the group heading while the rest switch.
  const setGroupSkills = useCallback(async (group: string, groupSkills: Skill[], enabled: boolean) => {
    const targets = skillsToSwitch(groupSkills, enabled);
    if (targets.length === 0) return;
    const filePaths = targets.map((skill) => skill.filePath);
    const disableModelInvocation = !enabled;
    setToggling((current) => new Set([...current, ...filePaths]));
    setBulkGroup(group);
    setSaveError(null);
    setGroupStatus(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePaths, disableModelInvocation }),
      });
      const d = (await res.json()) as { results?: SkillToggleResult[]; error?: string };
      if (!res.ok || d.error || !d.results) throw new Error(d.error ?? `HTTP ${res.status}`);
      const results = d.results;
      setSkills((prev) => applySkillToggleResults(prev, results, disableModelInvocation));
      const failures = results.filter((result) => result.error);
      if (failures.length > 0) {
        const names = new Map(targets.map((skill) => [skill.filePath, skill.name]));
        setGroupStatus({
          group,
          error: [
            t("skills.bulkFailed", { count: failures.length, total: results.length }),
            ...failures.map((failure) => `${names.get(failure.filePath) ?? failure.filePath}: ${failure.error}`),
          ].join("\n"),
        });
      }
    } catch (e) {
      setGroupStatus({ group, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBulkGroup(null);
      setToggling((current) => {
        const next = new Set(current);
        for (const filePath of filePaths) next.delete(filePath);
        return next;
      });
    }
  }, [t]);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;
  const removalSkill = skills.find(skill => skill.filePath === confirmRemove);
  const targetBusy = toggling.size > 0 || updatingSkill !== null || removing || checkingUpdates.size > 0;
  const bulkBusy = resourcePending || loading || toggling.size > 0 || updatingSkill !== null || removing;

  return (
    <div className={`skills-config${workspace ? " is-workspace" : ""}${mobileList ? " is-list" : ""}`}><ConfigPanelShell embedded={embedded} title={t("common.skills")} subtitle={cwd ? shortenPath(cwd) : undefined} closeLabel={t("i18n.close")} onClose={onClose}>



        {/* Body */}
        <ConfigSplitView>
          {/* Left: skill list */}
          <ConfigSidebar>
            <div className="skills-installed-search"><label><span>{t("skills.catalog.installed")} <small>{loadedCwd === undefined ? "—" : skills.length}</small></span><input type="search" className="plugins-search-input" aria-label={t("skills.catalog.filter")} placeholder={t("skills.catalog.filter")} value={filter} onChange={event => setFilter(event.target.value)} /></label></div>
            <div className="resource-installed-list" aria-busy={loading || resourcePending}><ConfigSidebarList>
              {loading && skills.length === 0 ? (
                <div className="config-sidebar-message">
                   {t("i18n.loading")}
                </div>
              ) : error && loadedCwd === undefined ? (
                <div className="config-sidebar-message is-error">
                  {error}
                </div>
              ) : skills.length === 0 ? (
                <div className="config-sidebar-message is-empty">
                   {t("i18n.noSkills")}
                </div>
              ) : !skills.some(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())) ? (
                <div className="config-sidebar-message is-empty">{t("skills.catalog.empty")}</div>
              ) : (
                (() => {
                  const groups = RESOURCE_GROUPS.map(id => ({ id, label: t(id === "external" ? "resources.external" : id === "global" ? "skills.scope.global" : "skills.scope.project"), skills: skills.filter(skill => resourceGroup(sourceLabel(skill), skill.installOrigin) === id) }))
                    .filter(group => group.skills.some(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())));
                  const renderSkillRow = (skill: Skill) => {
                    const isSelected =
                      selected === skill.filePath;
                    const disabled = skill.disableModelInvocation;
                    return (
                      <ResourceSidebarRow key={skill.filePath} name={skill.name} disabled={bulkBusy || !skill.canRemove} reason={!skill.canRemove ? t("skills.removeManaged") : undefined} onRemove={() => { setRemoveError(null); setConfirmRemove(skill.filePath); }}>
                      <ConfigSidebarItem disabled={resourcePending}
                        active={isSelected}
                        onPointerEnter={() => warmSkill(skill)} onPointerLeave={stopWarm} onFocus={() => warmSkill(skill)} onBlur={stopWarm}
                        onClick={() => {
                          setSelected(current => current === skill.filePath ? null : skill.filePath);
                          setMobileList(false); setCatalogBrowse(value => value + 1);
                          stopWarm();
                        }}
                      >
                        <ConfigStatusDot active={!disabled} />
                        <ConfigSidebarText className={`is-grow${disabled ? " is-muted" : ""}`}>
                          {skill.name}
                        </ConfigSidebarText>
                        {sourceLabel(skill) === "project" && <span className="resource-origin-tag">{t(skill.installOrigin === "app" ? "resources.appInstalled" : "resources.external")}</span>}
                        {(() => {
                          const key = updateKey(skill);
                          const status = key ? updateStatuses[key] : undefined;
                          if (status?.state !== "update-available") return null;
                          return (
                            <span title={t("i18n.updateAvailable")} className="skill-update-indicator">
                              ↑
                            </span>
                          );
                        })()}
                      </ConfigSidebarItem></ResourceSidebarRow>
                    );
                  };
                  return <ResourceSidebarGroups kind="skills" searching={!!filter.trim()} groups={groups.map(({ id, label, skills: groupSkills }) => {
                    const enabled = groupSkills.filter(skill => !skill.disableModelInvocation).length;
                    return { id, label, controls: <ConfigSidebarGroupSwitch enabled={enabled} total={groupSkills.length} disabled={bulkBusy} loading={bulkGroup === id} label={t(enabled === groupSkills.length ? "skills.groupSwitchOn" : "skills.groupSwitchOff", { group: label })} onChange={value => void setGroupSkills(id, groupSkills, value)} />,
                      status: groupStatus?.group === id && <ConfigSidebarGroupStatus error={groupStatus.error} />,
                      children: orderSkillsByDormancy(groupSkills).filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())).map(renderSkillRow) };
                  })} />;
                })()
              )}
            </ConfigSidebarList></div>
          </ConfigSidebar>

          {/* Right: detail or add panel */}
          <div className="skills-content">
            <div className="skills-catalog-host" hidden={selectedSkill !== null}>
              <SkillCatalog
                globalSkillsPath={globalSkillsPath}
                active={active && selectedSkill === null}
                sectionActive={active}
                resetKey={catalogBrowse}
                navigation={<button type="button" className="skills-list-back" onClick={() => setMobileList(true)}>{t("skills.catalog.installed")} ({skills.length})</button>}
                cwd={cwd}
                targetScope={targetScope}
                targetPending={resourcePending || !!error}
                renderInstallTarget={renderInstallTarget ? (path, state) => renderInstallTarget(path, { loading: loading || (resourcePending && !error) || state?.loading, busy: targetBusy || state?.busy }) : undefined}
                projectResourcesLoaded={projectResourcesLoaded && (targetScope !== "project" || trust?.trusted === true)}
                installedSkills={skills}
                onOpenInstalled={filePath => { setSelected(filePath); setMobileList(false); stopWarm(); }}
                installedPackages={{
                  global: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "global")
                      .map((skill) => skill.install!.package),
                  ),
                  project: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "project")
                      .map((skill) => skill.install!.package),
                  ),
                }}
                onInstalled={loadSkills}
              />
            </div>
            {selectedSkill && <div className="skills-installed-view" key={selectedSkill.filePath}>
              <div className="skills-installed-toolbar"><button type="button" className="skills-list-back" onClick={() => setMobileList(true)}>{t("skills.catalog.installed")} ({skills.length})</button><ConfigButton size="small" onClick={returnToCatalog}>{t("resources.back")}</ConfigButton><span className="resource-name-row"><strong>{selectedSkill.name}</strong><CopyButton value={selectedSkill.name} /></span></div>
              {!selectedSkill.canRemove && <p className="skills-removal-note">{t("skills.removeManaged")}</p>}

              {removeError && <p role="alert" className="skills-install-error">{removeError}</p>}
              <div className="skills-installed-detail">
              <SkillDetail
                key={selectedSkill.filePath}
                skill={selectedSkill}
                cwd={cwd}
                onToggle={toggle}
                toggling={resourcePending || toggling.has(selectedSkill.filePath)}
                saveError={saveError}
                updateStatus={
                  updateKey(selectedSkill)
                    ? updateStatuses[updateKey(selectedSkill)!]
                    : undefined
                }
                checkingUpdate={
                  updateKey(selectedSkill)
                    ? checkingUpdates.has(updateKey(selectedSkill)!)
                    : false
                }
                updating={updatingSkill === updateKey(selectedSkill)}
                updateError={updateError}
                onCheckUpdate={() => void checkForUpdates(selectedSkill)}
                onUpdate={() => void updateInstalledSkill(selectedSkill)}
              />
            </div></div>}
          </div>
        </ConfigSplitView>

        {removalSkill && <ResourceRemoveDialog name={removalSkill.name} description={t("skills.removeConfirm", { name: removalSkill.name })} busy={removing} error={removeError} onCancel={() => setConfirmRemove(null)} onConfirm={() => void removeSelectedSkill(removalSkill)} />}

        {error && loadedCwd !== undefined && <p className="resource-load-error" role="alert">{error}<ConfigButton size="small" onClick={() => void loadSkills().catch(() => {})}>{t("plugins.retry")}</ConfigButton></p>}
        {/* Footer */}
        <ConfigFooter status={<><span>{t("skills.catalog.installedCount", { count: skills.length })}</span>{
            Object.values(updateStatuses).filter(
              (status) => status.state === "update-available",
            ).length > 0 && (
              <span style={{ fontSize: 12, color: "#d97706" }}>
                {
                  Object.values(updateStatuses).filter(
                    (status) => status.state === "update-available",
                  ).length
                }{" "}
                {Object.values(updateStatuses).filter(
                  (status) => status.state === "update-available",
                ).length === 1
                   ? t("i18n.update")
                   : t("i18n.updates")}
              </span>
            )}</>}
        >
          {!embedded && <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>}
          {skills.some((skill) => Boolean(skill.install)) && (
            <ConfigButton variant="secondary" onClick={() => void checkForUpdates()} disabled={resourcePending || checkingAll || updatingSkill !== null}>
              {checkingAll ? t("i18n.checking") : t("i18n.checkUpdates")}
            </ConfigButton>
          )}
        </ConfigFooter>
    </ConfigPanelShell></div>
  );
}
