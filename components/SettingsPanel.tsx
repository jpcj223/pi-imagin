"use client";

import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { DEFAULT_LOCALE, useI18n } from "@/hooks/useI18n";
import { resetFontPreference } from "@/hooks/useFontPreferences";
import { useTheme } from "@/hooks/useTheme";
import { THEME_OPTIONS } from "@/lib/theme";
import { ThemeIcon } from "./ThemeIcon";
import {
  CHAT_CONTENT_WIDTH_DEFAULT,
  CHAT_CONTENT_WIDTH_MAX,
  CHAT_CONTENT_WIDTH_MIN,
  CHAT_CONTENT_FONT_SIZE_DEFAULT,
  CHAT_CONTENT_FONT_SIZE_MAX,
  CHAT_CONTENT_FONT_SIZE_MIN,
  useChatAppearance,
} from "@/hooks/useChatAppearance";
import { ENTER_SEND_MODE_DEFAULT, useEnterSendMode, setEnterSendMode } from "@/hooks/useEnterSendMode";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ProjectTrustStatus } from "@/lib/api-types";
import { ShellProfilesSettings } from "./ShellProfilesSettings";
import {
  isResourcePage,
  setLastSettingsSection,
  settingsSectionRequiresProject,
  type SettingsSection,
} from "@/lib/settings-navigation";
import { focusModalPanel, listenForPanelEscape } from "@/lib/stacked-dialog";
import {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
} from "@/lib/thinking-expansion-preference";
import { ModelsConfig } from "./ModelsConfig";
import { setupPushSubscription } from "@/lib/push-client";
import type { NewSessionContext } from "@/lib/new-session-context";
import { useResourceInstallTarget } from "@/hooks/useResourceInstallTarget";
import { ResourceInstallTarget } from "./ResourceInstallTarget";
import { ProjectTrustDialog, type ProjectTrustFailure } from "./ProjectTrustDialog";
import { ProjectTrustBadge } from "./ProjectTrustBadge";
import { SkillsConfig } from "./SkillsConfig";
import { AgentsConfig } from "./AgentsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { McpWorkspace } from "./McpWorkspace";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";
import { FontSettings } from "./FontSettings";
import { SIDEBAR_DEFAULT_WIDTH } from "@/lib/panel-layout";

interface Props {
  open?: boolean;
  embedded?: boolean;
  sidebarOffset?: number;
  workspaceSidebarWidth?: number;
  workspaceLayoutRef?: RefObject<HTMLDivElement | null>;
  sidebarSeparatorProps?: HTMLAttributes<HTMLDivElement>;
  sidebarResizing?: boolean;
  cwd: string | null;
  sessionId: string | null;
  initialSection: SettingsSection;
  onClose: () => void;
  onHome?: () => void;
  onSessionReloaded: () => void;
  quoteSelectionEnabled: boolean;
  onQuoteSelectionChange: (enabled: boolean) => void;
  /** The page's trust status for `cwd`; Settings › MCP reloads when it changes, as after trusting. */
  projectTrust?: ProjectTrustStatus | null;
  projectContext?: NewSessionContext | null;
  /** Opens the page's trust dialog for `cwd`, above Settings; Settings › MCP's trust notice offers it. */
  onOpenTrustDialog?: () => void;
  /** Settings › MCP added a project server, which changed `cwd`'s trust (and may have trusted a fresh folder). */
  onProjectTrustChanged?: (cwd: string, status: ProjectTrustStatus) => void;
}

export function SettingsSectionIcon({ section, size = 16, strokeWidth = 1.8 }: { section: SettingsSection; size?: number; strokeWidth?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "settings-section-icon",
  };

  if (section === "general") return <svg {...common}><path d="M20 7h-9M14 17H5" /><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /></svg>;
  if (section === "models") return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" /></svg>;
  if (section === "skills") return <svg {...common}><path d="m12 2-10 5 10 5 10-5-10-5Z" /><path d="m2 12 10 5 10-5M2 17l10 5 10-5" /></svg>;
  if (section === "agents") return <svg {...common} className="settings-section-icon is-agent"><rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" /></svg>;
  if (section === "mcp") return <svg {...common}><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" /></svg>;
  return <svg {...common}><path d="M9 7V2M15 7V2M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0ZM12 19v3" /></svg>;
}

