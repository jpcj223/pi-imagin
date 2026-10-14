/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { choosePort, isExternalUrl, isOwnedUrl, pathsFor, stopServer, waitForServer } = require("./runtime.cjs");

app.setName("Pi Imagin");
const profile = process.env.PI_IMAGIN_DESKTOP_TEST_DIR ? path.resolve(process.env.PI_IMAGIN_DESKTOP_TEST_DIR) : path.join(app.getPath("appData"), "Pi Imagin");
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
let logs;
const startupPage = new URL(`file://${path.join(__dirname, "loading.html").replace(/\\/g, "/")}`).href;

function record(message) {
  if (logs) fs.appendFileSync(logs, `${new Date().toISOString()} ${message}\n`);
}

function trustedSender(event) {
  const url = event.senderFrame?.url ?? "";
  return event.sender === mainWindow?.webContents && (url === startupPage || isOwnedUrl(url, origin));
}

function status(message, error) {
  mainWindow?.webContents.send("pi-imagin:startup-status", { message, error });
}

async function startWorkspace() {
  if (starting || quitting) return;
  starting = true;
  try {
    await stopServer(backend);
    if (quitting) return;
    backend = undefined;
    await mainWindow.loadFile(path.join(__dirname, "loading.html"));
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
      origin = `http://127.0.0.1:${port}`;
      const password = process.env.PI_IMAGIN_DESKTOP_SMOKE === "1" && process.env.PI_IMAGIN_DESKTOP_TEST_PASSWORD || randomBytes(32).toString("hex");
      backendPassword = password;
      authorization = `Basic ${Buffer.from(`pi:${password}`).toString("base64")}`;
      const nodeDir = path.dirname(runtime.node);
      backend = spawn(runtime.node, [runtime.launcher, path.join(runtime.server, "server.js")], {
        cwd: runtime.server,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1", PI_WEB_HOSTNAME: "127.0.0.1", PI_WEB_PASSWORD: password, PI_WEB_NO_OPEN: "1", PI_IMAGIN_DESKTOP: "1", PATH: `${nodeDir};${process.env.PATH || ""}` },
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
    if (backendPassword) {
      // 页面与 API 沿用同一认证机制，先为本窗口建立会话 Cookie。
      const login = await fetch(`${origin}/api/web-auth`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ password: backendPassword }) });
      if (!login.ok) throw new Error("无法建立本地工作区连接，请重新启动。");
      const cookie = login.headers.getSetCookie().find(value => value.startsWith("pi_web_session="));
      const value = cookie?.split(";")[0].slice("pi_web_session=".length);
      if (!value) throw new Error("本地工作区连接信息不完整，请重新启动。");
      await mainWindow.webContents.session.cookies.set({ url: origin, name: "pi_web_session", value, path: "/", httpOnly: true, sameSite: "lax" });
    }
    await mainWindow.loadURL(origin);
    if (new URL(mainWindow.webContents.getURL()).pathname === "/login") throw new Error("工作区连接没有完成，请重新启动。");
    record("独立工作区窗口加载完成");
    if (process.env.PI_IMAGIN_DESKTOP_SMOKE === "1") {
      fs.writeFileSync(path.join(app.getPath("userData"), "smoke-ready.json"), JSON.stringify({ pid: process.pid, backendPid: backend?.pid, origin, packaged: app.isPackaged, loadedUrl: mainWindow.webContents.getURL() }));
    }
  } catch (error) {
    record(`启动失败：${error.message}`);
    status("工作区暂时无法启动", error.message);
  } finally { starting = false; }
}

if (!ownsInstance) app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show(); mainWindow?.focus();
  });
  app.whenReady().then(() => {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    logs = path.join(app.getPath("userData"), "desktop.log");
    try { if (fs.statSync(logs).size > 2 * 1024 * 1024) fs.renameSync(logs, `${logs}.previous`); } catch { /* 首次启动没有日志。 */ }
    const icon = pathsFor(app, process.resourcesPath).icon;
    mainWindow = new BrowserWindow({
      width: 1440, height: 900, minWidth: 900, minHeight: 600,
      title: "Pi Imagin", icon: fs.existsSync(icon) ? icon : undefined,
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#f7f8f9", symbolColor: "#77818c", height: 43 },
      autoHideMenuBar: true,
      backgroundColor: "#f6f8fa", show: false,
      webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    mainWindow.once("ready-to-show", () => { if (process.env.PI_IMAGIN_DESKTOP_SMOKE !== "1") mainWindow.show(); });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "文件", submenu: [{ label: "退出", role: "quit" }] },
      { label: "编辑", submenu: [{ label: "撤销", role: "undo" }, { label: "重做", role: "redo" }, { type: "separator" }, { label: "剪切", role: "cut" }, { label: "复制", role: "copy" }, { label: "粘贴", role: "paste" }, { label: "全选", role: "selectAll" }] },
      { label: "视图", submenu: [{ label: "刷新", role: "reload" }, { label: "放大", role: "zoomIn" }, { label: "缩小", role: "zoomOut" }, { label: "实际大小", role: "resetZoom" }, { label: "全屏", role: "togglefullscreen" }] },
    ]));
    const browserSession = mainWindow.webContents.session;
    browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (authorization && isOwnedUrl(details.url, origin)) details.requestHeaders.Authorization = authorization;
      callback({ requestHeaders: details.requestHeaders });
    });
    browserSession.setPermissionRequestHandler((webContents, permission, callback) => callback(webContents === mainWindow.webContents && isOwnedUrl(webContents.getURL(), origin) && ["notifications", "clipboard-sanitized-write"].includes(permission)));
    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (isOwnedUrl(url, origin)) return;
      event.preventDefault();
      if (isExternalUrl(url)) void shell.openExternal(url);
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      // 完整历史在应用窗口内打开，模型文档与其他外部链接由默认应用处理。
      if (isOwnedUrl(url, origin)) {
        const history = new BrowserWindow({ parent: mainWindow, width: 1200, height: 800, title: "完整历史 · Pi Imagin", webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
        history.webContents.setWindowOpenHandler(({ url: link }) => { if (isExternalUrl(link) && !isOwnedUrl(link, origin)) void shell.openExternal(link); return { action: "deny" }; });
        history.webContents.on("will-navigate", (event, link) => { if (!isOwnedUrl(link, origin)) { event.preventDefault(); if (isExternalUrl(link)) void shell.openExternal(link); } });
        void history.loadURL(url);
      } else if (isExternalUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    ipcMain.handle("pi-imagin:choose-directory", async event => {
      if (!trustedSender(event)) throw new Error("请求来源无效");
      const choice = await dialog.showOpenDialog(mainWindow, { title: "选择项目文件夹", properties: ["openDirectory", "createDirectory"] });
      return choice.canceled ? null : choice.filePaths[0] ?? null;
    });
    ipcMain.handle("pi-imagin:retry-startup", event => {
      if (!trustedSender(event) || event.senderFrame.url !== startupPage) throw new Error("请求来源无效");
      void startWorkspace();
    });
    void startWorkspace();
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
    void stopServer(backend).finally(() => { record("退出回收完成"); app.exit(0); });
  });
}
