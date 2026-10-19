/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { execFile } = require("node:child_process");

function isOwnedUrl(url, origin) {
  try { return new URL(url).origin === origin; } catch { return false; }
}

function isExternalUrl(url) {
  try { return ["https:", "http:", "mailto:"].includes(new URL(url).protocol); } catch { return false; }
}

function pathsFor(app, resourcesPath) {
  const base = app.isPackaged ? resourcesPath : path.resolve(__dirname, "../build");
  return {
    server: path.join(base, app.isPackaged ? "server" : "desktop-server"),
    node: path.join(base, app.isPackaged ? "node" : "desktop-node", "node.exe"),
    icon: app.isPackaged ? path.join(base, "icons", "icon.ico") : path.resolve(__dirname, "../public/icons/icon-cosmic-ocean.ico"),
    launcher: app.isPackaged ? path.join(resourcesPath, "server-launcher.cjs") : path.join(__dirname, "server.cjs"),
  };
}

async function choosePort(profile) {
  const configPath = path.join(profile, "desktop-port.json");
  let preferred = 30142;
  try {
    const value = JSON.parse(fs.readFileSync(configPath, "utf8")).port;
    if (Number.isInteger(value) && value > 1024 && value < 65536) preferred = value;
  } catch { /* 首次启动使用独立于开发服务的默认端口。 */ }
  function available(port) {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const selected = server.address().port;
        server.close(() => resolve(selected));
      });
    });
  }
  const port = await available(preferred).catch(() => available(0));
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ port }));
  return port;
}

async function waitForServer(origin, authorization, child, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child?.spawnError) throw new Error(`本地服务无法启动：${child.spawnError.message}`);
    if (child && child.exitCode !== null) throw new Error("本地服务已退出，请重新启动。启动记录保存在应用日志目录。");
    try {
      const response = await requestLocal(origin, "/api/home", { authorization, timeout: Math.min(2500, deadline - Date.now()) });
      if (response.status === 200) return;
    } catch { /* 服务尚未完成启动，继续有限等待。 */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("本地服务启动超时，请检查应用日志后重试。");
}

/** 桌面启动只连接自己的回环服务，不经过系统代理；连接和响应都受同一时限约束。 */
function requestLocal(origin, endpoint, { authorization = "", json, timeout = 10000 } = {}) {
  const url = new URL(endpoint, origin);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.origin !== origin) {
    return Promise.reject(new Error("桌面连接必须使用当前本机服务。"));
  }
  return new Promise((resolve, reject) => {
    const body = json === undefined ? undefined : JSON.stringify(json);
    const headers = { ...(authorization ? { Authorization: authorization } : {}), ...(body ? { Origin: origin, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}) };
    const request = http.request(url, { method: body ? "POST" : "GET", headers, agent: false }, response => {
      // 启动接口只需要状态与 Cookie，读完响应以释放连接，不保留响应正文。
      response.resume();
      response.on("error", error => { clearTimeout(timer); reject(error); });
      response.on("end", () => { clearTimeout(timer); resolve({ status: response.statusCode, headers: response.headers }); });
    });
    const timer = setTimeout(() => request.destroy(new Error("本地工作区连接超时，请重新启动。")), timeout);
    request.on("error", error => { clearTimeout(timer); reject(error); });
    request.end(body);
  });
}

/** 页面可交互后即结束启动等待，不被图片等资源的完整加载拖住。 */
function loadWorkspacePage(window, origin, timeout = 30000, waitForInterface = false) {
  return new Promise((resolve, reject) => {
    const contents = window.webContents;
    let settled = false;
    const timer = setTimeout(() => finish(new Error("工作区页面加载超时，请重试。")), timeout);
    let documentReady = false;
    const ready = () => {
      documentReady = true;
      if (!waitForInterface) { finish(); return; }
      if (isOwnedUrl(contents.mainFrame?.url, origin) && new URL(contents.mainFrame.url).pathname === "/login") finish(new Error("工作区连接没有完成，请重新启动。"));
    };
    const interfaceReady = (event, channel) => {
      if (documentReady && channel === "pi-imagin:workspace-ready" && event.senderFrame === contents.mainFrame && isOwnedUrl(event.senderFrame?.url, origin)) finish();
    };
    const failed = (_event, code, description, _url, mainFrame) => { if (mainFrame) finish(new Error(`工作区页面加载失败：${description} (${code})`)); };
    const gone = () => finish(new Error("工作区窗口已关闭或页面进程已退出。"));
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      contents.off("dom-ready", ready);
      contents.off("ipc-message", interfaceReady);
      contents.off("did-fail-load", failed);
      contents.off("render-process-gone", gone);
      window.off("closed", gone);
      if (error) reject(error); else resolve();
    }
    contents.once("dom-ready", ready);
    if (waitForInterface) contents.on("ipc-message", interfaceReady);
    contents.on("did-fail-load", failed);
    contents.once("render-process-gone", gone);
    window.once("closed", gone);
    try { Promise.resolve(window.loadURL(origin)).catch(error => finish(error)); } catch (error) { finish(error); }
  });
}

function killTree(pid) {
  if (!pid) return Promise.resolve();
  return new Promise(resolve => {
    execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }, () => resolve());
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  // 先等待智能体和终端完成现有清理，再回收服务及遗留子进程。
  await new Promise(resolve => {
    const timer = setTimeout(done, 6500);
    const listener = message => { if (message?.type === "pi-imagin:shutdown-ready") done(); };
    function done() { clearTimeout(timer); child.off("message", listener); child.off("exit", done); child.off("error", done); resolve(); }
    child.on("message", listener);
    child.once("exit", done);
    child.once("error", done);
    try { child.send({ type: "pi-imagin:prepare-shutdown" }, error => { if (error) done(); }); } catch { done(); }
  });
  await killTree(child.pid);
}

module.exports = { choosePort, isExternalUrl, isOwnedUrl, pathsFor, stopServer, waitForServer, requestLocal, loadWorkspacePage };
