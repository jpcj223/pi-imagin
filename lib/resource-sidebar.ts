export const RESOURCE_GROUPS = ["global", "external", "project"] as const;
export type ResourceGroup = typeof RESOURCE_GROUPS[number];
export interface ResourceSidebarPreference { order: ResourceGroup[]; collapsed: Record<ResourceGroup, boolean> }
export function resourceGroup(scope: string, origin?: string): ResourceGroup {
  return scope === "project" ? "project" : origin === "app" ? "global" : "external";
}
export function resourceSidebarPreference(value?: unknown): ResourceSidebarPreference {
  const data = value && typeof value === "object" ? value as Partial<ResourceSidebarPreference> : {};
  const order = Array.isArray(data.order) ? [...new Set(data.order.filter(id => RESOURCE_GROUPS.includes(id)))] : [];
  return { order: [...order, ...RESOURCE_GROUPS.filter(id => !order.includes(id))], collapsed: {
    global: data.collapsed?.global === true, external: data.collapsed?.external !== false, project: data.collapsed?.project !== false,
  } };
}
export function moveResourceGroup(order: ResourceGroup[], from: ResourceGroup, to: ResourceGroup, after = false): ResourceGroup[] {
  if (from === to) return order;
  const next = order.filter(id => id !== from);
  next.splice(next.indexOf(to) + (after ? 1 : 0), 0, from);
  return next;
}