function GeneralSettings({ sessionId, onSessionReloaded, quoteSelectionEnabled, onQuoteSelectionChange }: Pick<Props, "sessionId" | "onSessionReloaded" | "quoteSelectionEnabled" | "onQuoteSelectionChange">) {
  const { locale, setLocale, supportedLocales, t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  const { width: chatContentWidth, setWidth: setChatContentWidth, fontSize, setFontSize } = useChatAppearance();
  const enterSendMode = useEnterSendMode();
  const [shellSaving, setShellSaving] = useState(false);
  const [shellRevision, setShellRevision] = useState(0);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [cacheMissNotices, setCacheMissNotices] = useState<boolean | null>(null);
  const [cacheMissNoticesSaving, setCacheMissNoticesSaving] = useState(false);
  const [cacheMissNoticesError, setCacheMissNoticesError] = useState<string | null>(null);
  const [pushRegistering, setPushRegistering] = useState(false);
  const [pushStatus, setPushStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [webAuthEnabled, setWebAuthEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<"done" | "reload" | "failed" | null>(null);
  const [resetError, setResetError] = useState("");

  useEffect(() => {
    setThinkingExpanded(isThinkingExpandedByDefault());
    void fetch("/api/web-auth")
      .then((response) => response.ok ? response.json() : null)
      .then((data: { enabled?: boolean } | null) => setWebAuthEnabled(data?.enabled === true))
      .catch(() => {});
  }, []);

  const logOut = async () => {
    setLoggingOut(true);
    setLogoutError("");
    try {
      const response = await fetch("/api/web-auth", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      window.location.replace("/login");
    } catch {
      setLogoutError(t("auth.logoutFailed"));
    } finally {
      setLoggingOut(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/cache-miss-notices")
      .then(async (response) => {
        const data = await response.json() as { enabled?: boolean; error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setCacheMissNotices(data.enabled === true);
      })
      .catch((cause) => {
        if (!cancelled) setCacheMissNoticesError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  // 更新 showCacheMissNotices 后重读当前会话，使通知同步显示或隐藏。
  const toggleCacheMissNotices = async (enabled: boolean) => {
    setCacheMissNoticesSaving(true);
    setCacheMissNoticesError(null);
    try {
      const response = await fetch("/api/cache-miss-notices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as { enabled?: boolean; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setCacheMissNotices(data.enabled === true);
      if (sessionId) onSessionReloaded();
    } catch (cause) {
      setCacheMissNoticesError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCacheMissNoticesSaving(false);
    }
  };

  const registerPush = async () => {
    if (pushRegistering) return;
    setPushRegistering(true);
    setPushStatus(null);
    try {
      if (typeof window === "undefined" || !("Notification" in window)) {
        throw new Error("unsupported or not permitted");
      }
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") throw new Error("unsupported or not permitted");
      const ok = await setupPushSubscription(locale);
      if (!ok) throw new Error("unsupported or not permitted");
      setPushStatus({ kind: "ok", message: t("settings.pushRegistered") });
    } catch (cause) {
      setPushStatus({ kind: "error", message: `${t("settings.pushRegisterFailed")} ${cause instanceof Error ? cause.message : String(cause)}` });
    } finally {
      setPushRegistering(false);
    }
  };

  const restoreDefaults = async () => {
    if (resetting || shellSaving) return;
    setResetting(true);
    setResetStatus(null);
    setResetError("");
    try {
      // 先完成可能失败的共享 Shell 写入，再恢复本机偏好；只通过现有接口更新这一项。
      const response = await fetch("/api/shell-profiles", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }),
      });
      const tools = await response.json() as { error?: string };
      if (!response.ok || tools.error) throw new Error(tools.error ?? `HTTP ${response.status}`);
      setShellRevision(value => value + 1);
      window.dispatchEvent(new Event("pi-shell-profiles-changed"));
      resetFontPreference("ui");
      resetFontPreference("mono");
      setFontSize(CHAT_CONTENT_FONT_SIZE_DEFAULT);
      setChatContentWidth(CHAT_CONTENT_WIDTH_DEFAULT);
      setThinkingExpandedByDefault(false);
      setThinkingExpanded(false);
      onQuoteSelectionChange(false);
      setEnterSendMode(ENTER_SEND_MODE_DEFAULT);
      setLocale(DEFAULT_LOCALE);
      setThemePreference("light");
      setResetConfirm(false);
      if (sessionId) {
        try {
          await sendAgentCommand(sessionId, { type: "reload" });
          onSessionReloaded();
        } catch {
          setResetStatus("reload");
          return;
        }
      }
      setResetStatus("done");
    } catch (cause) {
      setResetStatus("failed");
      setResetError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="settings-general">
      <fieldset className="settings-general-preferences" disabled={resetting}>
      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.appearance")}</h3>
        <div role="radiogroup" aria-label={t("settings.appearance")} className="settings-theme-options">
          {THEME_OPTIONS.map((option) => {
            const selected = preference === option.id;
            return (
              <label
                key={option.id}
                className="settings-theme-option"
              >
                <input
                  type="radio"
                  name="theme"
                  value={option.id}
                  checked={selected}
                  onChange={() => setThemePreference(option.id)}
                  className="sr-only"
                />
                <ThemeIcon preference={option.id} />
                <span className="settings-theme-option-label">{t(option.label)}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.typography")}</h3>
        <p id="settings-typography-description" className="settings-general-description">{t("settings.fontDescription")}</p>
        <div className="settings-chat-options">
          <FontSettings />
          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label htmlFor="settings-chat-content-font-size">{t("settings.chatContentFontSize")}</label>
              <output htmlFor="settings-chat-content-font-size">{fontSize}px</output>
              <ConfigButton
                variant="ghost"
                size="small"
                className="settings-chat-reset"
                title={t("settings.resetChatContentFontSize")}
                aria-label={t("settings.resetChatContentFontSize")}
                disabled={fontSize === CHAT_CONTENT_FONT_SIZE_DEFAULT}
                onClick={() => setFontSize(CHAT_CONTENT_FONT_SIZE_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </ConfigButton>
            </div>
            <input
              id="settings-chat-content-font-size"
              type="range"
              min={CHAT_CONTENT_FONT_SIZE_MIN}
              max={CHAT_CONTENT_FONT_SIZE_MAX}
              step={1}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
          </div>
          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label htmlFor="settings-chat-content-width">{t("settings.chatContentWidth")}</label>
              <output htmlFor="settings-chat-content-width">{chatContentWidth}px</output>
              <ConfigButton
                variant="ghost"
                size="small"
                className="settings-chat-reset"
                title={t("settings.resetChatContentWidth")}
                aria-label={t("settings.resetChatContentWidth")}
                disabled={chatContentWidth === CHAT_CONTENT_WIDTH_DEFAULT}
                onClick={() => setChatContentWidth(CHAT_CONTENT_WIDTH_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </ConfigButton>
            </div>
            <input
              id="settings-chat-content-width"
              type="range"
              min={CHAT_CONTENT_WIDTH_MIN}
              max={CHAT_CONTENT_WIDTH_MAX}
              step={10}
              value={chatContentWidth}
              onChange={(event) => setChatContentWidth(Number(event.target.value))}
            />
          </div>
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.chat")}</h3>
        <div className="settings-chat-options">
          <div className="settings-chat-option settings-chat-switch-option">
            <span>{t("settings.thinkingExpandedDefault")}</span>
            <ConfigSwitch
              checked={thinkingExpanded}
              label={t("settings.thinkingExpandedDefault")}
              onChange={(enabled) => {
                setThinkingExpandedByDefault(enabled);
                setThinkingExpanded(enabled);
              }}
            />
          </div>
          <div className="settings-chat-option settings-chat-switch-option">
            <span>{t("settings.quoteSelection")}</span>
            <ConfigSwitch
              checked={quoteSelectionEnabled}
              label={t("settings.quoteSelection")}
              onChange={onQuoteSelectionChange}
            />
          </div>
          <div className="settings-chat-option settings-chat-switch-option" role="radiogroup" aria-label={t("settings.enterSendMode")}>
            <span>{t("settings.enterSendMode")}</span>
            <div className="settings-send-mode-options">
              <label className="settings-send-mode-option">
                <input
                  type="radio"
                  name="enter-send-mode"
                  value="enter"
                  checked={enterSendMode === "enter"}
                  onChange={() => setEnterSendMode("enter")}
                  className="sr-only"
                />
                <span className="settings-send-mode-label">{t("settings.enterSendModeEnter")}</span>
              </label>
              <label className="settings-send-mode-option">
                <input
                  type="radio"
                  name="enter-send-mode"
                  value="ctrlEnter"
                  checked={enterSendMode === "ctrlEnter"}
                  onChange={() => setEnterSendMode("ctrlEnter")}
                  className="sr-only"
                />
                <span className="settings-send-mode-label">{t("settings.enterSendModeCtrlEnter")}</span>
              </label>
            </div>
          </div>
          <div className="settings-chat-option settings-chat-switch-option">
            <span>{t("settings.cacheMissNotices")}</span>
            <ConfigSwitch
              checked={cacheMissNotices === true}
              loading={(cacheMissNotices === null && !cacheMissNoticesError) || cacheMissNoticesSaving}
              label={t("settings.cacheMissNotices")}
              describedBy="settings-cache-miss-notices-description"
              onChange={(enabled) => void toggleCacheMissNotices(enabled)}
            />
          </div>
        </div>
        <p id="settings-cache-miss-notices-description" className="settings-general-description">{t("settings.cacheMissNoticesDescription")}</p>
        {cacheMissNoticesError && <p role="alert" className="settings-general-error">{cacheMissNoticesError}</p>}
      </section>

      <ShellProfilesSettings disabled={resetting} revision={shellRevision} onBusy={setShellSaving} />

      <section className="settings-general-section">
        <details className="settings-push-details">
          <summary>{t("settings.pushPermission")}</summary>
          <div className="settings-push-content">
            <p id="settings-push-description" className="settings-general-description">{t("settings.pushPermissionDescription")}</p>
            <button
              type="button"
              className="config-button config-button-small config-button-secondary"
              disabled={pushRegistering}
              aria-describedby="settings-push-description"
              onClick={() => void registerPush()}
            >
              {pushRegistering ? t("settings.pushRegisterLoading") : t("settings.pushRegister")}
            </button>
            {pushStatus && (
              <p
                role="status"
                className="settings-general-error"
                style={pushStatus.kind === "ok" ? { color: "var(--accent)" } : undefined}
              >
                {pushStatus.message}
              </p>
            )}
          </div>
        </details>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("common.language")}</h3>
        <div role="radiogroup" aria-label={t("common.language")} className="settings-language-options">
          {supportedLocales.map((language) => {
            const selected = locale === language.id;
            return (
              <button
                key={language.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setLocale(language.id as typeof locale)}
                className="settings-language-option"
              >
                <span className="settings-language-radio">
                  {selected && <span className="settings-language-radio-dot" />}
                </span>
                <span className="settings-language-label">{language.label}</span>
                <span className="settings-language-code">{language.id}</span>
              </button>
            );
          })}
        </div>
      </section>

      </fieldset>

      <section className="settings-general-section settings-reset-section">
        <div className="settings-reset-heading">
          <div>
            <h3 className="settings-general-heading">{t("settings.restoreDefaults")}</h3>
            <p id="settings-reset-scope" className="settings-general-description">{t("settings.restoreDefaultsScope")}</p>
          </div>
          {!resetConfirm && <ConfigButton variant="secondary" size="small" disabled={resetting || shellSaving} aria-describedby="settings-reset-scope" onClick={() => { setResetConfirm(true); setResetStatus(null); }}>{t("settings.restoreDefaultsAction")}</ConfigButton>}
        </div>
        {resetConfirm && <div className="settings-reset-confirm" role="group" aria-label={t("settings.restoreDefaults")}>
          <p>{t("settings.restoreDefaultsConfirm")}</p>
          <div>
            <ConfigButton variant="secondary" size="small" disabled={resetting} onClick={() => setResetConfirm(false)}>{t("i18n.cancel")}</ConfigButton>
            <ConfigButton size="small" disabled={resetting || shellSaving} onClick={() => void restoreDefaults()}>{t(resetting ? "settings.restoringDefaults" : "settings.confirmRestoreDefaults")}</ConfigButton>
          </div>
        </div>}
        {resetStatus && <p role={resetStatus === "failed" ? "alert" : "status"} className={`settings-reset-status${resetStatus === "failed" ? " is-error" : ""}`}>
          {t(resetStatus === "done" ? "settings.defaultsRestored" : resetStatus === "reload" ? "settings.defaultsReloadFailed" : "settings.defaultsRestoreFailed")}{resetError && ` ${resetError}`}
        </p>}
      </section>

      {webAuthEnabled && (
        <section className="settings-general-section">
          <ConfigButton variant="secondary" disabled={loggingOut} onClick={() => void logOut()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            </svg>
            {loggingOut ? t("auth.loggingOut") : t("auth.logOut")}
          </ConfigButton>
          {logoutError && <p role="alert" className="settings-general-error">{logoutError}</p>}
        </section>
      )}
    </div>
  );
}

export function SettingsPanel({
  open = true,
  embedded = false,
  sidebarOffset = 0,
  workspaceSidebarWidth = SIDEBAR_DEFAULT_WIDTH,
  workspaceLayoutRef,
  sidebarSeparatorProps,
  sidebarResizing = false,
  cwd,
  sessionId,
  initialSection,
  onClose,
  onHome,
  onSessionReloaded,
  quoteSelectionEnabled,
  onQuoteSelectionChange,
  projectTrust,
  projectContext,
  onProjectTrustChanged,
}: Props) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [mountedSections, setMountedSections] = useState<ReadonlySet<SettingsSection>>(
    () => new Set([section]),
  );
  // Which sections need a project is decided once, in lib/settings-navigation.ts.
  const sections: { id: SettingsSection; label: string; requiresProject: boolean }[] = ([
    { id: "general", label: t("settings.general") },
    { id: "models", label: t("common.models") },
    { id: "agents", label: t("common.agents") },
    { id: "mcp", label: t("settings.mcp") },
  ] as const).map((item) => ({ ...item, requiresProject: settingsSectionRequiresProject(item.id) }));
  const sectionRequiresProject = settingsSectionRequiresProject(section);

  useLayoutEffect(() => {
    if (!open) return;
    setSection(initialSection);
    setMountedSections(current => new Set(current).add(initialSection));
    setLastSettingsSection(initialSection);
  }, [initialSection, open]);

  // Bubble phase, unless something nearer handled the key. The trust dialog,
  // which opens above Settings, takes Escape in the capture phase and stops it,
  // so one Escape closes that dialog and leaves Settings open.
  useEffect(() => open ? listenForPanelEscape(document, onClose) : undefined, [onClose, open]);

  // Focus moves into Settings as it opens and back to what had it once it closes. Left
  // on the chat composer (a bare /mcp opens Settings from there), Escape would reach the
  // composer first and stop a running agent, which also kept Settings open. A layout
  // effect, so the opener is read before a section focuses its own search box.
  const dialogRef = useRef<HTMLDivElement>(null);
  const resourcePage = embedded && isResourcePage(open ? initialSection : section);
  const pageTitle = resourcePage ? (open ? initialSection : section) === "skills" ? "common.skills" : "common.plugins" : "settings.title";
  const skillsTarget = useResourceInstallTarget(cwd, projectTrust, projectContext, open && section === "skills", "skills");
  const pluginsTarget = useResourceInstallTarget(cwd, projectTrust, projectContext, open && section === "plugins", "plugins");
  const resourceTarget = (open ? initialSection : section) === "skills" ? skillsTarget : pluginsTarget;
  const [resourceTrustOpen, setResourceTrustOpen] = useState(false);
  const [resourceTrustBusy, setResourceTrustBusy] = useState(false);
  const [resourceTrustError, setResourceTrustError] = useState<ProjectTrustFailure | null>(null);
  useEffect(() => { setResourceTrustOpen(false); setResourceTrustError(null); }, [resourceTarget.cwd, section]);
  const acceptResourceTrust = (status: ProjectTrustStatus) => {
    resourceTarget.acceptTrust(status);
    if (resourceTarget.cwd) onProjectTrustChanged?.(resourceTarget.cwd, status);
  };
  const confirmResourceTrust = async () => {
    if (!resourceTarget.cwd || resourceTrustBusy) return;
    const targetCwd = resourceTarget.cwd;
    setResourceTrustBusy(true); setResourceTrustError(null);
    try {
      const response = await fetch("/api/project-trust", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: targetCwd }) });
      const data = await response.json();
      if (!response.ok || data.error) { setResourceTrustError({ error: data.error || `HTTP ${response.status}`, reason: data.reason }); return; }
      acceptResourceTrust(data); setResourceTrustOpen(false);
      if (targetCwd === cwd) onSessionReloaded();
    } catch (error) { setResourceTrustError({ error: String(error) }); }
    finally { setResourceTrustBusy(false); }
  };
  const renderInstallTarget = (target: typeof skillsTarget, path?: string, state?: { loading?: boolean; busy?: boolean }) => <ResourceInstallTarget value={target.value} projects={target.projects} pending={target.selecting || state?.busy} loading={target.selecting || state?.loading} path={path} error={target.error} note={target.scope === "project" && target.trust && !target.trust.trusted ? t("trust.projectScopeUnavailable") : undefined} onChange={key => void target.select(key)} />;

  useLayoutEffect(() => open ? focusModalPanel(document, dialogRef.current, {
    restoreTextEntry: !window.matchMedia?.("(pointer: coarse)").matches,
  }) : undefined, [open, resourcePage]);

  useEffect(() => {
    if (cwd || !sectionRequiresProject) return;
    setSection("general");
    setMountedSections((current) => new Set(current).add("general"));
    setLastSettingsSection("general");
  }, [cwd, sectionRequiresProject]);

  const activateSection = (nextSection: SettingsSection) => {
    setMountedSections((current) => new Set(current).add(nextSection));
    setSection(nextSection);
    setLastSettingsSection(nextSection);
  };

  const sectionHost = (id: SettingsSection, content: ReactNode) => mountedSections.has(id) ? (
    <div
      key={id}
      hidden={section !== id}
      className="settings-section-host"
      data-settings-section={id}
    >
      {content}
    </div>
  ) : null;

  const sectionNavigation = (
<nav aria-label={t("settings.title")} className="settings-section-tabs">
            {sections.map((item) => {
              const selected = section === item.id;
              const disabled = item.requiresProject && !cwd;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="settings-section-tab"
                  disabled={disabled}
                  title={disabled ? t("settings.projectRequired") : item.label}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => activateSection(item.id)}
                >
                  <SettingsSectionIcon section={item.id} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
  );

  return (
    <div
      ref={(node) => { dialogRef.current = node; if (workspaceLayoutRef) workspaceLayoutRef.current = node; }}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-label={t(pageTitle)}
      tabIndex={-1}
      onClick={(event) => { if (!embedded && event.target === event.currentTarget) onClose(); }}
      className={embedded ? `settings-workspace-page${resourcePage ? ` resource-workspace-page ${(open ? initialSection : section) === "skills" ? "skills" : "plugins"}-workspace-page` : ""}` : "settings-dialog-backdrop"}
      hidden={!open}
      inert={!open}
      style={embedded ? { left: sidebarOffset, "--workspace-sidebar-width": `${workspaceSidebarWidth}px` } as React.CSSProperties : undefined}
    >
      <div className="settings-dialog-surface">
        {embedded && sidebarSeparatorProps && <div
          {...sidebarSeparatorProps}
          className={`settings-sidebar-resizer${sidebarResizing ? " is-resizing" : ""}`}
          data-testid="settings-sidebar-resizer"
        />}
        <div className="settings-dialog-header">
          {resourcePage && <button type="button" className="plugins-mobile-home" onClick={onHome ?? onClose} aria-label={t("plugins.home")} title={t("plugins.home")}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m3 10 9-7 9 7v10H14v-7h-4v7H3Z" /></svg></button>}
          {embedded && !resourcePage && <button type="button" className="settings-mobile-home" onClick={onHome ?? onClose} aria-label={t("plugins.home")} title={t("plugins.home")}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m3 10 9-7 9 7v10H14v-7h-4v7H3Z" /></svg></button>}
          <strong className="settings-dialog-title">{t(pageTitle)}</strong>
          {resourcePage && <ProjectTrustBadge status={resourceTarget.trust} onClick={() => setResourceTrustOpen(true)} />}
          <select
            aria-label={t("settings.title")}
            value={section}
            onChange={(event) => activateSection(event.target.value as SettingsSection)}
            className="settings-mobile-section-picker"
            hidden={resourcePage}
          >
            {sections.map((item) => (
              <option key={item.id} value={item.id} disabled={item.requiresProject && !cwd}>
                {item.label}
              </option>
            ))}
          </select>
          {!embedded && sectionNavigation}
          {!embedded && <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="config-close-button settings-dialog-close">×</button>}
        </div>

        <div className={embedded ? `workspace-settings-body${resourcePage ? " is-resource" : ""}` : undefined}>
          {embedded && !resourcePage && sectionNavigation}
        <main className="settings-dialog-main">
          {sectionHost("general", <GeneralSettings sessionId={sessionId} onSessionReloaded={onSessionReloaded} quoteSelectionEnabled={quoteSelectionEnabled} onQuoteSelectionChange={onQuoteSelectionChange} />)}
          {sectionHost("models", <ModelsConfig embedded cwd={cwd} onClose={onClose} />)}
          {/* Visited sections stay mounted, so the ones whose answer depends on trust take the page's
              status and load again in place when trusting from Settings › MCP changes it. */}
          {sectionHost("skills", <SkillsConfig embedded workspace active={open && section === "skills"} cwd={skillsTarget.cwd} trust={skillsTarget.trust} targetScope={skillsTarget.scope} targetPending={skillsTarget.selecting} renderInstallTarget={(path, state) => renderInstallTarget(skillsTarget, path, state)} onClose={onClose} />)}
          {sectionHost("agents", <AgentsConfig embedded cwd={cwd} projectContext={projectContext} active={open && section === "agents"} sessionId={sessionId} trust={projectTrust} onClose={onClose} onReloaded={onSessionReloaded} />)}
          {sectionHost("plugins", <PluginsConfig embedded workspace active={open && section === "plugins"} cwd={pluginsTarget.cwd} sessionId={pluginsTarget.cwd === cwd ? sessionId : null} trust={pluginsTarget.trust} targetScope={pluginsTarget.scope} targetPending={pluginsTarget.selecting} renderInstallTarget={(path, state) => renderInstallTarget(pluginsTarget, path, state)} onClose={onClose} onReloaded={onSessionReloaded} />)}
          {/* No project needed: the global mcp.json is listed alone, and a project adds its group. */}
          {sectionHost("mcp", <McpWorkspace cwd={cwd} trust={projectTrust} projectContext={projectContext} active={open && section === "mcp"} onProjectTrustChanged={onProjectTrustChanged} onClose={onClose} />)}
        </main>
        </div>
      </div>
      {resourceTrustOpen && resourceTarget.cwd && <ProjectTrustDialog key={resourceTarget.cwd} cwd={resourceTarget.cwd} busy={resourceTrustBusy} error={resourceTrustError} onCancel={() => { if (!resourceTrustBusy) setResourceTrustOpen(false); }} onConfirm={() => void confirmResourceTrust()} onStatus={acceptResourceTrust} />}
    </div>
  );
}
