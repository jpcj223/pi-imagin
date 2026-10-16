/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

/** 启动页覆盖导航过程，界面就绪后淡出并释放，不修改工作区的样式或布局。 */
function createStartupView({ WebContentsView, window, isQuitting, canShow, record = () => {} }) {
  let view, timer, finishing = false;
  const resize = () => {
    if (!view || window.isDestroyed()) return;
    const { width, height } = window.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  function dispose() {
    clearTimeout(timer);
    timer = undefined;
    window.off("resize", resize);
    if (!view) return;
    if (!window.isDestroyed()) window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    view = undefined;
    finishing = false;
  }
  async function show() {
    dispose();
    if (isQuitting() || window.isDestroyed()) return;
    view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    view.setBackgroundColor("#00000000");
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", event => event.preventDefault());
    window.contentView.addChildView(view);
    window.on("resize", resize);
    resize();
    view.webContents.on("ipc-message", (event, channel) => {
      if (finishing && channel === "pi-imagin:startup-transition-finished" && event.senderFrame === view?.webContents.mainFrame) dispose();
    });
    await view.webContents.loadFile(path.join(__dirname, "loading.html"));
    if (!isQuitting() && canShow()) window.show();
  }
  return {
    show, dispose,
    isSender: event => Boolean(view && event.sender === view.webContents && event.senderFrame === view.webContents.mainFrame),
    status: data => { if (view && !view.webContents.isDestroyed()) view.webContents.send("pi-imagin:startup-status", data); },
    finish: () => {
      if (!view || finishing) return;
      finishing = true;
      view.webContents.send("pi-imagin:startup-status", { message: "工作区已就绪", complete: true });
      // 回执优先，渲染异常时也在有限时间内释放覆盖层。
      timer = setTimeout(dispose, 280);
      record("工作区启动过渡已开始");
    },
  };
}

module.exports = { createStartupView };
