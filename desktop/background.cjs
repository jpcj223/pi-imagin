/* eslint-disable @typescript-eslint/no-require-imports */
const { existsSync } = require("node:fs");

/** 关闭只隐藏窗口，保留页面、输入与服务；显式退出仍由主进程统一清理。 */
function installBackground({ app, Tray, Menu, window, icon, isQuitting, record = () => {}, enabled = true }) {
  let tray;
  let hidden = false;
  const hiddenChildren = new Set();
  const restore = () => {
    if (isQuitting() || window.isDestroyed()) return;
    hidden = false;
    if (window.isMinimized()) window.restore();
    window.show();
    for (const child of hiddenChildren) if (!child.isDestroyed()) child.show();
    hiddenChildren.clear();
    window.focus();
  };
  try {
    if (enabled) {
      if (!existsSync(icon)) throw new Error("托盘图标不存在");
      tray = new Tray(icon);
      tray.setToolTip("Pi Imagin · 关闭窗口后继续在后台运行");
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: "打开 Pi Imagin", click: restore },
        { type: "separator" },
        { label: "退出 Pi Imagin", click: () => app.quit() },
      ]));
      tray.on("click", restore);
      tray.on("double-click", restore);
    }
  } catch (error) {
    tray?.destroy();
    tray = undefined;
    // 托盘不可用时保留正常关闭，避免应用隐藏后无法找回。
    record(`托盘不可用，关闭窗口将退出：${error.message}`);
  }
  window.on("close", event => {
    if (isQuitting() || !tray) return;
    event.preventDefault();
    hidden = true;
    for (const child of window.getChildWindows()) if (child.isVisible()) { hiddenChildren.add(child); child.hide(); }
    window.hide();
    record("窗口已隐藏，工作区继续在后台运行");
  });
  return { restore, isHidden: () => hidden, available: () => Boolean(tray), dispose: () => { tray?.destroy(); tray = undefined; } };
}

module.exports = { installBackground };
