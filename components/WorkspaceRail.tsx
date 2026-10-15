"use client";

import { SettingsSectionIcon } from "./SettingsPanel";

export function WorkspaceRail({ onHome, onSettings, settingsOpen }: { onHome: () => void; onSettings: () => void; settingsOpen: boolean }) {
  return <nav className="workspace-rail" aria-label="全局导航">
    <button type="button" className={`workspace-home${settingsOpen ? "" : " is-active"}`} onClick={onHome} aria-label="主页" aria-current={settingsOpen ? undefined : "page"} title="主页">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></svg>
    </button>
    <button type="button" className={`workspace-rail-settings${settingsOpen ? " is-active" : ""}`} onClick={onSettings} aria-label="设置" aria-pressed={settingsOpen} title="设置">
      <SettingsSectionIcon section="general" size={19} strokeWidth={1.7} />
    </button>
  </nav>;
}
