/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray, WebContentsView } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { choosePort, isExternalUrl, isOwnedUrl, pathsFor, stopServer, waitForServer, requestLocal, loadWorkspacePage } = require("./runtime.cjs");
const { installBackground } = require("./background.cjs");
const { createStartupView } = require("./startup-view.cjs");
const { installWorkspaceNavigation, pruneStartupHistory } = require("./workspace-navigation.cjs");
const { titlebarOptions } = require("./titlebar.cjs");

const launchStarted = Date.now();

const development = !app.isPackaged && Boolean(process.env.PI_IMAGIN_DESKTOP_DEV_URL);
app.setName(development ? "Pi Imagin Dev" : "Pi Imagin");
// 开发窗口不能沿用 Electron 的任务栏身份，否则 Windows 会复用其旧快捷方式图标。
const desktopAppId = development ? "local.pi-imagin.desktop.dev" : "local.pi-imagin.desktop";
if (process.platform === "win32") app.setAppUserModelId(desktopAppId);

function configureTaskbar(window, icon) {
  if (process.platform !== "win32") return;
  window.setAppDetails({
    appId: desktopAppId,
    ...(fs.existsSync(icon) ? { appIconPath: icon, appIconIndex: 0 } : {}),
    ...(app.isPackaged ? { relaunchCommand: `"${process.execPath}"`, relaunchDisplayName: "Pi Imagin" } : {}),
  });
}
// 开发窗口拥有独立浏览器数据与单实例锁，不复用正式桌面配置。
const profile = development ? path.resolve(process.env.PI_IMAGIN_DESKTOP_DEV_PROFILE || path.join(app.getPath("appData"), "Pi Imagin Development", "attach"))
  : process.env.PI_IMAGIN_DESKTOP_TEST_DIR ? path.resolve(process.env.PI_IMAGIN_DESKTOP_TEST_DIR) : path.join(app.getPath("appData"), "Pi Imagin");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
const ownsInstance = app.requestSingleInstanceLock();
let mainWindow;
let backend;
let origin = "";
let authorization = "";
let backendPassword = "";
let starting = false;
let quitting = false;
let background;
let startupView;
let logs;
if (development) process.on("message", message => { if (message?.type === "pi-imagin:dev-quit") app.quit(); });
const startupRequests = new Map();
const startupPage = new URL(`file://${path.join(__dirname, "loading.html").replace(/\\/g, "/")}`).href;

function record(message) {
  if (logs) fs.appendFileSync(logs, `${new Date().toISOString()} ${message}\n`);
}

function startupStep(message, since) { record(`${message} elapsed=${Date.now() - since}ms`); }

function trustedSender(event) {
  const url = event.senderFrame?.url ?? "";
  return event.sender === mainWindow?.webContents && (url === startupPage || isOwnedUrl(url, origin));
}

function status(message, error) {
  startupView?.status({ message, error });
  mainWindow?.webContents.send("pi-imagin:startup-status", { message, error });
}

