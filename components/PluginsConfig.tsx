"use client";

import { useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { invalidateResourceOverviews, peekResourceOverview, readResourceOverview } from "@/lib/resource-overview-cache";
import { useDeferredLoading } from "@/hooks/useDeferredLoading";
import { useInstallTasks } from "@/hooks/useInstallTasks";
import { ResourcePath } from "./ResourcePath";
import { CopyButton } from "./CopyButton";
import { ResourceRemoveDialog } from "./ResourceRemoveDialog";
import { ResourceSidebarGroups, ResourceSidebarRow } from "./ResourceSidebarGroups";
import { RESOURCE_GROUPS, resourceGroup } from "@/lib/resource-sidebar";
import { findInstalledCatalogPlugin } from "@/lib/plugin-selection";
import { sendAgentCommand } from "@/lib/agent-client";
import type {
  PluginPackageInfo,
  PluginStandaloneExtensionInfo,
  PluginUpdateResult,
  PluginsBulkResponse,
  PluginsResponse,
  ProjectTrustStatus,
} from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import {
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailGrid,
  ConfigDetailGridRow,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigFooter,
  ConfigFooterStatus,
  ConfigPanelShell,
  ConfigScopeTag,
  ConfigSidebar,
  ConfigSidebarGroupStatus,
  ConfigSidebarGroupSwitch,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSectionTitle,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
} from "./SettingsUi";
import { parseNpmSource } from "@/lib/npm-source";
import type { CatalogPlugin, PluginCatalogPage } from "@/lib/plugin-catalog";
import type { PluginSourceDetail } from "@/lib/plugin-detail";
import { loadPluginPage, peekPluginPage, loadBrowserPluginDetail, peekPluginDetail, warmPluginDetail, loadBrowserPluginLogos } from "@/lib/plugin-browser-cache";
import { PluginSourceInfo } from "./PluginSourceInfo";
import { PluginLogo } from "./PluginLogo";
import { PluginDescription } from "./PluginDescription";
import { ConfigScopeSwitch } from "./SettingsUi";
import { itemsToSwitch, projectTrustReloadKey } from "./settings-ui-helpers";

type PluginScope = PluginPackageInfo["scope"];
type PluginAction = "install" | "remove" | "update" | "disable" | "enable";
type Translate = ReturnType<typeof useI18n>["t"];

function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

/**
 * The packages a scope's group switch would change: those not already in the
 * requested state. Standalone extensions have no switch here, so they are
 * never included. Switching a group off also leaves out a filtered package:
 * disabling empties its resource lists and nothing keeps the filters, so that
 * stays a decision for its own switch.
 */
export function packagesToSwitch<T extends Pick<PluginPackageInfo, "disabled" | "filtered">>(
  packages: T[],
  enabled: boolean,
): T[] {
  return itemsToSwitch(packages, enabled, (pkg) => !pkg.disabled, (pkg) => pkg.filtered);
}

/** Enabled filtered packages, which switching their group off leaves on. */
export function filteredPackagesKeptOn<T extends Pick<PluginPackageInfo, "disabled" | "filtered">>(
  packages: T[],
): T[] {
  return packages.filter((pkg) => !pkg.disabled && pkg.filtered);
}

function extensionKey(extension: PluginStandaloneExtensionInfo): string {
  return `extension\0${extension.path}`;
}

function scopeLabel(scope: PluginScope, t: Translate): string {
  return scope === "project" ? t("skills.scope.project") : t("skills.scope.global");
}

/** A package status as shown; English keeps the lower-case API value. */
function statusLabel(status: PluginPackageInfo["status"], t: Translate): string {
  if (status === "loaded") return t("plugins.resourcesReady");
  return t(`plugins.status.${status}`);
}

/** The footer's resource totals, in the order of a package's resource summary. */
function totalsSummary(totals: PluginsResponse["totals"], t: Translate): string {
  return [
    t("i18n.resourceCount", { count: totals.extensions, label: t("i18n.extensionShort") }),
    t("i18n.resourceCount", { count: totals.skills, label: t("i18n.skillShort") }),
    t("i18n.resourceCount", { count: totals.prompts, label: t("i18n.promptShort") }),
    t("i18n.resourceCount", { count: totals.themes, label: t("i18n.themeShort") }),
  ].join(" · ");
}

function diagnosticText(diagnostic: PluginsResponse["diagnostics"][number]): string {
  return `${diagnostic.type}: ${diagnostic.source ? `${diagnostic.source}: ` : ""}${diagnostic.message}`;
}

function resourceSummary(pkg: PluginPackageInfo, t: Translate): string {
  if (pkg.disabled) return t("i18n.disabled");
  const parts = [
    pkg.counts.extensions ? t("i18n.resourceCount", { count: pkg.counts.extensions, label: t("i18n.extensionShort") }) : "",
    pkg.counts.skills ? t("i18n.resourceCount", { count: pkg.counts.skills, label: t("i18n.skillShort") }) : "",
    pkg.counts.prompts ? t("i18n.resourceCount", { count: pkg.counts.prompts, label: t("i18n.promptShort") }) : "",
    pkg.counts.themes ? t("i18n.resourceCount", { count: pkg.counts.themes, label: t("i18n.themeShort") }) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("i18n.noResources");
}

function versionSummary(pkg: PluginPackageInfo, t: Translate): string {
  const parts = [];
  if (pkg.version) parts.push(t("i18n.installedVersion", { version: pkg.version }));
  if (pkg.configuredVersion) parts.push(t("i18n.configuredVersion", { version: pkg.configuredVersion }));
  return parts.length ? parts.join(" · ") : t("i18n.unknown");
}

function statusColor(status: PluginPackageInfo["status"]): string {
  if (status === "loaded") return "var(--accent)";
  if (status === "installed") return "#f59e0b";
  if (status === "disabled") return "var(--text-dim)";
  return "#ef4444";
}

function ResourceList({ pkg }: { pkg: PluginPackageInfo }) {
  const { t } = useI18n();
  const groups = ([
    ["extension", t("i18n.extensions")],
    ["skill", t("i18n.skills")],
    ["prompt", t("i18n.prompts")],
    ["theme", t("i18n.themes")],
  ] as const)
    .map(([kind, label]) => ({
      kind,
      label,
      resources: pkg.resources.filter((resource) => resource.kind === kind),
    }))
    .filter((group) => group.resources.length > 0);

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
        {pkg.disabled ? t("i18n.packageDisabled") : t("i18n.noResolvedResources")}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={group.kind}
          style={{
            borderTop: groupIndex === 0 ? "none" : "1px solid var(--border)",
            paddingTop: groupIndex === 0 ? 0 : 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text-dim)",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {group.label}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {group.resources.map((resource) => (
              <div key={`${resource.kind}:${resource.path}`} style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={resource.path}
                >
                  {resource.name}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-dim)",
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 1,
                  }}
                  title={resource.path}
                >
                  {resource.relativePath}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PackageDetail({
  pkg,
  cwd,
  busyKey,
  actionError,
  actionMessage,
  sessionId,
  updateStatus,
  checkingUpdate,
  updateError,
  onAction,
  onCheckUpdate,
  onReloadSession,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  sessionId: string | null;
  updateStatus?: PluginUpdateResult;
  checkingUpdate: boolean;
  updateError: string | null;
  onAction: (action: PluginAction, pkg: PluginPackageInfo) => void;
  onCheckUpdate: () => void;
  onReloadSession: () => void;
}) {
  const { t } = useI18n();
  const key = packageKey(pkg);
  const busy = (busyKey?.endsWith(key) || busyKey?.startsWith("bulk:")) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;
  const canCheckForUpdates = pkg.canCheckForUpdates;
  const updateAvailable = updateStatus?.state === "update-available";
  const description = pkg.description?.trim();
  const reloadReasonId = useId();

  return (
    <ConfigDetailStack>
      <div className="config-detail-heading">
        <ConfigDetailHeader className="is-top-aligned">
          <ConfigDetailHeaderInfo>
            <ConfigScopeTag scope={pkg.scope}>{scopeLabel(pkg.scope, t)}</ConfigScopeTag><span className="resource-origin-tag">{t(pkg.installOrigin === "app" ? "resources.appInstalled" : "resources.external")}</span>
            {pkg.disabled ? (
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(120,120,120,0.12)",
                  color: "var(--text-dim)",
                }}
              >
                {t("i18n.disabled")}
              </span>
            ) : pkg.filtered && (
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(245,158,11,0.12)",
                  color: "#d97706",
                }}
              >
                {t("i18n.filtered")}
              </span>
            )}
            <div className="plugins-package-title">
              <div className="resource-name-row"><ConfigDetailTitle>{pkg.packageName ?? pkg.source}</ConfigDetailTitle><CopyButton value={pkg.packageName ?? pkg.source} /></div>
              {pkg.packageName && <code title={pkg.source}>{pkg.source}</code>}
            </div>
          </ConfigDetailHeaderInfo>

          <ConfigDetailActions>
            <ConfigButton
              size="small"
              variant={updateAvailable ? "primary" : undefined}
              onClick={updateAvailable || !canCheckForUpdates
                ? () => onAction("update", pkg)
                : onCheckUpdate}
              disabled={busy || reloadBusy || checkingUpdate}
              title={updateAvailable ? t("i18n.updateAvailable") : undefined}
            >
              {busyKey === `update:${key}`
                ? t("i18n.updating")
                : checkingUpdate
                  ? t("i18n.checking")
                  : updateAvailable || !canCheckForUpdates
                    ? t("i18n.update")
                    : t("i18n.check")}
            </ConfigButton>
            <ConfigButton
              size="small"
              onClick={onReloadSession}
              disabled={!sessionId || reloadBusy || busy}
              aria-describedby={sessionId ? undefined : reloadReasonId}
            >
              {reloadBusy ? t("i18n.reloading") : t("i18n.reloadSession")}
            </ConfigButton>
            <ConfigSwitch
              checked={enabled}
              loading={busy || reloadBusy}
              onChange={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
              label={pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")}
            />
          </ConfigDetailActions>
        </ConfigDetailHeader>
        {!sessionId && (
          <div id={reloadReasonId} className="config-detail-heading-note">
            {t("i18n.openSessionToReload")}
          </div>
        )}
      </div>


      <ConfigDetailGrid>
        {description && (
          <ConfigDetailGridRow label={t("i18n.description")}>
            <PluginDescription text={description} />
          </ConfigDetailGridRow>
        )}
        <ConfigDetailGridRow
          label={t("i18n.status")}
          tone="plain"
          style={{ color: statusColor(pkg.status), textTransform: "capitalize" }}
        >
          {statusLabel(pkg.status, t)}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow
          label={t("i18n.version")}
          tone="plain"
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
        >
          <div className="skill-version-row">
            <span className="skill-version-value">{versionSummary(pkg, t)}</span>
            {updateAvailable && (
              <span className="skill-version-value is-update" title={updateStatus.displayName}>
                {t("i18n.updateAvailable")}
              </span>
            )}
            {canCheckForUpdates && (checkingUpdate || (updateStatus && !updateAvailable)) && (
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
          </div>
          {updateError && (
            <span style={{ fontSize: 12, color: "#ef4444" }}>{updateError}</span>
          )}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("i18n.package")} mono>
          {pkg.packageName ?? t("i18n.unknown")}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("i18n.resources")}>
          {resourceSummary(pkg, t)}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("i18n.installedPath")} tone={pkg.installedPath ? "muted" : "error"} mono>
          {pkg.installedPath ? <ResourcePath path={pkg.installedPath} /> : t("i18n.notFound")}
        </ConfigDetailGridRow>
        {cwd && <ConfigDetailGridRow label={t("i18n.cwd")} tone="dim" mono>
          {<ResourcePath path={cwd} />}
        </ConfigDetailGridRow>}
      </ConfigDetailGrid>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ConfigSectionTitle>{t("i18n.resolvedResources")}</ConfigSectionTitle>
        <ResourceList pkg={pkg} />
        <p className="plugins-resource-note">{t("plugins.resourcesNote")}</p>
      </div>

      {actionMessage && (
        <div style={{ fontSize: 12, color: "#16a34a" }}>
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div style={{ fontSize: 12, color: "#ef4444", whiteSpace: "pre-wrap" }}>
          {actionError}
        </div>
      )}
    </ConfigDetailStack>
  );
}

