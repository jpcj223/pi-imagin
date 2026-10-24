"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { SidebarMenu, type SidebarMenuItem } from "./SidebarMenu";
import { ResourcePath } from "./ResourcePath";
import { ChevronIcon } from "./SidebarIcons";

export interface ResourceProjectOption { key: string; name: string; cwd: string; projectId?: string }

/** 插件和技能共用安装目标选择；选择项目不切换当前对话。 */
export function ResourceInstallTarget({ value, projects, path, error, note, pending = false, loading = false, onChange }: {
  value: string; projects: readonly ResourceProjectOption[]; path?: string; error?: string | null; note?: string;
  onChange: (key: string) => void;
  pending?: boolean;
  loading?: boolean;
}) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);
  const project = projects.find(project => project.key === value);
  const items: SidebarMenuItem[] = [
    { type: "header", id: "other-projects", label: t("resources.otherProjects") },
    ...projects.map(project => ({ type: "item" as const, id: project.key, label: project.name, title: project.cwd, checked: value === project.key, onSelect: () => onChange(project.key) })),
  ];
  return <div className="resource-install-target">
    <div className="resource-install-target-row"><span>{t("resources.installTarget")}</span>
      <div className="config-scope-switch" role="group" aria-label={t("resources.installTarget")}>
        <button type="button" className={`config-scope-switch-option${!project ? " is-active" : ""}`} data-resource-install-global aria-pressed={!project} disabled={pending} onClick={() => { setOpener(null); onChange("default"); }}>{t("skills.scope.global")}</button>
        <button type="button" className={`config-scope-switch-option${project ? " is-active" : ""}`} data-resource-install-target aria-pressed={!!project} disabled={pending} aria-busy={pending} aria-haspopup="menu" aria-expanded={!!opener} onClick={event => setOpener(opener ? null : event.currentTarget)}>
          {t("skills.scope.project")}<ChevronIcon size={10} className="sidebar-icon-down" />
        </button>
      </div>
      <div className="resource-install-target-summary">
        {project && <span className="resource-install-project-name">{project.name}</span>}
        {path && <ResourcePath path={path} />}
      </div>
    </div>
    <div className="resource-install-target-status" aria-live="polite" aria-atomic="true">
      {error ? <span role="alert">{error}</span> : loading ? <span>{t("resources.loadingInstalled")}</span> : note ? <span>{note}</span> : null}
    </div>
    <SidebarMenu open={!!opener} anchor={opener ? { kind: "rect", rect: opener.getBoundingClientRect(), align: "start" } : null}
      sheet={mobile} ariaLabel={t("resources.installTarget")} title={t("resources.installTarget")} items={items} width={280} compact
      filter={{ placeholder: t("project.search"), emptyLabel: t("project.noMatches") }} onClose={() => setOpener(null)} returnFocusTo={opener} cancelLabel={t("sidebar.cancel")} />
  </div>;
}
