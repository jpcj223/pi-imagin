/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { createHash } = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { waitForServer } = require("./runtime.cjs");
const { prepareDevelopmentWorkspace, synchronizeDevelopmentFiles, watchApplication, ROOT_FILES } = require("./dev-workspace.cjs");

const WATCHED_FILES = new Set(["main.cjs", "preload.cjs", "runtime.cjs", "background.cjs", "startup-view.cjs", "loading.html", "startup-logo.png"]);

function developmentConfig(root, env = process.env, platform = process.platform, home = os.homedir()) {
  const appData = env.APPDATA || (platform === "darwin" ? path.join(home, "Library", "Application Support") : env.XDG_CONFIG_HOME || path.join(home, ".config"));
  const key = createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 12);
  const profile = path.resolve(env.PI_IMAGIN_DESKTOP_DEV_DIR || path.join(appData, "Pi Imagin Development", key));
  const portText = env.PI_IMAGIN_DESKTOP_DEV_PORT ?? "30143";
  if (!/^\d+$/.test(portText) || Number(portText) < 1025 || Number(portText) > 65535) throw new Error("开发端口需为 1025–65535 的整数。");
  const port = Number(portText);
  for (const name of ["PI_IMAGIN_DESKTOP_INSPECT_PORT", "PI_IMAGIN_DESKTOP_DEBUG_PORT"]) {
    if (env[name] !== undefined && (!/^\d+$/.test(env[name]) || Number(env[name]) > 65535)) throw new Error("调试端口需为 0–65535 的整数。");
  }
  const agent = path.join(profile, "agent"), workspace = path.join(profile, "workspaces"), electronProfile = path.join(profile, "electron");
  const environment = { ...env, NODE_ENV: "development", PI_IMAGIN_DESKTOP: "1", PI_IMAGIN_DESKTOP_DEV: "1", PI_CODING_AGENT_DIR: agent, PI_IMAGIN_DESKTOP_DEV_WORKSPACE: workspace, PI_WEB_PASSWORD: "", PI_WEB_NO_OPEN: "1", NEXT_TELEMETRY_DISABLED: "1", PI_IMAGIN_DESKTOP_DEV_PROFILE: electronProfile, PI_IMAGIN_DESKTOP_DEV_URL: `http://127.0.0.1:${port}` };
  // 独立开发命令不继承正式桌面的测试目录或 Electron 的 Node 运行开关。
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.PI_IMAGIN_DESKTOP_TEST_DIR;
  return { profile, agent, workspace, electronProfile, port, origin: environment.PI_IMAGIN_DESKTOP_DEV_URL, environment };
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`开发端口 ${port} 已被占用。请结束原开发命令，或设置 PI_IMAGIN_DESKTOP_DEV_PORT；不会连接或结束其他服务。`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

function exited(child) { return !child || child.exitCode !== null || child.signalCode != null; }
function waitExit(child, timeout) {
  if (exited(child)) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); child.off("exit", finish); resolve(); };
    const timer = setTimeout(finish, timeout);
    child.once("exit", finish);
  });
}

/** 只回收启动器直接持有的进程树，避免按端口或进程名误停其他工作区。 */
async function stopChild(child, graceful = false) {
  if (exited(child) || !child.pid) return;
  if (graceful && child.connected) {
    try { child.send({ type: "pi-imagin:dev-quit" }, () => {}); } catch { /* 尚未完成 IPC 初始化时采用进程树回收。 */ }
    await waitExit(child, 3000);
    if (exited(child)) return;
  }
  if (process.platform === "win32") {
    await new Promise(resolve => execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }, resolve));
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* 已退出。 */ } }
    await waitExit(child, 3000);
    if (!exited(child)) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
  }
  await waitExit(child, 3000);
  if (!exited(child)) throw new Error(`未能回收本次启动的进程 ${child.pid}。`);
}

function watchDesktopSources(directory, reload) {
  let timer;
  const watcher = fs.watch(directory, (_event, filename) => {
    if (!WATCHED_FILES.has(String(filename))) return;
    // 合并一次编辑引起的多次文件系统通知，避免连续重开窗口。
    clearTimeout(timer); timer = setTimeout(reload, 180);
  });
  return () => { clearTimeout(timer); watcher.close(); };
}

