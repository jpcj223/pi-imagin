import { CONFIGURED_TOOL_PRESET, isToolPreset, type ToolPreset } from "./tool-presets";

const STORAGE_KEY = "pi-tool-preset";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 只有用户明确选择工具预设时才保存偏好；缺失表示从未选择，采用 configured。
 * 不能把应用的默认编程工具悄悄固定到会话，覆盖全局 defaultTools。
 */
export function getPreferredToolPreset(
  storage: StorageLike | null = getBrowserStorage(),
): ToolPreset {
  if (!storage) return CONFIGURED_TOOL_PRESET;
  try {
    const value = storage.getItem(STORAGE_KEY);
    return isToolPreset(value) ? value : CONFIGURED_TOOL_PRESET;
  } catch {
    return CONFIGURED_TOOL_PRESET;
  }
}

export function setPreferredToolPreset(
  preset: ToolPreset,
  storage: StorageLike | null = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, preset);
  } catch {
    // Browser storage is best-effort.
  }
}
