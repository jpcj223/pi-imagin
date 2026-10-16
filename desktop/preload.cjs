/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

// 只暴露目录选择与启动页状态，不向页面提供文件系统、进程或任意 IPC。
contextBridge.exposeInMainWorld("piImaginDesktop", {
  chooseDirectory: () => ipcRenderer.invoke("pi-imagin:choose-directory"),
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
