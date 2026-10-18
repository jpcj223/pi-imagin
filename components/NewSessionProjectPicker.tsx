"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import type { NewSessionContext, NewSessionTarget } from "@/lib/new-session-context";
import { newSessionProjectOptions } from "@/lib/new-session-project";
import { projectNameOf } from "@/lib/session-tree";
import { SidebarMenu, type SidebarMenuItem } from "./SidebarMenu";
import { ChevronIcon, FolderIcon, PlusIcon } from "./SidebarIcons";
import { projectExecutionFolders } from "@/lib/managed-projects-shared";

export type NewSessionProjectControl = "project" | "directory";
export interface NewSessionProjectPickerHandle { button(control: NewSessionProjectControl): HTMLButtonElement | null }

/** 项目身份和本次执行目录分开操作；添加目录只在统一项目弹窗中发生。 */
export function NewSessionProjectPicker({ context, mobile, handleRef, onPick, onClear, onAdd }: {
  context: NewSessionContext; mobile: boolean; handleRef: Ref<NewSessionProjectPickerHandle>;
  onPick: (target: NewSessionTarget, control: NewSessionProjectControl) => void;
  onClear: () => void; onAdd: (opener: HTMLElement) => void;
}) {
  const projectButton = useRef<HTMLButtonElement>(null), directoryButton = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ kind: NewSessionProjectControl; opener: HTMLElement } | null>(null);
  useImperativeHandle(handleRef, () => ({ button: control => control === "project" ? projectButton.current : directoryButton.current }), []);
  const managed = context.managedProjects?.find(project => project.id === context.managedProjectId);
  const associated = !context.defaultWorkspace;
  const selectedKey = managed ? `managed:${managed.id}` : context.project.key;
  const selectedName = managed?.name ?? context.project.alias ?? projectNameOf(context.project.root);
  const options = newSessionProjectOptions(context);
  const executionFolders = managed ? projectExecutionFolders(managed) : [];
  const currentFolder = executionFolders.find(folder => folder.path === context.cwd);
  const showDirectory = managed && (executionFolders.length > 1 || !currentFolder);
  const directoryName = currentFolder?.name ?? projectNameOf(context.cwd);
  const pick = (target: NewSessionTarget, control: NewSessionProjectControl) => { setMenu(null); onPick(target, control); };
  const projectItems: SidebarMenuItem[] = options.map(option => ({
    type: "item", id: option.key, label: option.name, note: option.note,
    checked: associated && option.key === selectedKey,
    title: option.target.cwd,
    onSelect: () => {
      // 重选当前项目不把已选的后端目录或工作树重置为默认目录。
      if (!associated || option.key !== selectedKey) pick(option.target, "project");
    },
  }));
  if (projectItems.length) projectItems.push({ type: "separator", id: "actions" });
  projectItems.push({ type: "item", id: "add-project", label: "添加项目", icon: <PlusIcon size={13} />,
    onSelect: () => { if (menu) onAdd(menu.opener); } });
  const directoryItems: SidebarMenuItem[] = executionFolders.map(folder => ({
    type: "item", id: folder.id, label: folder.name, note: folder.id === managed?.defaultFolderId ? "默认" : undefined,
    checked: folder.path === context.cwd, title: folder.path,
    onSelect: () => { if (managed && folder.path !== context.cwd) pick({ cwd: folder.path, managedProjectId: managed.id }, "directory"); },
  }));
  if (managed && !currentFolder) directoryItems.unshift({ type: "item", id: "current-directory", label: directoryName, note: "当前目录", checked: true, title: context.cwd, onSelect: () => {} });
  const open = (kind: NewSessionProjectControl, opener: HTMLButtonElement) => setMenu(previous => previous?.kind === kind ? null : { kind, opener });
  return <div className="new-session-project-picker">
    <div className={associated ? "project-picker-association" : "project-picker-selection"}>
      {associated && <button type="button" className="project-picker-clear" aria-label="取消项目关联" title="取消项目关联" onClick={onClear}>×</button>}
      <button ref={projectButton} type="button" className="project-picker-button is-project new-session-project-selector" aria-label={associated ? `选择项目：${selectedName}` : "选择项目"} title={associated ? selectedName : "选择项目"}
        aria-haspopup="menu" aria-expanded={menu?.kind === "project"} onClick={event => open("project", event.currentTarget)}>
        <FolderIcon size={12} /><span className="project-picker-leaf">{associated ? selectedName : "选择项目…"}</span><ChevronIcon size={9} className="sidebar-icon-down" />
      </button>
    </div>
    {showDirectory && <button ref={directoryButton} type="button" className="project-picker-button new-session-directory-selector" aria-label={`执行目录：${directoryName}`} title={context.cwd}
      aria-haspopup="menu" aria-expanded={menu?.kind === "directory"} onClick={event => open("directory", event.currentTarget)}>
      <span className="new-session-directory-label">执行目录</span><span className="project-picker-leaf">{directoryName}</span><ChevronIcon size={9} className="sidebar-icon-down" />
    </button>}
    <SidebarMenu open={menu !== null} anchor={menu ? { kind: "rect", rect: menu.opener.getBoundingClientRect(), align: "start" } : null}
      sheet={mobile} ariaLabel={menu?.kind === "directory" ? "选择执行目录" : "选择项目"} title={menu?.kind === "directory" ? "选择执行目录" : "选择项目"}
      items={menu?.kind === "directory" ? directoryItems : projectItems}
      filter={{ placeholder: menu?.kind === "directory" ? "搜索执行目录" : "搜索项目", emptyLabel: "没有匹配项" }}
      onClose={() => setMenu(null)} returnFocusTo={menu?.opener ?? null} width={240} compact cancelLabel="取消" />
  </div>;
}
