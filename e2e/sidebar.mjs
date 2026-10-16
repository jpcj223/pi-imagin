import assert from "node:assert/strict";

/** 文件与会话共用左侧空间，文件树在切换时保持挂载。 */
export async function showSidebarFiles(page) {
  const files = page.locator("#session-sidebar-panel-files");
  if (!(await files.isVisible())) {
    await showSidebarSessions(page);
    const current = page.locator(".session-tree-group.is-current");
    const project = await current.count() ? current.first() : page.locator(".session-tree-group").first();
    await project.hover();
    await project.locator('.session-tree-group-action[aria-haspopup="menu"]').click();
    await page.getByRole("menuitem", { name: "Browse project files", exact: true }).click();
  }
  await files.locator(".sidebar-files-body").waitFor({ state: "visible" });
  // 文件操作只有通过目录访问验证后才可用；顺序与原有功能保持一致。
  const actions = files.getByRole("group", { name: "File actions", exact: true });
  await actions.waitFor();
  const labels = await actions.getByRole("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
  assert.match(labels[1], /^Open in (Explorer|Finder|file manager)$/);
  assert.deepEqual(labels, [
    "Open workspace terminal", labels[1], "Upload files to project root",
    "Refresh file list", "Show ignored files", "0 changed files", "Search files",
  ]);
  assert.equal(await actions.getByRole("button").evaluateAll(buttons => buttons.every(button => {
    const rect = button.getBoundingClientRect();
    const parent = button.parentElement.getBoundingClientRect();
    return rect.left >= parent.left - 1 && rect.right <= parent.right + 1;
  })), true, "文件操作不应溢出侧栏或相互遮挡");
}

/** 从文件树返回项目和会话，不依赖已隐藏的旧标签按钮。 */
export async function showSidebarSessions(page) {
  const show = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await show.isVisible()) await show.click();
  const back = page.locator(".workspace-files-back");
  if (await back.isVisible()) await back.click();
  await page.locator("#session-sidebar-panel-sessions").waitFor({ state: "visible" });
}

/** 验证项目文件入口、窗口内设置和文件搜索状态的连续性。 */
export async function checkFilesPlacement(page) {
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  await showSidebarFiles(page);
  const files = page.locator("#session-sidebar-panel-files");
  const fileSearch = files.getByRole("button", { name: "Search files", exact: true });
  const fileQuery = page.locator("#file-search-input");
  if (await fileSearch.getAttribute("aria-expanded") !== "true") await fileSearch.click();
  await fileQuery.fill("e2e-placement");
  const tree = await files.locator(".sidebar-files-scroll > *").first().elementHandle();
  await showSidebarSessions(page);
  assert.equal(await files.isVisible(), false);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.waitFor();
  assert.equal(await page.getByRole("dialog", { name: "Settings", exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await settings.waitFor({ state: "hidden" });
  await showSidebarFiles(page);
  assert.equal(await tree.evaluate(element => element.isConnected), true, "切换入口不重建文件树");
  assert.equal(await fileQuery.inputValue(), "e2e-placement", "返回文件树后保留搜索条件");
  await tree.dispose();
  await fileQuery.fill("");
  await fileSearch.click();
  await fileQuery.waitFor({ state: "detached" });
}
