export const RAIL_ITEMS = ["home", "search", "plugins"] as const;
export type RailItem = typeof RAIL_ITEMS[number];
export const RAIL_ORDER_KEY = "pi-workspace-rail-order";
export function normalizeRailOrder(value: unknown): RailItem[] {
  const list = Array.isArray(value) ? value : [];
  return [...new Set([...list.filter((item): item is RailItem => RAIL_ITEMS.includes(item as RailItem)), ...RAIL_ITEMS])];
}
export function moveRailItem(order: readonly RailItem[], source: RailItem, target: RailItem): RailItem[] {
  const result = [...order], from = result.indexOf(source), to = result.indexOf(target);
  if (from < 0 || to < 0 || from === to) return result;
  result.splice(from, 1); result.splice(to, 0, source); return result;
}
