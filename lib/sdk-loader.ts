type Sdk = typeof import("@earendil-works/pi-coding-agent");
declare global {
  var __piImaginSdkLoad: Promise<Sdk> | undefined;
}

/** 正文读取与预热共用一次加载；只记录耗时，不记录目录、消息或凭据。 */
export function loadSdk(): Promise<Sdk> {
  if (globalThis.__piImaginSdkLoad) return globalThis.__piImaginSdkLoad;
  const started = performance.now();
  const desktop = process.env.PI_IMAGIN_DESKTOP === "1";
  if (desktop) console.info("[startup] SDK loading");
  globalThis.__piImaginSdkLoad = import("@earendil-works/pi-coding-agent").then(sdk => {
    if (desktop) console.info(`[startup] SDK ready elapsed=${Math.round(performance.now() - started)}ms`);
    return sdk;
  }).catch(error => {
    globalThis.__piImaginSdkLoad = undefined;
    if (desktop) console.info(`[startup] SDK failed elapsed=${Math.round(performance.now() - started)}ms`);
    throw error;
  });
  return globalThis.__piImaginSdkLoad;
}