function StandaloneExtensionDetail({ extension }: { extension: PluginStandaloneExtensionInfo }) {
  const { t } = useI18n();
  const status = extension.enabled ? "loaded" : "disabled";

  return (
    <ConfigDetailStack>
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          <ConfigScopeTag scope={extension.scope}>{scopeLabel(extension.scope, t)}</ConfigScopeTag>
          <span className="resource-name-row"><ConfigDetailTitle>{extension.name}</ConfigDetailTitle><CopyButton value={extension.name} /></span><span className="resource-origin-tag">{t("resources.external")}</span>
        </ConfigDetailHeaderInfo>
      </ConfigDetailHeader>
      <ConfigDetailGrid>
        <ConfigDetailGridRow
          label={t("i18n.status")}
          tone="plain"
          style={{ color: extension.enabled ? "var(--accent)" : "var(--text-dim)" }}
        >
          {statusLabel(status, t)}
        </ConfigDetailGridRow>
        <ConfigDetailGridRow label={t("i18n.installedPath")} mono>
          {<ResourcePath path={extension.path} />}
        </ConfigDetailGridRow>
      </ConfigDetailGrid>
    </ConfigDetailStack>
  );
}

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
  embedded = false,
  trust,
  targetScope,
  targetPending = false,
  renderInstallTarget,
  workspace = false,
  active = true,
}: {
  cwd: string | null;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
  workspace?: boolean;
  active?: boolean;
  /** The page's trust status for `cwd`; a new decision loads the list again. */
  trust?: ProjectTrustStatus | null;
  targetScope?: PluginScope;
  renderInstallTarget?: (path?: string, state?: { loading?: boolean; busy?: boolean }) => ReactNode;
  targetPending?: boolean;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loadedCwd, setLoadedCwd] = useState<string | null>();
  const switchingTarget = loadedCwd !== cwd;
  const resourcePending = targetPending || switchingTarget;
  const [loading, setLoading] = useState(true);
  const showLoading = useDeferredLoading(loading);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mobileDetail, setMobileDetail] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalog, setCatalog] = useState<PluginCatalogPage | null>(() => peekPluginPage() ?? null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [logoUrls, setLogoUrls] = useState<Record<string, string>>({});
  const sentinel = useRef<HTMLDivElement>(null);
  const catalogRequest = useRef<AbortController | null>(null);
  const moreRequest = useRef<AbortController | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedCatalog = useRef({ key: "", retry: -1 });
  const catalogScroll = useRef(0);
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogPlugin | null>(null);
  const [sourceDetail, setSourceDetail] = useState<PluginSourceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const lastDetailRequest = useRef({ name: "", retry: 0 });
  const [localInstallScope, setInstallScope] = useState<PluginScope>("global");
  const installScope = targetScope ?? localInstallScope;
  useEffect(() => { if (!cwd) setInstallScope("global"); }, [cwd]);
  const installTasks = useInstallTasks();
  const loadSequence = useRef(0);
  const currentCwd = useRef(cwd);
  useEffect(() => { currentCwd.current = cwd; }, [cwd]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<PluginPackageInfo | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  // What the last group switch left undone, shown under that scope's heading.
  const [groupStatus, setGroupStatus] = useState<{ scope: string; error?: string; note?: string } | null>(null);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, PluginUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  const standaloneExtensions = useMemo(() => data?.standaloneExtensions ?? [], [data?.standaloneExtensions]);
  const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;
  const selectedExtension = standaloneExtensions.find((extension) => extensionKey(extension) === selected) ?? null;
  const managedPackage = selectedPackage ?? (selectedCatalog ? findInstalledCatalogPlugin(packages, selectedCatalog.name, installScope) : null) ?? null;
  const sourceName = selectedCatalog?.name ?? (selectedPackage ? parseNpmSource(selectedPackage.source)?.name : undefined);
  const currentSourceDetail = sourceDetail?.name === sourceName ? sourceDetail : null;
  const showingDetail = Boolean(selectedCatalog || selected);
  const installPath = installScope === "global" ? data?.globalInstallPath : cwd ? `${cwd}/.pi/npm` : undefined;
  const projectResourcesLoaded = Boolean(cwd) && (data?.projectResourcesLoaded ?? false) && (targetScope !== "project" || trust?.trusted === true);
  const installBlocked = resourcePending || (installScope === "project" && !projectResourcesLoaded);
  const matches = (values: (string | undefined)[]) => values.join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const matchesPackage = (pkg: PluginPackageInfo) => matches([pkg.source, pkg.packageName, pkg.description]);
  const matchesExtension = (extension: PluginStandaloneExtensionInfo) => matches([extension.name, extension.path]);
  const visibleCount = packages.filter(matchesPackage).length + standaloneExtensions.filter(matchesExtension).length;
  // 返回卡片目录时恢复滚动，详情之间切换则回到顶部。
  useEffect(() => { detailRef.current?.querySelector(".config-detail")?.scrollTo(0, selected || selectedCatalog ? 0 : catalogScroll.current); }, [selected, selectedCatalog]);

  const loadPlugins = useCallback(async (restore = false) => {
    if (currentCwd.current !== cwd) return;
    if (!restore) invalidateResourceOverviews("plugins");
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    setGroupStatus(null);
    const apply = (next: PluginsResponse) => {
      setData(next);
      setLoadedCwd(cwd);
      setSelected(current => current && (next.packages.some(pkg => packageKey(pkg) === current)
        || next.standaloneExtensions.some(extension => extensionKey(extension) === current)) ? current : null);
    };
    if (restore) {
      const cached = peekResourceOverview<PluginsResponse>("plugins", cwd);
      if (cached) apply(cached);
      else { setData(null); setLoadedCwd(undefined); setSelected(null); }
    }
    try {
      const next = await readResourceOverview<PluginsResponse>("plugins", cwd, undefined, restore);
      if (sequence !== loadSequence.current || currentCwd.current !== cwd) return;
      apply(next);
    } catch (err) {
      if (sequence === loadSequence.current && currentCwd.current === cwd) setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      if (sequence === loadSequence.current && currentCwd.current === cwd) setLoading(false);
    }
  }, [cwd]);

  useLayoutEffect(() => {
    currentCwd.current = cwd;
    setUpdateStatuses({});
    setUpdateError(null);
    setActionError(null); setActionMessage(null); setConfirmRemove(null);
    void loadPlugins(true).catch(() => {});
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whether project packages load, and the Project scope can be chosen, follows
  // the folder's trust, which can change while this section stays mounted
  // (hidden) in Settings: trusting from Settings › MCP. A new decision loads the
  // list again in place, keeping the selection and any update checks; the first
  // load is the effect above.
  const trustKey = projectTrustReloadKey(trust);
  const loadedTrustKeyRef = useRef(trustKey);
  useEffect(() => {
    if (loadedTrustKeyRef.current === trustKey) return;
    loadedTrustKeyRef.current = trustKey;
    if (trust && loadedCwd === cwd && trust.trusted !== data?.projectResourcesLoaded) void loadPlugins().catch(() => {});
  }, [trustKey, loadPlugins, trust, loadedCwd, cwd, data?.projectResourcesLoaded]);

  useEffect(() => {
    if (selected) setLastSettingsSelection("plugins", selected, cwd);
  }, [cwd, selected]);

  const checkForUpdates = useCallback(async (pkg?: PluginPackageInfo) => {
    const targets = pkg ? [pkg] : packages.filter((item) => item.canCheckForUpdates);
    const keys = targets.map(packageKey);
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!pkg) setCheckingAll(true);
    try {
      const res = await fetch("/api/plugins/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          source: pkg?.source,
          scope: pkg?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: PluginUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[packageKey(update)] = update;
        }
        return next;
      });
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!pkg) setCheckingAll(false);
    }
  }, [cwd, packages]);

  const updateAllPluginsAction = useCallback(async () => {
    setUpdatingAll(true);
    setActionError(null);
    setActionMessage(null);
    setUpdateError(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      invalidateResourceOverviews("plugins");
      setData(next);
      setUpdateStatuses({});
      setActionMessage(t("i18n.packagesUpdated"));
      if (sessionId) {
        setActionMessage(`${t("i18n.packagesUpdated")} ${t("agents.reloadRequired")}`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingAll(false);
    }
  }, [cwd, sessionId, t]);

  const runAction = useCallback(async (action: PluginAction, pkg: PluginPackageInfo) => {
    const key = packageKey(pkg);
    setBusyKey(`${action}:${key}`);
    setActionError(null);
    setActionMessage(null);
    setGroupStatus(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source: pkg.source, scope: pkg.scope, cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      invalidateResourceOverviews("plugins");
      setData(next);
      if (action === "remove") {
        setSelected(current => current === key ? null : current);
        setActionMessage(t("i18n.packageRemoved"));
        setUpdateStatuses((current) => {
          const nextStatuses = { ...current };
          delete nextStatuses[key];
          return nextStatuses;
        });
      } else {
        const messages: Record<Exclude<PluginAction, "remove">, string> = {
          install: t("i18n.packageInstalled"),
          update: t("i18n.packageUpdated"),
          disable: t("i18n.packageDisabled"),
          enable: t("i18n.packageEnabled"),
        };
        setActionMessage(messages[action]);
        if (action === "update") {
          setUpdateStatuses((current) => {
            const nextStatuses = { ...current };
            delete nextStatuses[key];
            return nextStatuses;
          });
        }
      }
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusyKey(null);
    }
  }, [cwd, t]);

  // Behaves like the package switch, for every package of one scope: the
  // confirmation appears in the package detail and the session is reloaded by
  // hand. Packages the route refuses keep their state and are named under the
  // scope's heading, and so are the filtered packages switching off leaves on.
  const setGroupPackages = useCallback(async (
    scope: PluginScope,
    groupPackages: PluginPackageInfo[],
    enabled: boolean,
    groupId: string,
  ) => {
    const targets = packagesToSwitch(groupPackages, enabled);
    const keptOn = enabled ? 0 : filteredPackagesKeptOn(groupPackages).length;
    const note = keptOn > 0 ? t("plugins.bulkKeptFiltered", { count: keptOn }) : undefined;
    setActionError(null);
    setActionMessage(null);
    setGroupStatus(note ? { scope: groupId, note } : null);
    if (targets.length === 0) return;
    const action = enabled ? "enable" : "disable";
    setBusyKey(`bulk:${groupId}`);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          cwd,
          packages: targets.map(({ source }) => ({ source, scope })),
        }),
      });
      const next = (await res.json()) as Partial<PluginsBulkResponse> & { error?: string };
      if (!res.ok || next.error || !next.results) throw new Error(next.error ?? `HTTP ${res.status}`);
      const { results, ...plugins } = next as PluginsBulkResponse;
      invalidateResourceOverviews("plugins");
      setData(plugins);
      const failures = results.filter((result) => result.error);
      if (failures.length < results.length) {
        const message = enabled ? t("plugins.bulkEnabled") : t("plugins.bulkDisabled");
        setActionMessage(sessionId ? `${message} ${t("agents.reloadRequired")}` : message);
      }
      if (failures.length > 0) {
        setGroupStatus({
          scope: groupId,
          note,
          error: [
            t("plugins.bulkFailed", { count: failures.length, total: results.length }),
            ...failures.map((failure) => `${failure.source}: ${failure.error}`),
          ].join("\n"),
        });
      }
    } catch (err) {
      setGroupStatus({ scope: groupId, note, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyKey(null);
    }
  }, [cwd, sessionId, t]);

  const installPlugin = async (item: CatalogPlugin) => {
    if (busyKey || updatingAll || installBlocked) return;
    const targetScope = installScope, targetCwd = cwd;
    const key = targetScope + "\0" + item.source;
    await installTasks.run(key, async () => {
      const response = await fetch("/api/plugins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "install", source: item.source, scope: targetScope, cwd: targetCwd }) });
      const next = await response.json() as PluginsResponse & { error?: string };
      if (!response.ok || next.error) throw new Error(next.error ?? "Install failed");
      await loadPlugins();
    });
  };

  useEffect(() => {
    if (!active) { setCatalogLoading(false); return; }
    const requestKey = catalogQuery.trim();
    if (loadedCatalog.current.key === requestKey && loadedCatalog.current.retry === catalogRetry) return;
    const controller = new AbortController(); catalogRequest.current = controller;
    const cached = peekPluginPage(requestKey);
    if (cached) setCatalog(cached);
    setCatalogLoading(true); setCatalogError(null);
    setMoreError(false);
    const timer = setTimeout(() => {
      const force = loadedCatalog.current.key === requestKey && loadedCatalog.current.retry !== catalogRetry && catalogRetry > 0;
      void loadPluginPage(requestKey, 1, controller.signal, force)
        .then(result => { if (!controller.signal.aborted) { loadedCatalog.current = { key: requestKey, retry: catalogRetry }; setCatalog(result); } })
        .catch(() => { if (!controller.signal.aborted) setCatalogError(t("plugins.catalogFailed")); })
        .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    }, requestKey ? 350 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, catalogQuery, catalogRetry, t]);

  // 每次只预取下一批；进入底部前约一屏半追加，不连续抓取整个目录。
  useEffect(() => {
    if (!active || catalogLoading || !catalog?.hasNext || showingDetail) return;
    const controller = new AbortController();
    void loadPluginPage(catalogQuery, catalog.page + 1, controller.signal).catch(() => {});
    return () => controller.abort();
  }, [active, catalogLoading, catalogQuery, catalog?.page, catalog?.hasNext, showingDetail]);

  const loadMore = useCallback(() => {
    if (!active || catalogLoading || !catalog?.hasNext || showingDetail || moreRequest.current) return;
    const controller = new AbortController(); moreRequest.current = controller;
    setMoreLoading(true); setMoreError(false);
    const page = catalog.page + 1;
    void loadPluginPage(catalogQuery, page, controller.signal)
      .then(next => {
        if (controller.signal.aborted) return;
        setCatalog(current => {
          if (!current || current.page !== page - 1) return current;
          const names = new Set(current.items.map(item => item.name));
          const added = next.items.filter(item => !names.has(item.name));
          return { ...next, items: [...current.items, ...added], hasNext: next.hasNext && added.length > 0 };
        });
      })
      .catch(() => { if (!controller.signal.aborted) setMoreError(true); })
      .finally(() => { if (moreRequest.current === controller) { moreRequest.current = null; setMoreLoading(false); } });
  }, [active, catalogLoading, catalog, catalogQuery, showingDetail]);

  useEffect(() => {
    if (!active || showingDetail || catalogLoading || moreError || !catalog?.hasNext || !sentinel.current) return;
    const root = detailRef.current?.querySelector(".config-detail");
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) loadMore(); }, { root, rootMargin: "1200px 0px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [active, showingDetail, catalogLoading, moreError, catalog?.hasNext, loadMore]);

  useEffect(() => {
    if (!active || showingDetail) return;
    return () => { moreRequest.current?.abort(); moreRequest.current = null; setMoreLoading(false); };
  }, [active, showingDetail, catalogQuery, catalogRetry]);

  useEffect(() => {
    if (!active || !catalog?.items.length) return;
    const controller = new AbortController();
    // 每批保持与目录页相同的边界，追加时复用已完成的图标请求。
    for (let offset = Math.max(0, Math.floor((catalog.items.length - 100) / 50) * 50); offset < catalog.items.length; offset += 50) {
      const names = catalog.items.slice(offset, offset + 50).map(item => item.name);
      void loadBrowserPluginLogos(names, controller.signal).then(urls => { if (!controller.signal.aborted) setLogoUrls(current => ({ ...current, ...urls })); }).catch(() => {});
    }
    return () => controller.abort();
  }, [active, catalog]);

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, [active, showingDetail]);

  useEffect(() => {
    const controller = new AbortController();
    if (!active || !sourceName) return;
    const cached = peekPluginDetail(sourceName);
    if (cached) setSourceDetail(cached);
    setDetailError(false); setDetailLoading(!cached);
    const force = lastDetailRequest.current.name === sourceName && lastDetailRequest.current.retry !== detailRetry;
    lastDetailRequest.current = { name: sourceName, retry: detailRetry };
    void loadBrowserPluginDetail(sourceName, controller.signal, force)
      .then(result => { if (!controller.signal.aborted) setSourceDetail(result); })
      .catch(() => { if (!controller.signal.aborted) setDetailError(true); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [active, sourceName, detailRetry]);

  const reloadSession = useCallback(async () => {
    if (!sessionId) return;
    setBusyKey("reload");
    setActionError(null);
    setActionMessage(null);
    setGroupStatus(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      await loadPlugins();
      setActionMessage(t("i18n.sessionReloaded"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [loadPlugins, onReloaded, sessionId, t]);

  const availableUpdateCount = Object.values(updateStatuses).filter(
    (status) => status.state === "update-available",
  ).length;
  const hasCheckablePackages = packages.some((pkg) => pkg.canCheckForUpdates);
  const targetBusy = installTasks.pending.size > 0 || busyKey !== null || checkingUpdates.size > 0 || updatingAll;
  const footerBusy = resourcePending || loading || installTasks.pending.size > 0 || busyKey !== null || checkingUpdates.size > 0 || updatingAll;

  const rememberCatalog = () => { if (!showingDetail) catalogScroll.current = detailRef.current?.querySelector(".config-detail")?.scrollTop ?? 0; };
  const openDetail = (key: string) => { rememberCatalog(); setSelectedCatalog(null); setSelected(current => current === key ? null : key); setMobileDetail(true); setActionError(null); setActionMessage(null); };
  const openCatalogDetail = (item: CatalogPlugin) => { rememberCatalog(); setSelected(null); setSelectedCatalog({ ...item, logo: item.logo ?? logoUrls[item.name] }); setMobileDetail(true); setActionError(null); setActionMessage(null); };
  const returnToCatalog = () => { setSelected(null); setSelectedCatalog(null); setMobileDetail(true); setActionError(null); setActionMessage(null); };
  const nameOf = (pkg: PluginPackageInfo) => pkg.packageName ?? parseNpmSource(pkg.source)?.name ?? pkg.source;
  const updateQuery = (value: string) => { if (value.trim() !== catalogQuery.trim()) { catalogRequest.current?.abort(); moreRequest.current?.abort(); moreRequest.current = null; setMoreLoading(false); setMoreError(false); setCatalog(peekPluginPage(value) ?? null); setCatalogLoading(true); setCatalogError(null); catalogScroll.current = 0; detailRef.current?.querySelector(".config-detail")?.scrollTo(0, 0); } setCatalogQuery(value); returnToCatalog(); };
  const cancelHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); };
  const warmDetail = (name: string) => { cancelHover(); hoverTimer.current = setTimeout(() => warmPluginDetail(name), 180); };
  const sourceInfo = sourceName && <PluginSourceInfo data={currentSourceDetail} loading={detailLoading || (!currentSourceDetail && !detailError)} error={detailError} retry={() => setDetailRetry(value => value + 1)} />;

  return <div ref={detailRef} className={`plugins-manager${workspace ? " is-workspace" : ""}${mobileDetail ? " is-detail" : ""}`}>
      <ConfigPanelShell embedded={embedded} title={t("common.plugins")} closeLabel={t("i18n.close")} onClose={onClose}>

        <ConfigSplitView>
          <ConfigSidebar>
            <div className="plugins-list-header">
              <div><strong>{t("plugins.installed")}</strong><span>{loadedCwd === undefined ? "—" : packages.length + standaloneExtensions.length}</span></div>
              <input ref={searchRef} type="search" className="plugins-search-input" aria-label={t("plugins.searchInstalled")} placeholder={t("plugins.searchInstalled")} value={search} maxLength={150} onChange={event => setSearch(event.target.value)} />

            </div>
            <div className="resource-installed-list" aria-busy={loading || resourcePending}><ConfigSidebarList>
              {loading && !data ? <div className="config-sidebar-message">{showLoading ? t("i18n.loading") : null}</div>
                : error && !data ? <div className="plugins-sidebar-empty is-error" role="alert"><p>{error}</p><ConfigButton size="small" onClick={() => void loadPlugins().catch(() => {})}>{t("plugins.retry")}</ConfigButton></div>
                  : visibleCount === 0 ? <div className="plugins-sidebar-empty" role="status"><p>{t(search ? "plugins.noMatches" : "plugins.noInstalled")}</p>{!search && <span>{t("plugins.installFromCatalog")}</span>}</div>
                    : <ResourceSidebarGroups kind="plugins" searching={!!search.trim()} groups={RESOURCE_GROUPS.map(id => {
                      const groupPackages = packages.filter(pkg => resourceGroup(pkg.scope, pkg.installOrigin) === id);
                      const extensions = standaloneExtensions.filter(extension => resourceGroup(extension.scope) === id);
                      const enabledCount = groupPackages.filter(pkg => !pkg.disabled).length;
                      const label = t(id === "external" ? "resources.external" : id === "global" ? "skills.scope.global" : "skills.scope.project");
                      return { id, label,
                        controls: <ConfigSidebarGroupSwitch enabled={enabledCount + extensions.filter(extension => extension.enabled).length} total={groupPackages.length + extensions.length} disabled={footerBusy || !groupPackages.length} checked={enabledCount === groupPackages.length && extensions.every(extension => extension.enabled)} loading={busyKey === `bulk:${id}`} label={t(enabledCount === groupPackages.length ? "plugins.groupSwitchOn" : "plugins.groupSwitchOff", { group: label })} onChange={enabled => void setGroupPackages(id === "project" ? "project" : "global", groupPackages, enabled, id)} />,
                        status: groupStatus?.scope === id && <ConfigSidebarGroupStatus error={groupStatus.error} note={groupStatus.note} />,
                        children: <>
                          {extensions.filter(matchesExtension).map(extension => <ResourceSidebarRow key={extensionKey(extension)} name={extension.name} disabled reason={t("resources.removeStandalone")}><ConfigSidebarItem disabled={resourcePending} active={selected === extensionKey(extension)} onClick={() => openDetail(extensionKey(extension))}><PluginLogo name={extension.name} /><ConfigSidebarText className="is-grow">{extension.name}</ConfigSidebarText>{id === "project" && <span className="resource-origin-tag">{t("resources.external")}</span>}</ConfigSidebarItem></ResourceSidebarRow>)}
                          {groupPackages.filter(matchesPackage).map(pkg => <ResourceSidebarRow key={packageKey(pkg)} name={nameOf(pkg)} disabled={footerBusy} onRemove={() => { setActionError(null); setConfirmRemove(pkg); }}><ConfigSidebarItem disabled={resourcePending} active={selected === packageKey(pkg) || Boolean(selectedCatalog && managedPackage === pkg)} title={pkg.description ?? pkg.source} onClick={() => openDetail(packageKey(pkg))}><ConfigStatusDot active={!pkg.disabled} color={statusColor(pkg.status)} /><ConfigSidebarText className={`is-grow${pkg.disabled ? " is-muted" : ""}`}>{nameOf(pkg)}</ConfigSidebarText>{id === "project" && <span className="resource-origin-tag">{t(pkg.installOrigin === "app" ? "resources.appInstalled" : "resources.external")}</span>}</ConfigSidebarItem></ResourceSidebarRow>)}
                        </>,
                        visible: groupPackages.some(matchesPackage) || extensions.some(matchesExtension),
                      };
                    }).filter(group => group.visible)} />}
            </ConfigSidebarList></div>
          </ConfigSidebar>
          <ConfigDetail>
            <div className="plugins-detail-toolbar">
              <button type="button" className="plugins-list-back" onClick={() => setMobileDetail(false)}>{t("plugins.installed")} ({packages.length + standaloneExtensions.length})</button>
              {showingDetail && <ConfigButton size="small" onClick={returnToCatalog}>{t("resources.back")}</ConfigButton>}
              <a href="https://pi.dev/packages" target="_blank" rel="noopener noreferrer">{t("plugins.browse")} ↗</a>
            </div>
            <div className="plugins-content">
              {!showingDetail && <>
                <header className="plugins-catalog-heading resource-catalog-heading"><div><h2>{t("plugins.browsePlugins")}</h2><p>{t("plugins.discoveryIntro")}</p></div><input type="search" className="plugins-search-input resource-catalog-search" aria-label={t("plugins.searchCatalog")} placeholder={t("plugins.searchCatalog")} value={catalogQuery} maxLength={150} onChange={event => updateQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") setCatalogRetry(value => value + 1); }} /></header>
                <div className="plugins-catalog-options">{renderInstallTarget ? renderInstallTarget(installPath, { loading: loading || (resourcePending && !error), busy: targetBusy }) : <ConfigScopeSwitch value={installScope} label={t("config.saveTo")} options={[{ value: "global", label: scopeLabel("global", t), disabled: footerBusy }, { value: "project", label: scopeLabel("project", t), disabled: !projectResourcesLoaded || footerBusy }]} disabledReason={!projectResourcesLoaded ? t("trust.projectScopeUnavailable") : undefined} onChange={setInstallScope}>{installPath && <ResourcePath path={installPath} />}</ConfigScopeSwitch>}{catalog && <span>{t("plugins.resultCount", { count: catalog.total })}</span>}</div>
              </>}
              {!managedPackage && actionMessage && <p role="status" className="plugins-action-message">{actionMessage}</p>}
              {!managedPackage && actionError && <p role="alert" className="plugins-action-error">{actionError}</p>}
              {managedPackage ? <><PackageDetail key={packageKey(managedPackage)} pkg={managedPackage} cwd={cwd ?? ""} busyKey={resourcePending ? "bulk:target" : installTasks.pending.size > 0 ? "bulk:install" : busyKey} actionError={actionError} actionMessage={actionMessage} sessionId={sessionId} updateStatus={updateStatuses[packageKey(managedPackage)]} checkingUpdate={checkingUpdates.has(packageKey(managedPackage))} updateError={updateError} onAction={runAction} onCheckUpdate={() => void checkForUpdates(managedPackage)} onReloadSession={reloadSession} />{sourceInfo}</>
                : selectedExtension ? <StandaloneExtensionDetail extension={selectedExtension} />
                  : selectedCatalog ? <>
                    <header className="plugin-detail-heading"><PluginLogo name={selectedCatalog.name} url={selectedCatalog.logo} /><div><div className="resource-name-row"><h2>{selectedCatalog.name}</h2><CopyButton value={selectedCatalog.name} /></div><span>{currentSourceDetail?.author ?? selectedCatalog.author}</span></div><ConfigButton variant="primary" disabled={installTasks.pending.has(`${installScope}\0${selectedCatalog.source}`) || busyKey !== null || updatingAll || Boolean(error) || installBlocked} onClick={() => void installPlugin(selectedCatalog)}>{t(installTasks.pending.has(`${installScope}\0${selectedCatalog.source}`) ? "i18n.installing" : "i18n.install")}</ConfigButton></header>
                    {installTasks.errors[`${installScope}\0${selectedCatalog.source}`] && <p role="alert" className="resource-install-error">{installTasks.errors[`${installScope}\0${selectedCatalog.source}`]}</p>}
                    <PluginDescription text={currentSourceDetail?.description ?? selectedCatalog.description} />
                    <div className="plugin-detail-scope">{renderInstallTarget ? renderInstallTarget(installPath, { loading: loading || (resourcePending && !error), busy: targetBusy }) : <ConfigScopeSwitch value={installScope} label={t("config.saveTo")} options={[{ value: "global", label: scopeLabel("global", t), disabled: footerBusy }, { value: "project", label: scopeLabel("project", t), disabled: !projectResourcesLoaded || footerBusy }]} disabledReason={!projectResourcesLoaded ? t("trust.projectScopeUnavailable") : undefined} onChange={setInstallScope}>{installPath && <ResourcePath path={installPath} />}</ConfigScopeSwitch>}</div>{sourceInfo}
                  </> : <>
                    {catalogError && <div className="plugins-load-status" role="alert"><span>{catalogError}</span><ConfigButton size="small" onClick={() => setCatalogRetry(value => value + 1)}>{t("plugins.retry")}</ConfigButton></div>}
                    {!catalog && catalogLoading ? <div className="plugins-card-grid plugins-skeleton" aria-label={t("plugins.searching")} role="status">{Array.from({ length: 9 }, (_, i) => <div className="plugin-card" key={i}><span /><p /><p /></div>)}</div>
                        : catalog?.items.length ? <div className="plugins-card-grid">{catalog.items.map(item => {
                          const installed = findInstalledCatalogPlugin(packages, item.name, installScope);
                          const installing = installTasks.pending.has(`${installScope}\0${item.source}`);
                          const installError = installTasks.errors[`${installScope}\0${item.source}`];
                          return <article className="plugin-card" key={item.source} onPointerEnter={() => warmDetail(item.name)} onPointerLeave={cancelHover} onFocus={event => { if (!(event.target as HTMLElement).closest(".plugin-card-footer")) warmDetail(item.name); }} onBlur={cancelHover} onClick={event => { if (!(event.target as HTMLElement).closest("button,a")) openCatalogDetail(item); }}>
                            <div className="plugin-card-heading"><PluginLogo name={item.name} url={item.logo ?? logoUrls[item.name]} /><h3><button type="button" onClick={() => openCatalogDetail(item)}>{item.name}</button></h3></div><PluginDescription text={item.description} />
                            <div className="plugin-card-footer"><span>{item.author ?? item.types.join(" · ")}</span><ConfigButton size="small" className={installed ? "is-installed" : undefined} variant={installed ? "secondary" : "primary"} disabled={Boolean(installed) || installing || busyKey !== null || updatingAll || Boolean(error) || installBlocked} onClick={() => void installPlugin(item)}>{t(installed ? "plugins.alreadyInstalled" : installing ? "i18n.installing" : "i18n.install")}</ConfigButton></div>
                            {installError && <p role="alert" className="resource-install-error">{installError}</p>}
                          </article>;
                        })}</div> : !catalogLoading && !catalogError && <div className="plugins-state">{t("plugins.noCatalogResults")}</div>}
                    {catalog && <div ref={sentinel} className="plugins-load-status" aria-live="polite">
                      {moreError ? <><span>{t("plugins.loadMoreFailed")}</span><ConfigButton size="small" onClick={loadMore}>{t("plugins.retry")}</ConfigButton></> : moreLoading ? t("plugins.loadingMore") : catalog.hasNext ? <ConfigButton size="small" onClick={loadMore}>{t("plugins.loadMore")}</ConfigButton> : catalog.items.length > 0 ? t("plugins.allLoaded") : null}
                    </div>}
                  </>}
            </div>
          </ConfigDetail>
        </ConfigSplitView>
        {confirmRemove && <ResourceRemoveDialog name={nameOf(confirmRemove)} description={t("plugins.removeConfirm", { name: nameOf(confirmRemove) })} busy={busyKey !== null} error={actionError} onCancel={() => setConfirmRemove(null)} onConfirm={() => { void runAction("remove", confirmRemove).then(success => { if (success) setConfirmRemove(null); }); }} />}
        {error && data && <p className="resource-load-error" role="alert">{error}<ConfigButton size="small" onClick={() => void loadPlugins().catch(() => {})}>{t("plugins.retry")}</ConfigButton></p>}
        <ConfigFooter status={<div className="plugins-footer-summary"><ConfigFooterStatus summary={data ? selectedCatalog && !managedPackage ? `${selectedCatalog.name} · ${t("resources.countAfterInstall")}` : `${managedPackage ? nameOf(managedPackage) : selectedExtension ? selectedExtension.name : t("resources.total")} · ${totalsSummary(managedPackage?.counts ?? (selectedExtension ? { extensions: selectedExtension.enabled ? 1 : 0, skills: 0, prompts: 0, themes: 0 } : data.totals), t)}` : ""} />{
          availableUpdateCount > 0 ? (
            <span style={{ fontSize: 12, color: "var(--accent)" }}>
              {availableUpdateCount}{" "}
              {availableUpdateCount === 1 ? t("i18n.update") : t("i18n.updates")}
            </span>
          ) : data?.diagnostics.length ? (
            <ConfigFooterStatus
              tone={data.diagnostics.some((d) => d.type === "error") ? "error" : "warning"}
              summary={data.diagnostics.length === 1
                ? t("plugins.diagnostic")
                : t("plugins.diagnostics", { count: data.diagnostics.length })}
              details={data.diagnostics.map(diagnosticText)}
            />
          ) : (
            null
          )}</div>}
        >
          {!embedded && <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>}
          {hasCheckablePackages && (
            <ConfigButton
              variant={availableUpdateCount > 0 ? "primary" : "secondary"}
              onClick={() => void (availableUpdateCount > 0 ? updateAllPluginsAction() : checkForUpdates())}
              disabled={footerBusy}
              title={availableUpdateCount > 0 ? t("i18n.updateAllPluginsHint") : undefined}
            >
              {updatingAll
                ? t("i18n.updating")
                : checkingAll
                  ? t("i18n.checking")
                  : availableUpdateCount > 0
                    ? `${t("i18n.updateAllPlugins")} (${availableUpdateCount})`
                    : t("i18n.checkUpdates")}
            </ConfigButton>
          )}
          <ConfigButton variant="secondary" onClick={() => void loadPlugins().catch(() => {})} disabled={footerBusy}>
            {t("i18n.refresh")}
          </ConfigButton>
        </ConfigFooter>
      </ConfigPanelShell>
    </div>;
}
