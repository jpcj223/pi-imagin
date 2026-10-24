"use client";
import { useI18n } from "@/hooks/useI18n";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import type { NewSessionContext, NewSessionTarget } from "@/lib/new-session-context";
import { newSessionProjectOptions } from "@/lib/new-session-project";
import { projectNameOf } from "@/lib/session-tree";
import { SidebarMenu, type SidebarMenuItem } from "./SidebarMenu";
import { ChevronIcon, FolderIcon, PlusIcon } from "./SidebarIcons";

export type NewSessionProjectControl = "project" | "directory";
export interface NewSessionProjectPickerHandle { button(control: NewSessionProjectControl): HTMLButtonElement | null }

/** 保留项目选择，执行目录入口暂不对用户开放；目录选择逻辑保持兼容。 */
export function NewSessionProjectPicker({ context, mobile, handleRef, onPick, onClear, onAdd }: {
  context: NewSessionContext; mobile: boolean; handleRef: Ref<NewSessionProjectPickerHandle>;
  onPick: (target: NewSessionTarget, control: NewSessionProjectControl) => void;
  onClear: () => void; onAdd: (opener: HTMLElement) => void;
}) {
  const { t } = useI18n();
  const projectButton = useRef<HTMLButtonElement>(null), directoryButton = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ kind: NewSessionProjectControl; opener: HTMLElement } | null>(null);
  useImperativeHandle(handleRef, () => ({ button: control => control === "project" ? projectButton.current : directoryButton.current }), []);
  const managed = context.managedProjects?.find(project => project.id === context.managedProjectId);
  const associated = !context.defaultWorkspace;
  const selectedKey = managed ? `managed:${managed.id}` : context.project.key;
  const selectedName = managed?.name ?? context.project.alias ?? projectNameOf(context.project.root);
  const options = newSessionProjectOptions(context);
  const pick = (target: NewSessionTarget, control: NewSessionProjectControl) => { setMenu(null); onPick(target, control); };
  const projectItems: SidebarMenuItem[] = options.map(option => ({
    type: "item", id: option.key, label: option.name, note: option.key.startsWith("managed:") ? (() => { const count = context.managedProjects?.find(project => `managed:${project.id}` === option.key)?.folders.length ?? 0; return t(count ? "project.folderCount" : "project.noLinkedFolders", { count }); })() : option.note,
    checked: associated && option.key === selectedKey,
    title: option.target.cwd,
    onSelect: () => {
      // 重选当前项目不把已选的后端目录或工作树重置为默认目录。
      if (!associated || option.key !== selectedKey) pick(option.target, "project");
    },
  }));
  if (projectItems.length) projectItems.push({ type: "separator", id: "actions" });
  projectItems.push({ type: "item", id: "add-project", label: t("project.add"), icon: <PlusIcon size={13} />,
    onSelect: () => { if (menu) onAdd(menu.opener); } });
  const open = (kind: NewSessionProjectControl, opener: HTMLButtonElement) => setMenu(previous => previous?.kind === kind ? null : { kind, opener });
  return <div className="new-session-project-picker">
    <div className={associated ? "project-picker-association" : "project-picker-selection"}>
      {associated && <button type="button" className="project-picker-clear" aria-label={t("project.clear")} title={t("project.clear")} onClick={onClear}>×</button>}
      <button ref={projectButton} type="button" className="project-picker-button is-project new-session-project-selector" aria-label={associated ? t("project.selectNamed", { name: selectedName }) : t("project.select")} title={associated ? selectedName : t("project.select")}
        aria-haspopup="menu" aria-expanded={menu?.kind === "project"} onClick={event => open("project", event.currentTarget)}>
        <FolderIcon size={12} /><span className="project-picker-leaf">{associated ? selectedName : t("sidebar.selectProject")}</span><ChevronIcon size={9} className="sidebar-icon-down" />
      </button>
    </div>
    <SidebarMenu open={menu !== null} anchor={menu ? { kind: "rect", rect: menu.opener.getBoundingClientRect(), align: "start" } : null}
      sheet={mobile} ariaLabel={menu?.kind === "directory" ? t("project.selectDirectory") : t("project.select")} title={menu?.kind === "directory" ? t("project.selectDirectory") : t("project.select")}
      items={projectItems}
      filter={{ placeholder: menu?.kind === "directory" ? t("project.searchDirectories") : t("project.search"), emptyLabel: t("project.noMatches") }}
      onClose={() => setMenu(null)} returnFocusTo={menu?.opener ?? null} width={240} compact cancelLabel={t("sidebar.cancel")} />
  </div>;
}