async function startWorkspace() {
  if (starting || quitting) return;
  starting = true;
  const started = Date.now();
  try {
    await stopServer(backend);
    if (quitting) return;
    backend = undefined;
    await startupView.show();
    await mainWindow.loadFile(path.join(__dirname, "loading.html"));
    if (quitting) return;
    status("正在启动本地工作区…");
    const devUrl = !app.isPackaged ? process.env.PI_IMAGIN_DESKTOP_DEV_URL : undefined;
    if (devUrl) {
      const url = new URL(devUrl);
      if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("开发服务必须使用本机回环地址。");
      origin = url.origin;
      authorization = "";
      backendPassword = "";
    } else {
      const runtime = pathsFor(app, process.resourcesPath);
      if (!fs.existsSync(runtime.node) || !fs.existsSync(path.join(runtime.server, "server.js"))) throw new Error("运行文件不完整，请重新安装 Pi Imagin。");
      const port = await choosePort(app.getPath("userData"));
      if (quitting) return;
      origin = `http://127.0.0.1:${port}`;
      const password = process.env.PI_IMAGIN_DESKTOP_SMOKE === "1" && process.env.PI_IMAGIN_DESKTOP_TEST_PASSWORD || randomBytes(32).toString("hex");
      backendPassword = password;
      authorization = `Basic ${Buffer.from(`pi:${password}`).toString("base64")}`;
      const nodeDir = path.dirname(runtime.node);
      backend = spawn(runtime.node, [runtime.launcher, path.join(runtime.server, "server.js")], {
        cwd: runtime.server,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1", PI_WEB_HOSTNAME: "127.0.0.1", PI_WEB_PASSWORD: password, PI_WEB_NO_OPEN: "1", PI_IMAGIN_DESKTOP: "1", NODE_COMPILE_CACHE: path.join(profile, "node-compile-cache"), PATH: `${nodeDir};${process.env.PATH || ""}` },
      });
      record(`本地服务启动 pid=${backend.pid} origin=${origin}`);
      for (const stream of [backend.stdout, backend.stderr]) stream.on("data", chunk => {
        // 密码只在内存中使用，不写入日志。
        record(String(chunk).replaceAll(password, "[已隐藏]").trim());
      });
      backend.on("error", error => { backend.spawnError = error; record(`服务错误：${error.message}`); });
      backend.on("exit", code => {
        record(`本地服务退出 code=${code}`);
        if (!quitting && !starting) {
          void mainWindow.loadFile(path.join(__dirname, "loading.html")).then(() => status("工作区连接已中断", "本地服务意外退出，可以重新启动。"));
        }
      });
    }
    await waitForServer(origin, authorization, backend);
    if (quitting) return;
    startupStep("本地服务连接就绪", started);
    status("正在打开工作区…");
    if (backendPassword) {
      // 页面与 API 沿用同一认证机制，先为本窗口建立会话 Cookie。
      const login = await requestLocal(origin, "/api/web-auth", { json: { password: backendPassword } });
      if (login.status !== 200) throw new Error("无法建立本地工作区连接，请重新启动。");
      if (quitting) return;
      const cookie = (login.headers["set-cookie"] ?? []).find(value => value.startsWith("pi_web_session="));
      const value = cookie?.split(";")[0].slice("pi_web_session=".length);
      if (!value) throw new Error("本地工作区连接信息不完整，请重新启动。");
      await mainWindow.webContents.session.cookies.set({ url: origin, name: "pi_web_session", value, path: "/", httpOnly: true, sameSite: "lax" });
      startupStep("本地工作区认证完成", started);
    }
    if (quitting) return;
    await loadWorkspacePage(mainWindow, origin, 90000, true);
    if (quitting) return;
    if (new URL(mainWindow.webContents.getURL()).pathname === "/login") throw new Error("工作区连接没有完成，请重新启动。");
    startupStep("独立工作区界面就绪", started);
    pruneStartupHistory(mainWindow.webContents, origin);
    startupView.finish();
    if (backend?.connected) backend.send({ type: "pi-imagin:workspace-loaded" }, () => {});
    if (process.env.PI_IMAGIN_DESKTOP_SMOKE === "1") {
      fs.writeFileSync(path.join(app.getPath("userData"), "smoke-ready.json"), JSON.stringify({ pid: process.pid, backendPid: backend?.pid, origin, packaged: app.isPackaged, loadedUrl: mainWindow.webContents.getURL() }));
    }
  } catch (error) {
    if (quitting || mainWindow?.isDestroyed()) return;
    record(`启动失败：${error.message}`);
    await mainWindow.loadFile(path.join(__dirname, "loading.html")).catch(() => {});
    status("工作区暂时无法启动", error.message);
  } finally { starting = false; startupRequests.clear(); }
}

