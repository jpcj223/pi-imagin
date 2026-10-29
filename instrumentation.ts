export async function register(): Promise<void> {
  // Next 会为 Node 和 Edge 两种运行时构建此入口。
  // Edge 不支持 Node API，因此信号处理和 undici 放在
  // 独立的 instrumentation-node 模块中，
  // 仅由编译期可移除的 NEXT_RUNTIME 分支加载；
  // 不能用提前 return 替代此条件，否则 Edge 模块仍可能包含 Node 调用。
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const started = performance.now();
    const desktop = process.env.PI_IMAGIN_DESKTOP === "1";
    if (desktop) console.info("[startup] instrumentation loading");
    const { registerNodeInstrumentation } = await import("./instrumentation-node");
    registerNodeInstrumentation();
    if (desktop) console.info(`[startup] instrumentation ready elapsed=${Math.round(performance.now() - started)}ms`);
  }
}