async function run({ root = path.resolve(__dirname, ".."), env = process.env } = {}) {
  const config = developmentConfig(root, env);
  // 先检查依赖与端口，失败时不创建窗口、不复用未知服务。
  const electron = require(require.resolve("electron", { paths: [path.join(root, "desktop")] }));
  const next = require.resolve("next/dist/bin/next", { paths: [root] });
  await checkPort(config.port);
  for (const directory of [config.profile, config.agent, config.workspace, config.electronProfile]) fs.mkdirSync(directory, { recursive: true });
  const stateFile = path.join(config.profile, "development-state.json");
  const workspaceDirectory = prepareDevelopmentWorkspace(root);
  let backend, desktop, closing = false, cleanup, unwatch, unwatchRoot, unwatchApplication, reload = Promise.resolve();
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const recordState = status => fs.writeFileSync(stateFile, JSON.stringify({ status, launcherPid: process.pid, backendPid: backend?.pid, desktopPid: desktop?.pid, origin: config.origin, profile: config.profile, agentDir: config.agent, workspaceParent: config.workspace }, null, 2));
  const log = text => console.log(`[桌面开发] ${text}`);
  const finish = (code = 0) => {
    if (cleanup) return cleanup;
    closing = true; unwatch?.(); unwatchRoot?.close(); unwatchApplication?.();
    cleanup = (async () => {
      try {
        await reload.catch(() => {});
        const failures = [];
        await stopChild(desktop, true).catch(error => failures.push(error.message));
        await stopChild(backend).catch(error => failures.push(error.message));
        recordState(failures.length ? "cleanup-error" : "stopped");
        if (failures.length) throw new Error(failures.join("；"));
        log("调试窗口和本次开发服务已回收。");
      } catch (error) { console.error(`[桌面开发] 回收失败：${error.message}`); code = 1; }
      finally { process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal); resolveDone(code); }
    })();
    return cleanup;
  };
  const onSignal = () => { void finish(0); };
  process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal);
  function launchDesktop() {
    const args = [path.join(root, "desktop")];
    if (env.PI_IMAGIN_DESKTOP_INSPECT_PORT) {
      if (!/^\d+$/.test(env.PI_IMAGIN_DESKTOP_INSPECT_PORT) || Number(env.PI_IMAGIN_DESKTOP_INSPECT_PORT) > 65535) throw new Error("主进程调试端口无效。");
      args.unshift(`--inspect=127.0.0.1:${env.PI_IMAGIN_DESKTOP_INSPECT_PORT}`);
    }
    if (env.PI_IMAGIN_DESKTOP_DEBUG_PORT) args.unshift("--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${Number(env.PI_IMAGIN_DESKTOP_DEBUG_PORT)}`);
    const child = spawn(electron, args, { cwd: root, env: config.environment, windowsHide: true, detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    desktop = child;
    child.once("error", error => { console.error(error.message); void finish(1); });
    child.once("exit", code => { if (!closing && desktop === child) void finish(code ?? 1); });
    recordState("running");
  }
  try {
    unwatchApplication = watchApplication(root, workspaceDirectory, error => { console.error(error.message); void finish(1); });
    log(`开发服务：${config.origin}；数据：${config.profile}`);
    log("页面自动热更新；桌面代码变化重开窗口；F12 打开开发者工具。关闭窗口或 Ctrl+C 结束本次调试。");
    backend = spawn(process.execPath, [next, "dev", "-H", "127.0.0.1", "-p", String(config.port)], { cwd: workspaceDirectory, env: config.environment, windowsHide: true, detached: true, stdio: "inherit" });
    backend.once("error", error => { backend.spawnError = error; console.error(error.message); void finish(1); });
    backend.once("exit", code => { if (!closing) { console.error(`[桌面开发] 开发服务退出（${code}）。`); void finish(1); } });
    recordState("starting");
    await waitForServer(config.origin, "", backend, 120000);
    if (!closing) {
      launchDesktop();
      unwatch = watchDesktopSources(path.join(root, "desktop"), () => {
        reload = reload.then(async () => {
          if (closing) return;
          log("桌面代码已变化，正在重开调试窗口…");
          const previous = desktop; desktop = undefined;
          await stopChild(previous, true);
          if (!closing) launchDesktop();
        }).catch(error => { console.error(error.message); queueMicrotask(() => { void finish(1); }); });
      });
      unwatchRoot = fs.watch(root, (_event, filename) => {
        if (!ROOT_FILES.has(String(filename))) return;
        try { synchronizeDevelopmentFiles(root, workspaceDirectory); }
        catch (error) { console.error(error.message); void finish(1); }
      });
    }
  } catch (error) {
    if (!closing) { console.error(`[桌面开发] ${error.message}`); await finish(1); }
  }
  return done;
}

if (require.main === module) run().then(code => { process.exitCode = code; }).catch(error => { console.error(`[桌面开发] ${error.message}\n请确认根目录及 desktop 目录的依赖已安装。`); process.exitCode = 1; });
module.exports = { developmentConfig, watchDesktopSources, stopChild, run };
