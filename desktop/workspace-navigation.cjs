/* eslint-disable @typescript-eslint/no-require-imports */
const { isOwnedUrl } = require("./runtime.cjs");

function isWorkspaceEntry(url, origin) {
  try { return isOwnedUrl(url, origin) && new URL(url).pathname === "/"; } catch { return false; }
}
/** 启动页与旧端口不属于用户工作记录，不能让侧键返回 loading.html。 */
function pruneStartupHistory(contents, origin) {
  const history = contents.navigationHistory;
  for (let index = history.length() - 1; index >= 0; index--) {
    if (index !== history.getActiveIndex() && !isWorkspaceEntry(history.getEntryAtIndex(index)?.url, origin)) history.removeEntryAtIndex(index);
  }
}
function navigateWorkspaceHistory(contents, origin, direction) {
  const history = contents.navigationHistory;
  for (let index = history.getActiveIndex() + direction; index >= 0 && index < history.length(); index += direction) {
    if (isWorkspaceEntry(history.getEntryAtIndex(index)?.url, origin)) { history.goToIndex(index); return true; }
  }
  return false;
}
function installWorkspaceNavigation(window, getOrigin, isStarting) {
  window.on("app-command", (event, command) => {
    if (!["browser-backward", "browser-forward"].includes(command)) return;
    event.preventDefault();
    if (!isStarting() && !window.isDestroyed()) navigateWorkspaceHistory(window.webContents, getOrigin(), command === "browser-backward" ? -1 : 1);
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.alt || input.control || input.meta || !["ArrowLeft", "ArrowRight"].includes(input.key)) return;
    event.preventDefault();
    if (!isStarting()) navigateWorkspaceHistory(window.webContents, getOrigin(), input.key === "ArrowLeft" ? -1 : 1);
  });
}
module.exports = { isWorkspaceEntry, pruneStartupHistory, navigateWorkspaceHistory, installWorkspaceNavigation };
