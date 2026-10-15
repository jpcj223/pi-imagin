export const AUXILIARY_TABS = ["outline", "files", "history", "system", "tools", "session"] as const;
export type AuxiliaryTab = typeof AUXILIARY_TABS[number];
export const AUXILIARY_TAB_ORDER_KEY = "pi-web:auxiliary-tab-order";

/** 旧偏好和不完整数据恢复为完整标签集合，不丢失新标签。 */
export function normalizeAuxiliaryTabOrder(value: unknown): AuxiliaryTab[] {
  const list = Array.isArray(value) ? value : [];
  return [...new Set([...list.filter((key): key is AuxiliaryTab => AUXILIARY_TABS.includes(key)), ...AUXILIARY_TABS])];
}

export function moveAuxiliaryTab(order: readonly AuxiliaryTab[], from: AuxiliaryTab, to: AuxiliaryTab): AuxiliaryTab[] {
  const next = normalizeAuxiliaryTabOrder(order);
  const fromIndex = next.indexOf(from), toIndex = next.indexOf(to);
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, from);
  return next;
}
