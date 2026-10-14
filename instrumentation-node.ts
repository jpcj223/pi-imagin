import { configureHttpDispatcher, readHttpIdleTimeoutMs } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";

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

  // Next 在路由首次请求时才加载其模块，
  // 首次会话列表请求曾需要额外导入整个 pi SDK，
  // 尤其在 Windows 上耗时明显；现在提前异步导入，保持注册快速。
  // 导入与打开浏览器并行，后续路由复用 Node 模块缓存。
  // 预加载失败交由路由实际导入时报告。
  import("@earendil-works/pi-coding-agent").catch(() => {});
}
