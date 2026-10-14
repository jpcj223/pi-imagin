"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("node:os");

const forwardedSignals = ["SIGINT", "SIGTERM"];
const shutdownTimeoutMs = 5_000;

function getSignalExitCode(signal) {
  const signalNumber = signal ? os.constants.signals[signal] : undefined;
  return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

function wireChildProcessLifecycle(
  child,
  parentProcess = process,
  timeoutMs = shutdownTimeoutMs,
  log = console.error,
) {
  const signalHandlers = new Map();
  let shutdownTimer;
  // 转发信号后标记为主动关闭；预期退出保持安静，
  // 非预期退出需要报告。
  let shuttingDown = false;

  const forceKill = () => child.kill("SIGKILL");

  function unwire() {
    if (shutdownTimer) clearTimeout(shutdownTimer);
    for (const [forwardedSignal, handler] of signalHandlers) {
      parentProcess.removeListener(forwardedSignal, handler);
    }
    child.removeListener("error", handleError);
  }

  function handleError(error) {
    const failedToSpawn = child.pid === undefined;
    log(
      `[pi-imagin] ${failedToSpawn ? "could not run the Next.js process" : "Next.js process error"}: ${error.message}`,
    );

    if (failedToSpawn) {
      unwire();
      parentProcess.exit(1);
    }
  }

  for (const signal of forwardedSignals) {
    const handler = () => {
      if (shutdownTimer) {
        forceKill();
        return;
      }

      shuttingDown = true;
      shutdownTimer = setTimeout(forceKill, timeoutMs);
      shutdownTimer.unref();
      child.kill(signal);
    };
    signalHandlers.set(signal, handler);
    parentProcess.on(signal, handler);
  }

  child.on("error", handleError);

  child.once("exit", (code, signal) => {
    unwire();

    // 用户请求的正常关闭无需额外解释，
    // 其他退出应给出原因，避免窗口无提示消失。
    if (!shuttingDown) {
      log(
        `[pi-imagin] Next.js exited unexpectedly (${signal ? `signal ${signal}` : `code ${code}`})`,
      );
    }

    parentProcess.exit(code ?? getSignalExitCode(signal));
  });
}

module.exports = { wireChildProcessLifecycle };