if (!ownsInstance) app.quit();
else {
  app.on("second-instance", () => background?.restore());
  app.on("activate", () => background?.restore());
  app.whenReady().then(() => {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    logs = path.join(app.getPath("userData"), "desktop.log");
    try { if (fs.statSync(logs).size > 2 * 1024 * 1024) fs.renameSync(logs, `${logs}.previous`); } catch { /* 首次启动没有日志。 */ }
    startupStep("桌面进程就绪", launchStarted);
    const icon = pathsFor(app, process.resourcesPath).icon;
    mainWindow = new BrowserWindow({
      width: 1440, height: 900, minWidth: 900, minHeight: 600,
      title: development ? "Pi Imagin · 开发" : "Pi Imagin", icon: fs.existsSync(icon) ? icon : undefined,
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#f7f8f9", symbolColor: "#77818c", height: 36 },
      autoHideMenuBar: true,
      backgroundColor: "#f6f8fa", show: false,
      webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
    });
    configureTaskbar(mainWindow, icon);
    background = installBackground({ app, Tray, Menu, window: mainWindow, icon, isQuitting: () => quitting, record, enabled: !development });
    installWorkspaceNavigation(mainWindow, () => origin, () => starting || quitting);
    startupView = createStartupView({ WebContentsView, window: mainWindow, isQuitting: () => quitting, canShow: () => !background.isHidden() && process.env.PI_IMAGIN_DESKTOP_SMOKE !== "1", record });
    mainWindow.once("ready-to-show", () => {
      startupStep("启动窗口可显示", launchStarted);
      if (!quitting && !background.isHidden() && process.env.PI_IMAGIN_DESKTOP_SMOKE !== "1") mainWindow.show();
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "文件", submenu: [{ label: "退出", role: "quit" }] },
      { label: "编辑", submenu: [{ label: "撤销", role: "undo" }, { label: "重做", role: "redo" }, { type: "separator" }, { label: "剪切", role: "cut" }, { label: "复制", role: "copy" }, { label: "粘贴", role: "paste" }, { label: "全选", role: "selectAll" }] },
      { label: "视图", submenu: [{ label: "刷新", role: "reload" }, ...(development ? [{ label: "开发者工具", role: "toggleDevTools", accelerator: "F12" }] : []), { label: "放大", role: "zoomIn" }, { label: "缩小", role: "zoomOut" }, { label: "实际大小", role: "resetZoom" }, { label: "全屏", role: "togglefullscreen" }] },
    ]));
    const browserSession = mainWindow.webContents.session;
    browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (authorization && isOwnedUrl(details.url, origin)) details.requestHeaders.Authorization = authorization;
      if (starting && isOwnedUrl(details.url, origin)) {
        const pathname = new URL(details.url).pathname;
        // 只记录初始恢复相关接口，不记录查询值、会话 ID、文件路径或认证头。
        const phase = pathname === "/" ? "page" : pathname === "/api/sessions" ? "catalogue" : pathname === "/api/sessions/ui-state" ? "preferences" : pathname === "/api/cwd/validate" ? "workspace" : /^\/api\/sessions\/[^/]+$/.test(pathname) ? "conversation" : null;
        if (phase) startupRequests.set(details.id, { phase, started: Date.now() });
      }
      callback({ requestHeaders: details.requestHeaders });
    });
    const recordRequest = details => {
      const request = startupRequests.get(details.id);
      if (!request) return;
      startupRequests.delete(details.id);
      record(`[startup] ${request.phase} status=${details.statusCode ?? "failed"} elapsed=${Date.now() - request.started}ms`);
    };
    browserSession.webRequest.onCompleted(recordRequest);
    browserSession.webRequest.onErrorOccurred(recordRequest);
    browserSession.setPermissionRequestHandler((webContents, permission, callback) => callback(webContents === mainWindow.webContents && isOwnedUrl(webContents.getURL(), origin) && ["notifications", "clipboard-sanitized-write"].includes(permission)));
    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (isOwnedUrl(url, origin)) return;
      event.preventDefault();
      if (isExternalUrl(url)) void shell.openExternal(url);
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      // 完整历史在应用窗口内打开，模型文档与其他外部链接由默认应用处理。
      if (isOwnedUrl(url, origin)) {
        const history = new BrowserWindow({ parent: mainWindow, width: 1200, height: 800, title: "完整历史 · Pi Imagin", icon: fs.existsSync(icon) ? icon : undefined, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
        configureTaskbar(history, icon);
        history.webContents.setWindowOpenHandler(({ url: link }) => { if (isExternalUrl(link) && !isOwnedUrl(link, origin)) void shell.openExternal(link); return { action: "deny" }; });
        history.webContents.on("will-navigate", (event, link) => { if (!isOwnedUrl(link, origin)) { event.preventDefault(); if (isExternalUrl(link)) void shell.openExternal(link); } });
        void history.loadURL(url);
      } else if (isExternalUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    ipcMain.on("pi-imagin:titlebar", (event, value) => {
      if (!trustedSender(event) || event.senderFrame !== mainWindow.webContents.mainFrame || !["win32", "linux"].includes(process.platform)) return;
      const options = titlebarOptions(value, mainWindow.webContents.getZoomFactor());
      if (options) mainWindow.setTitleBarOverlay(options);
    });
    ipcMain.handle("pi-imagin:choose-directory", async event => {
      if (!trustedSender(event)) throw new Error("请求来源无效");
      const choice = await dialog.showOpenDialog(mainWindow, { title: "选择项目文件夹", properties: ["openDirectory", "createDirectory"] });
      return choice.canceled ? null : choice.filePaths[0] ?? null;
    });
    ipcMain.handle("pi-imagin:choose-executable", async event => {
      if (!trustedSender(event) || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error("请求来源无效");
      const choice = await dialog.showOpenDialog(mainWindow, { title: "选择终端程序 / Select shell executable", properties: ["openFile"], ...(process.platform === "win32" ? { filters: [{ name: "Executable", extensions: ["exe"] }] } : {}) });
      return choice.canceled ? null : choice.filePaths[0] ?? null;
    });
    ipcMain.handle("pi-imagin:retry-startup", event => {
      if ((!trustedSender(event) && !startupView.isSender(event)) || event.senderFrame.url !== startupPage) throw new Error("请求来源无效");
      void startWorkspace();
    });
    ipcMain.on("pi-imagin:workspace-progress", (event, phase) => {
      if (!starting || !trustedSender(event) || !isOwnedUrl(event.senderFrame.url, origin)) return;
      const messages = { navigation: "正在恢复工作区…", workspace: "正在检查工作目录…", conversation: "正在恢复会话…", ready: "工作区已就绪" };
      if (typeof phase !== "string" || !Object.hasOwn(messages, phase)) return;
      startupStep(`[startup] ${phase}`, launchStarted);
      status(messages[phase]);
    });
    // 应用内只呈现回环工作区与其历史页，避免代理自动发现拖住本地页面。
    // 模型、MCP 等服务端连接仍沿用用户原有代理设置。
    void browserSession.setProxy({ mode: "direct" }).then(() => startWorkspace()).catch(error => { record(`本地连接设置失败：${error.message}`); void startWorkspace(); });
    if (process.env.PI_IMAGIN_DESKTOP_SMOKE === "1") {
      setInterval(() => {
        if (fs.existsSync(path.join(app.getPath("userData"), "smoke-quit"))) app.quit();
      }, 500).unref();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    background?.dispose();
    startupView?.dispose();
    void stopServer(backend).finally(() => { record("退出回收完成"); app.exit(0); });
  });
}
