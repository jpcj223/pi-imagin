"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { shortenPath } from "@/lib/display-path";
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
  ConfigSidebarGroupLabel,
  ConfigSidebarGroupStatus,
  ConfigSidebarGroupSwitch,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSectionTitle,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
  ConfigTrustNotice,
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
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <ConfigDetailStack>
      <div className="config-detail-heading">
        <ConfigDetailHeader className="is-top-aligned">
          <ConfigDetailHeaderInfo>
            <ConfigScopeTag scope={pkg.scope}>{scopeLabel(pkg.scope, t)}</ConfigScopeTag>
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
              <ConfigDetailTitle>{pkg.packageName ?? pkg.source}</ConfigDetailTitle>
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
            <ConfigButton
              variant="danger"
              size="small"
              onClick={() => setConfirmRemove(true)}
              disabled={busy || reloadBusy}
            >
              {busyKey === `remove:${key}` ? t("i18n.removing") : t("i18n.remove")}
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

      {confirmRemove && <div className="plugins-remove-confirm" role="alert">
        <p>{t("plugins.removeConfirm", { name: pkg.packageName ?? pkg.source })}</p>
        <div><ConfigButton size="small" onClick={() => setConfirmRemove(false)}>{t("i18n.cancel")}</ConfigButton>
          <ConfigButton size="small" variant="danger" disabled={busy || reloadBusy} onClick={() => { setConfirmRemove(false); onAction("remove", pkg); }}>{t("i18n.remove")}</ConfigButton></div>
      </div>}
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
          {pkg.installedPath ? shortenPath(pkg.installedPath) : t("i18n.notFound")}
        </ConfigDetailGridRow>
        {cwd && <ConfigDetailGridRow label={t("i18n.cwd")} tone="dim" mono>
          {shortenPath(cwd)}
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
          <ConfigDetailTitle>{extension.name}</ConfigDetailTitle>
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
          {shortenPath(extension.path)}
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
}) {
  const { t } = useI18n();
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [installScope, setInstallScope] = useState<PluginScope>("global");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  // What the last group switch left undone, shown under that scope's heading.
  const [groupStatus, setGroupStatus] = useState<{ scope: PluginScope; error?: string; note?: string } | null>(null);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, PluginUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  const standaloneExtensions = useMemo(() => data?.standaloneExtensions ?? [], [data?.standaloneExtensions]);
  const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;
  const selectedExtension = standaloneExtensions.find((extension) => extensionKey(extension) === selected) ?? null;
  const managedPackage = selectedPackage ?? (selectedCatalog ? packages.find(pkg => pkg.scope === installScope && (pkg.packageName === selectedCatalog.name || parseNpmSource(pkg.source)?.name === selectedCatalog.name)) : null) ?? null;
  const sourceName = selectedCatalog?.name ?? (selectedPackage ? parseNpmSource(selectedPackage.source)?.name : undefined);
  const currentSourceDetail = sourceDetail?.name === sourceName ? sourceDetail : null;
  const showingDetail = Boolean(selectedCatalog || selected);
  const projectResourcesLoaded = Boolean(cwd) && (data?.projectResourcesLoaded ?? false);
  const matches = (values: (string | undefined)[]) => values.join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const matchesPackage = (pkg: PluginPackageInfo) => matches([pkg.source, pkg.packageName, pkg.description]);
  const matchesExtension = (extension: PluginStandaloneExtensionInfo) => matches([extension.name, extension.path]);
  const visibleCount = packages.filter(matchesPackage).length + standaloneExtensions.filter(matchesExtension).length;
  // 返回卡片目录时恢复滚动，详情之间切换则回到顶部。
  useEffect(() => { detailRef.current?.querySelector(".config-detail")?.scrollTo(0, selected || selectedCatalog ? 0 : catalogScroll.current); }, [selected, selectedCatalog]);

  const groupedPackages = useMemo(() => {
    return (["project", "global"] as PluginScope[])
      .map((scope) => ({ scope, packages: packages.filter((pkg) => pkg.scope === scope) }))
      .filter((group) => group.packages.length > 0);
  }, [packages]);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGroupStatus(null);
    try {
      const res = await fetch(`/api/plugins${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`);
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      setSelected((current) => {
        if (current && (
          next.packages.some((pkg) => packageKey(pkg) === current)
          || next.standaloneExtensions.some((extension) => extensionKey(extension) === current)
        )) return current;
        return null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
    void loadPlugins();
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
    void loadPlugins();
  }, [trustKey, loadPlugins]);

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
      setData(next);
      if (action === "remove") {
        setSelected(null);
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
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
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
  ) => {
    const targets = packagesToSwitch(groupPackages, enabled);
    const keptOn = enabled ? 0 : filteredPackagesKeptOn(groupPackages).length;
    const note = keptOn > 0 ? t("plugins.bulkKeptFiltered", { count: keptOn }) : undefined;
    setActionError(null);
    setActionMessage(null);
    setGroupStatus(note ? { scope, note } : null);
    if (targets.length === 0) return;
    const action = enabled ? "enable" : "disable";
    setBusyKey(`bulk:${scope}`);
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
      setData(plugins);
      const failures = results.filter((result) => result.error);
      if (failures.length < results.length) {
        const message = enabled ? t("plugins.bulkEnabled") : t("plugins.bulkDisabled");
        setActionMessage(sessionId ? `${message} ${t("agents.reloadRequired")}` : message);
      }
      if (failures.length > 0) {
        setGroupStatus({
          scope,
          note,
          error: [
            t("plugins.bulkFailed", { count: failures.length, total: results.length }),
            ...failures.map((failure) => `${failure.source}: ${failure.error}`),
          ].join("\n"),
        });
      }
    } catch (err) {
      setGroupStatus({ scope, note, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyKey(null);
    }
  }, [cwd, sessionId, t]);

  const installPlugin = useCallback(async (item: CatalogPlugin) => {
    if (busyKey || updatingAll) return;
    const source = item.source, key = installScope + "\0" + source;
    setBusyKey("install:" + key); setActionError(null); setActionMessage(null);
    try {
      const response = await fetch("/api/plugins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "install", source, scope: installScope, cwd }) });
      const next = await response.json() as PluginsResponse & { error?: string };
      if (!response.ok || next.error) throw new Error(next.error ?? "Install failed");
      setData(next); setActionMessage(t("i18n.packageInstalled") + (sessionId ? " " + t("agents.reloadRequired") : ""));
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setBusyKey(null); }
  }, [cwd, installScope, busyKey, updatingAll, sessionId, t]);

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
  const footerBusy = loading || busyKey !== null || checkingUpdates.size > 0 || updatingAll;

  const rememberCatalog = () => { if (!showingDetail) catalogScroll.current = detailRef.current?.querySelector(".config-detail")?.scrollTop ?? 0; };
  const openDetail = (key: string) => { rememberCatalog(); setSelectedCatalog(null); setSelected(key); setMobileDetail(true); setActionError(null); setActionMessage(null); };
  const openCatalogDetail = (item: CatalogPlugin) => { rememberCatalog(); setSelected(null); setSelectedCatalog({ ...item, logo: item.logo ?? logoUrls[item.name] }); setMobileDetail(true); setActionError(null); setActionMessage(null); };
  const returnToCatalog = () => { setSelected(null); setSelectedCatalog(null); setMobileDetail(true); setActionError(null); setActionMessage(null); };
  const nameOf = (pkg: PluginPackageInfo) => pkg.packageName ?? parseNpmSource(pkg.source)?.name ?? pkg.source;
  const updateQuery = (value: string) => { if (value.trim() !== catalogQuery.trim()) { catalogRequest.current?.abort(); moreRequest.current?.abort(); moreRequest.current = null; setMoreLoading(false); setMoreError(false); setCatalog(peekPluginPage(value) ?? null); setCatalogLoading(true); setCatalogError(null); catalogScroll.current = 0; detailRef.current?.querySelector(".config-detail")?.scrollTo(0, 0); } setCatalogQuery(value); returnToCatalog(); };
  const cancelHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); };
  const warmDetail = (name: string) => { cancelHover(); hoverTimer.current = setTimeout(() => warmPluginDetail(name), 180); };
  const sourceInfo = sourceName && <PluginSourceInfo data={currentSourceDetail} loading={detailLoading || (!currentSourceDetail && !detailError)} error={detailError} retry={() => setDetailRetry(value => value + 1)} />;

  return <div ref={detailRef} className={`plugins-manager${workspace ? " is-workspace" : ""}${mobileDetail ? " is-detail" : ""}`}>
      <ConfigPanelShell embedded={embedded} title={t("common.plugins")} closeLabel={t("i18n.close")} onClose={onClose}>
        {cwd && !projectResourcesLoaded && <ConfigTrustNotice message={t("trust.pluginsNotLoaded")} />}
        <ConfigSplitView>
          <ConfigSidebar>
            <div className="plugins-list-header">
              <div><strong>{t("plugins.installed")}</strong><span>{packages.length + standaloneExtensions.length}</span></div>
              <input ref={searchRef} type="search" className="plugins-search-input" aria-label={t("plugins.searchInstalled")} placeholder={t("plugins.searchInstalled")} value={search} maxLength={150} onChange={event => setSearch(event.target.value)} />
              <button type="button" className="plugins-sidebar-browse" onClick={returnToCatalog}>{t("plugins.browsePlugins")} →</button>
            </div>
            <ConfigSidebarList>
              {loading ? <div className="config-sidebar-message">{t("i18n.loading")}</div>
                : error ? <div className="plugins-sidebar-empty is-error" role="alert"><p>{error}</p><ConfigButton size="small" onClick={() => void loadPlugins()}>{t("plugins.retry")}</ConfigButton></div>
                  : visibleCount === 0 ? <div className="plugins-sidebar-empty" role="status"><p>{t(search ? "plugins.noMatches" : "plugins.noInstalled")}</p>{!search && <span>{t("plugins.installFromCatalog")}</span>}</div>
                    : <>
                      {standaloneExtensions.filter(matchesExtension).map(extension => <ConfigSidebarItem key={extensionKey(extension)} active={selected === extensionKey(extension)} onClick={() => openDetail(extensionKey(extension))}><PluginLogo name={extension.name} /><ConfigSidebarText className="is-grow">{extension.name}</ConfigSidebarText></ConfigSidebarItem>)}
                      {groupedPackages.filter(group => group.packages.some(matchesPackage)).map(group => {
                        const enabledCount = group.packages.filter(pkg => !pkg.disabled).length;
                        return <div key={group.scope} className="config-sidebar-group">
                          <ConfigSidebarGroupLabel aside={<ConfigSidebarGroupSwitch enabled={enabledCount} total={group.packages.length} disabled={footerBusy} loading={busyKey === `bulk:${group.scope}`} label={t(enabledCount === group.packages.length ? "plugins.groupSwitchOn" : "plugins.groupSwitchOff", { group: scopeLabel(group.scope, t) })} onChange={enabled => void setGroupPackages(group.scope, group.packages, enabled)} />}>{scopeLabel(group.scope, t)}</ConfigSidebarGroupLabel>
                          {groupStatus?.scope === group.scope && <ConfigSidebarGroupStatus error={groupStatus.error} note={groupStatus.note} />}
                          {group.packages.filter(matchesPackage).map(pkg => <ConfigSidebarItem key={packageKey(pkg)} active={selected === packageKey(pkg) || Boolean(selectedCatalog && managedPackage === pkg)} title={pkg.description ?? pkg.source} onClick={() => openDetail(packageKey(pkg))}><ConfigStatusDot active={!pkg.disabled} color={statusColor(pkg.status)} /><ConfigSidebarText className={`is-grow${pkg.disabled ? " is-muted" : ""}`}>{nameOf(pkg)}</ConfigSidebarText></ConfigSidebarItem>)}
                        </div>;
                      })}
                    </>}
            </ConfigSidebarList>
          </ConfigSidebar>
          <ConfigDetail>
            <div className="plugins-detail-toolbar">
              <button type="button" className="plugins-list-back" onClick={() => setMobileDetail(false)}>{t("plugins.installed")} ({packages.length + standaloneExtensions.length})</button>
              {showingDetail && <ConfigButton size="small" onClick={returnToCatalog}>← {t("plugins.backToCatalog")}</ConfigButton>}
              <a href="https://pi.dev/packages" target="_blank" rel="noopener noreferrer">{t("plugins.browse")} ↗</a>
            </div>
            <div className="plugins-content">
              {!showingDetail && <>
                <header className="plugins-catalog-heading"><div><h2>{t("plugins.browsePlugins")}</h2><p>{t("plugins.discoveryIntro")}</p></div><input type="search" className="plugins-search-input" aria-label={t("plugins.searchCatalog")} placeholder={t("plugins.searchCatalog")} value={catalogQuery} maxLength={150} onChange={event => updateQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") setCatalogRetry(value => value + 1); }} /></header>
                <div className="plugins-catalog-options"><ConfigScopeSwitch value={installScope} label={t("config.saveTo")} options={[{ value: "global", label: scopeLabel("global", t), disabled: footerBusy }, { value: "project", label: scopeLabel("project", t), disabled: !projectResourcesLoaded || footerBusy }]} disabledReason={!projectResourcesLoaded ? t("trust.projectScopeUnavailable") : undefined} onChange={setInstallScope} />{catalog && <span>{t("plugins.resultCount", { count: catalog.total })}</span>}</div>
              </>}
              {!managedPackage && actionMessage && <p role="status" className="plugins-action-message">{actionMessage}</p>}
              {!managedPackage && actionError && <p role="alert" className="plugins-action-error">{actionError}</p>}
              {managedPackage ? <><PackageDetail key={packageKey(managedPackage)} pkg={managedPackage} cwd={cwd ?? ""} busyKey={busyKey} actionError={actionError} actionMessage={actionMessage} sessionId={sessionId} updateStatus={updateStatuses[packageKey(managedPackage)]} checkingUpdate={checkingUpdates.has(packageKey(managedPackage))} updateError={updateError} onAction={runAction} onCheckUpdate={() => void checkForUpdates(managedPackage)} onReloadSession={reloadSession} />{sourceInfo}</>
                : selectedExtension ? <StandaloneExtensionDetail extension={selectedExtension} />
                  : selectedCatalog ? <>
                    <header className="plugin-detail-heading"><PluginLogo name={selectedCatalog.name} url={selectedCatalog.logo} /><div><h2>{selectedCatalog.name}</h2><span>{currentSourceDetail?.author ?? selectedCatalog.author}</span></div><ConfigButton variant="primary" disabled={footerBusy || Boolean(error)} onClick={() => void installPlugin(selectedCatalog)}>{t(busyKey?.startsWith("install:") ? "i18n.installing" : "i18n.install")}</ConfigButton></header>
                    <PluginDescription text={currentSourceDetail?.description ?? selectedCatalog.description} />
                    <div className="plugin-detail-scope"><ConfigScopeSwitch value={installScope} label={t("config.saveTo")} options={[{ value: "global", label: scopeLabel("global", t), disabled: footerBusy }, { value: "project", label: scopeLabel("project", t), disabled: !projectResourcesLoaded || footerBusy }]} disabledReason={!projectResourcesLoaded ? t("trust.projectScopeUnavailable") : undefined} onChange={setInstallScope} /></div>{sourceInfo}
                  </> : <>
                    {catalogError && <div className="plugins-load-status" role="alert"><span>{catalogError}</span><ConfigButton size="small" onClick={() => setCatalogRetry(value => value + 1)}>{t("plugins.retry")}</ConfigButton></div>}
                    {!catalog && catalogLoading ? <div className="plugins-card-grid plugins-skeleton" aria-label={t("plugins.searching")} role="status">{Array.from({ length: 9 }, (_, i) => <div className="plugin-card" key={i}><span /><p /><p /></div>)}</div>
                        : catalog?.items.length ? <div className="plugins-card-grid">{catalog.items.map(item => {
                          const installed = packages.find(pkg => pkg.scope === installScope && pkg.status !== "missing" && (pkg.packageName === item.name || parseNpmSource(pkg.source)?.name === item.name));
                          const installing = busyKey === `install:${installScope}\0${item.source}`;
                          return <article className="plugin-card" key={item.source} onPointerEnter={() => warmDetail(item.name)} onPointerLeave={cancelHover} onFocus={event => { if (!(event.target as HTMLElement).closest(".plugin-card-footer")) warmDetail(item.name); }} onBlur={cancelHover} onClick={event => { if (!(event.target as HTMLElement).closest("button,a")) openCatalogDetail(item); }}>
                            <div className="plugin-card-heading"><PluginLogo name={item.name} url={item.logo ?? logoUrls[item.name]} /><h3><button type="button" onClick={() => openCatalogDetail(item)}>{item.name}</button></h3></div><PluginDescription text={item.description} />
                            <div className="plugin-card-footer"><span>{item.author ?? item.types.join(" · ")}</span><ConfigButton size="small" className={installed ? "is-installed" : undefined} variant={installed ? "secondary" : "primary"} disabled={Boolean(installed) || footerBusy || Boolean(error)} onClick={() => void installPlugin(item)}>{t(installed ? "plugins.alreadyInstalled" : installing ? "i18n.installing" : "i18n.install")}</ConfigButton></div>
                          </article>;
                        })}</div> : !catalogLoading && !catalogError && <div className="plugins-state">{t("plugins.noCatalogResults")}</div>}
                    {catalog && <div ref={sentinel} className="plugins-load-status" aria-live="polite">
                      {moreError ? <><span>{t("plugins.loadMoreFailed")}</span><ConfigButton size="small" onClick={loadMore}>{t("plugins.retry")}</ConfigButton></> : moreLoading ? t("plugins.loadingMore") : catalog.hasNext ? <ConfigButton size="small" onClick={loadMore}>{t("plugins.loadMore")}</ConfigButton> : catalog.items.length > 0 ? t("plugins.allLoaded") : null}
                    </div>}
                  </>}
            </div>
          </ConfigDetail>
        </ConfigSplitView>
        <ConfigFooter status={
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
            <ConfigFooterStatus summary={data ? totalsSummary(data.totals, t) : ""} />
          )}
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
          <ConfigButton variant="secondary" onClick={() => void loadPlugins()} disabled={footerBusy}>
            {t("i18n.refresh")}
          </ConfigButton>
        </ConfigFooter>
      </ConfigPanelShell>
    </div>;
}
