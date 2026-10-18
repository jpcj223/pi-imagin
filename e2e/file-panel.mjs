import assert from "node:assert/strict";
import { showSidebarFiles } from "./sidebar.mjs";

// 固定滚动坐标，避免浏览器在表单随宽度换行时自动调整锚点，干扰状态保留断言。
export const filePanelFixture = `<!doctype html><html style="overflow-anchor:none"><body style="margin:20px;min-height:2400px">
<label>Notes <input id="notes"></label>
<label>Filter <select id="filter"><option>All</option><option>Pending</option></select></label>
<p>HTML preview state must survive layout changes.</p>
<script>window.previewInstance = Math.random();</script></body></html>`;

export async function checkFilePanel(page, filePath) {
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  // The explorer lives in the sidebar's files: below the sessions, or its tab.
  await showSidebarFiles(page);
  // The DOM title normalizes Windows paths to forward slashes
  // (lib/file-paths.ts normalizeFilePathSlashes), so match in that form.
  await page.getByTitle(filePath.replace(/\\/g, "/"), { exact: true }).click();
  const panel = page.locator("#file-panel");
  const iframe = panel.locator("iframe");
  // 文件现在默认直接编辑；预览能力仍从现有模式切换进入。
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await iframe.waitFor();
  const frame = await (await iframe.elementHandle()).contentFrame();
  await frame.locator("#notes").fill("Keep this note");
  await frame.locator("#filter").selectOption({ label: "Pending" });
  await frame.evaluate(() => scrollTo(0, 120));
  const instance = await frame.evaluate(() => window.previewInstance);
  const width = () => panel.evaluate(async el => {
    await new Promise(requestAnimationFrame);
    await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
    return el.getBoundingClientRect().width;
  });
  const storedWidths = () => page.evaluate(() => [
    localStorage.getItem("pi-sidebar-width"), localStorage.getItem("pi-right-panel-width"),
  ]);
  const toggle = panel.getByRole("button", { name: "Expand file panel", exact: true });
  if (page.viewportSize().width <= 640) {
    assert.equal(await toggle.isVisible(), false, "Mobile already uses full width");
  } else {
    // Include a manually resized split in the round trip.
    const separator = page.locator('[data-resize-handle="right-panel"]');
    if (await separator.isVisible()) await separator.press("ArrowLeft");
    const originalWidth = await width();
    const originalStored = await storedWidths();
    for (let i = 0; i < 2; i++) {
      await toggle.click();
      assert.equal(await panel.getByRole("button", { name: "Restore file panel width", exact: true }).getAttribute("aria-pressed"), "true");
      // 全宽阅读限定在工作区内，左侧导航仍可操作，聊天区域暂停交互。
      const workbenchWidth = await page.locator(".workspace-workbench-row").evaluate(el => el.getBoundingClientRect().width);
      assert.ok(Math.abs(await width() - workbenchWidth) <= 1);
      assert.equal(await page.locator("#session-sidebar").evaluate(el => el.inert), false);
      assert.equal(await page.locator(".workspace-center").evaluate(el => el.inert), true);
      assert.equal(await frame.evaluate(() => window.previewInstance), instance);
      assert.equal(await frame.evaluate(() => scrollY), 120);
      assert.equal(await frame.locator("#notes").inputValue(), "Keep this note");
      assert.equal(await frame.locator("#filter").inputValue(), "Pending");
      await panel.getByRole("button", { name: "Restore file panel width", exact: true }).press("Enter");
      assert.equal(await width(), originalWidth);
      assert.deepEqual(await storedWidths(), originalStored);
      assert.equal(await page.locator("#session-sidebar").evaluate(el => el.inert), false);
    }
    await toggle.click();
    await page.getByRole("button", { name: "隐藏右侧栏", exact: true }).click();
    await page.getByRole("button", { name: "显示右侧栏", exact: true }).click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "Reopening returns to the split layout");
    assert.equal(await width(), originalWidth);
    assert.equal(await frame.evaluate(() => window.previewInstance), instance);
  }
  await page.getByRole("button", { name: "隐藏右侧栏", exact: true }).click();
  console.log(`PASS: file panel width and preview state at ${page.viewportSize().width}px`);
}
