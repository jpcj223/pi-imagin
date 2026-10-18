export const SIDEBAR_SECTIONS_KEY = "pi-imagin:sidebar-sections:v1";
export const SECTION_HANDLE_HEIGHT = 8;
export const DEFAULT_SECTION_SHARE = 0.24;

export interface SidebarSectionPreferences {
  defaultShare: number;
  archiveShare: number;
  archiveOpen: boolean;
}

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
const defaults = (): SidebarSectionPreferences => ({ defaultShare: DEFAULT_SECTION_SHARE, archiveShare: DEFAULT_SECTION_SHARE, archiveOpen: false });
function storage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function loadSidebarSections(store: StorageLike | null = storage()): SidebarSectionPreferences {
  try {
    const value = JSON.parse(store?.getItem(SIDEBAR_SECTIONS_KEY) ?? "null");
    const share = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate)
      && candidate >= 0 && candidate <= 1 ? candidate : DEFAULT_SECTION_SHARE;
    return { defaultShare: share(value?.defaultShare), archiveShare: share(value?.archiveShare), archiveOpen: value?.archiveOpen === true };
  } catch { return defaults(); }
}

/** 只保存用户操作；窗口收缩、空区隐藏不会覆盖偏好。 */
export function saveSidebarSections(patch: Partial<SidebarSectionPreferences>, store: StorageLike | null = storage()): void {
  try { store?.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify({ version: 1, ...loadSidebarSections(store), ...patch })); } catch { /* 存储不可用时仍可调整布局。 */ }
}

export function sidebarSectionLayout(height: number, hasDefault: boolean, hasArchive: boolean, archiveOpen: boolean, prefs: SidebarSectionPreferences) {
  const handles = (Number(hasDefault) + Number(hasArchive)) * SECTION_HANDLE_HEIGHT;
  const available = Math.max(0, height - handles);
  const folded = hasArchive && !archiveOpen ? Math.min(36, available) : 0;
  const wantedMinimum = 80 + (hasDefault ? 84 : 0) + (hasArchive && archiveOpen ? 96 : 0);
  // 极矮窗口按比例收缩最低高度，避免固定 min-height 撑出侧栏。
  const scale = Math.min(1, Math.max(0, available - folded) / wantedMinimum);
  const projectMin = 80 * scale, defaultMin = hasDefault ? 84 * scale : 0;
  const archiveMin = hasArchive ? archiveOpen ? 96 * scale : folded : 0;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const archive = hasArchive ? archiveOpen
    ? clamp(prefs.archiveShare * available, archiveMin, available - projectMin - defaultMin)
    : archiveMin : 0;
  const normal = hasDefault ? clamp(prefs.defaultShare * available, defaultMin, available - projectMin - archive) : 0;
  return { available, project: Math.max(0, available - normal - archive), default: normal, archive,
    defaultMin, archiveMin, defaultMax: Math.max(defaultMin, available - projectMin - archive),
    archiveMax: Math.max(archiveMin, available - projectMin - normal) };
}
