/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
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
    icon: path.join(base, app.isPackaged ? "icons" : "desktop-icons", "icon.ico"),
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
      const response = await fetch(`${origin}/api/home`, { headers: authorization ? { Authorization: authorization } : {}, signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch { /* 服务尚未完成启动，继续有限等待。 */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("本地服务启动超时，请检查应用日志后重试。");
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
    function done() { clearTimeout(timer); child.off("message", listener); resolve(); }
    child.on("message", listener);
    try { child.send({ type: "pi-imagin:prepare-shutdown" }); } catch { done(); }
  });
  await killTree(child.pid);
}

module.exports = { choosePort, isExternalUrl, isOwnedUrl, pathsFor, stopServer, waitForServer };
