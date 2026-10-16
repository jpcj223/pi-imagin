import type { EventEmitter } from "node:events";

/** 桌面首屏就绪后再预热 SDK；网页保持原时机，启动失败留给实际接口报告。 */
export function scheduleSdkPreload(desktop: boolean, events: Pick<EventEmitter, "on" | "off">, load: () => Promise<unknown>): void {
  const start = () => { void Promise.resolve().then(load).catch(() => {}); };
  if (!desktop) { start(); return; }
  const cleanup = () => { events.off("message", message); events.off("disconnect", cleanup); };
  const message = (value: unknown) => {
    const type = (value as { type?: string } | null)?.type;
    if (type === "pi-imagin:prepare-shutdown") cleanup();
    if (type !== "pi-imagin:workspace-loaded") return;
    cleanup();
    start();
  };
  events.on("message", message);
  events.on("disconnect", cleanup);
}
