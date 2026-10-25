import { configureHttpDispatcher, readHttpIdleTimeoutMs } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";
import { scheduleSdkPreload } from "@/lib/sdk-preload";
import { loadSdk } from "@/lib/sdk-loader";

export function registerNodeInstrumentation(): void {
  // pi CLI 将设置中的 httpIdleTimeoutMs 应用到同一套 undici 超时，
  // 网页会话也使用用户配置的响应体和响应头超时。
  // 否则默认五分钟超时会中止长时间没有输出的模型流，
  // 即使相同请求在 CLI 中仍可正常等待。
  configureHttpDispatcher(readHttpIdleTimeoutMs());

  // 生产模式下 Next 16 收到 SIGINT/SIGTERM 后关闭服务器，
  // 会无限等待现有连接结束；SSE 通常要客户端离开才结束，
  // 因此需要在此主动关闭事件流，保证服务进程能够退出。
  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);

  if (process.env.PI_IMAGIN_DESKTOP === "1" && process.send) {
    process.on("message", async message => {
      if ((message as { type?: string })?.type !== "pi-imagin:prepare-shutdown") return;
      shutdownStreams();
      try {
        const [{ shutdownAllRpcSessions }, { shutdownAllTerminals }] = await Promise.all([
          import("@/lib/rpc-manager"), import("@/lib/terminal-manager"),
        ]);
        shutdownAllTerminals();
        await shutdownAllRpcSessions();
      } finally {
        process.send?.({ type: "pi-imagin:shutdown-ready" });
      }
    });
  }

  // 桌面先完成轻量认证和首屏，SDK 不再与这些请求争抢冷启动资源。
  // 会话接口仍按需导入同一 SDK，不创建会话，也不改变其行为。
  scheduleSdkPreload(process.env.PI_IMAGIN_DESKTOP === "1", process, loadSdk);
  if (process.env.PI_IMAGIN_DESKTOP === "1") {
    void import("@/lib/pi-command").then(module => module.initializeExternalPiCommand()).catch(error => {
      console.warn("[pi-command] External command registration failed:", error instanceof Error ? error.message : String(error));
    });
  }
}
