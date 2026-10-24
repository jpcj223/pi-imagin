/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

// 只暴露目录选择与启动页状态，不向页面提供文件系统、进程或任意 IPC。
contextBridge.exposeInMainWorld("piImaginDesktop", {
  chooseDirectory: () => ipcRenderer.invoke("pi-imagin:choose-directory"),
    chooseExecutable: () => ipcRenderer.invoke("pi-imagin:choose-executable"),
  retryStartup: () => ipcRenderer.invoke("pi-imagin:retry-startup"),
  finishStartupTransition: () => ipcRenderer.send("pi-imagin:startup-transition-finished"),
  onStartupStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("pi-imagin:startup-status", listener);
    return () => ipcRenderer.removeListener("pi-imagin:startup-status", listener);
  },
});

// 仅主工作区完成初始选择、正文及定位恢复后报告就绪，不把空 HTML 文档当作已打开。
if (["http:", "https:"].includes(window.location.protocol)) {
  window.addEventListener("DOMContentLoaded", () => {
    // 原生窗口按钮属于另一层，须同步页面标题栏的真实颜色、高度与缩放。
    document.documentElement.dataset.desktop = "true";
    let titlebar, frame;
    const colorHex = value => {
      const channels = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      return channels ? "#" + channels.slice(1, 4).map(value => Number(value).toString(16).padStart(2, "0")).join("") : null;
    };
    const syncTitlebar = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!titlebar) return;
        const style = getComputedStyle(titlebar);
        const height = titlebar.getBoundingClientRect().height;
        document.documentElement.style.setProperty("--desktop-titlebar-height", `${height}px`);
        // 原生按钮不在网页快照中，扩散完成后再同步，避免提前出现异色块。
        if (document.documentElement.dataset.themeTransition === "true") return;
        const color = colorHex(style.backgroundColor), symbolColor = colorHex(style.color);
        if (color && symbolColor) ipcRenderer.send("pi-imagin:titlebar", { height, color, symbolColor });
      });
    };
    const sizeObserver = new ResizeObserver(syncTitlebar);
    const themeObserver = new MutationObserver(syncTitlebar);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "data-theme-transition"] });
    const attachTitlebar = () => {
      titlebar = document.querySelector(".workspace-titlebar");
      if (!titlebar) return;
      findTitlebar.disconnect(); sizeObserver.observe(titlebar); syncTitlebar();
    };
    const findTitlebar = new MutationObserver(attachTitlebar);
    findTitlebar.observe(document.documentElement, { childList: true, subtree: true });
    attachTitlebar();
    window.addEventListener("resize", syncTitlebar);
    window.addEventListener("pagehide", () => {
      findTitlebar.disconnect(); sizeObserver.disconnect(); themeObserver.disconnect();
      window.removeEventListener("resize", syncTitlebar); cancelAnimationFrame(frame);
    }, { once: true });
    const observer = new MutationObserver(check);
    const timeout = setTimeout(() => observer.disconnect(), 90000);
    let reportedStage;
    function check() {
      const workspace = document.querySelector(".workspace-shell");
      const stage = workspace?.getAttribute("data-startup-stage");
      if (stage && stage !== reportedStage) {
        reportedStage = stage;
        ipcRenderer.send("pi-imagin:workspace-progress", stage);
      }
      if (workspace?.getAttribute("data-startup-ready") !== "true") return;
      observer.disconnect();
      clearTimeout(timeout);
      // 给已完成布局一次绘制机会，不增加固定等待。
      requestAnimationFrame(() => requestAnimationFrame(() => ipcRenderer.send("pi-imagin:workspace-ready")));
    }
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-startup-ready", "data-startup-stage"] });
    check();
    window.addEventListener("pagehide", () => { observer.disconnect(); clearTimeout(timeout); }, { once: true });
  }, { once: true });
}
