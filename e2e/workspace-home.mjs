import assert from "node:assert/strict";
import { join } from "node:path";

/** 同一流程验收两端的主页返回，使用隔离历史与文件，不发送模型请求。 */
export async function checkWorkspaceHome(page, label, artifacts, { origin, cwd, file, resume = false }) {
  page.setDefaultTimeout(12000);
  await page.goto(`${origin}/?session=home-return-test`);
  await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  await page.locator('.chat-content').getByText('主页返回验证', { exact: true }).waitFor();
  const home = page.getByRole('navigation', { name: '全局导航', exact: true }).getByRole('button', { name: '主页', exact: true });
  const input = page.locator('.chat-input-textarea');
  await input.fill('保留当前会话未发送草稿');
  const originalInput = await input.elementHandle();
  const scroll = page.locator('.chat-message-area > .overflow-y-auto');
  await scroll.evaluate(element => { element.scrollTop = 160; });
  const before = await scroll.evaluate(element => element.scrollTop);
  const originalUrl = page.url();
  const checkPreserved = async () => {
    assert.equal(page.url(), originalUrl);
    assert.equal(await input.inputValue(), '保留当前会话未发送草稿');
    assert.ok(await originalInput.evaluate(element => element.isConnected), '返回不能重新挂载聊天');
    assert.equal(await page.locator('.workspace-center').getAttribute('inert'), null);
    assert.ok(Math.abs(await scroll.evaluate(element => element.scrollTop) - before) < 5);
  };
  if (!resume) {
  const aux = page.getByRole('navigation', { name: '辅助面板', exact: true });
  await aux.hover(); await aux.getByRole('tab', { name: '完整历史', exact: true }).click();
  await page.getByTitle('完整历史记录', { exact: true }).waitFor();
  const history = await page.getByTitle('完整历史记录', { exact: true }).elementHandle();
  await page.getByRole('button', { name: '全宽阅读', exact: true }).click();
  await page.locator('.right-panel-full-width').waitFor(); await home.click();
  await checkPreserved(); assert.ok(await history.evaluate(element => element.isConnected));
  assert.equal(await page.locator('.right-panel-full-width').count(), 0);

  const group = page.locator('.session-tree-group.is-current').first();
  await group.hover(); await group.locator('.session-tree-group-action').click();
  await page.getByRole('menuitem', { name: /浏览.*文件/ }).click();
  await page.getByTitle(file.replaceAll('\\', '/'), { exact: true }).click();
  await page.locator('#file-panel').waitFor();
  const filePanel = await page.locator('#file-panel').elementHandle();
  await page.locator('.file-panel-expand-button').click();
  await page.locator('.right-panel-full-width').waitFor(); await home.click();
  await checkPreserved(); assert.ok(await filePanel.evaluate(element => element.isConnected));
  assert.equal(await page.locator('.right-panel-full-width').count(), 0);
  await home.click(); await checkPreserved();

  const rail = page.getByRole('navigation', { name: '全局导航', exact: true });
  await rail.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('region', { name: '设置', exact: true }).waitFor();
  await home.click(); await checkPreserved();
  await rail.getByRole('button', { name: '搜索会话', exact: true }).click();
  await page.getByRole('dialog', { name: '搜索会话', exact: true }).waitFor();
  await page.keyboard.press('Escape'); await home.click(); await checkPreserved();

  await page.mouse.move(1100, 100);
  assert.equal(await page.locator('.workspace-default-sessions').count(), 0);
  const selected = page.locator('.workspace-project-tree .session-tree-session.is-selected');
  assert.equal(await selected.locator('.session-tree-more-action').isVisible(), false);
  await selected.hover(); assert.equal(await selected.locator('.session-tree-more-action').isVisible(), true);
  await selected.locator('.session-tree-main').focus();
  await page.keyboard.press('Tab');
  assert.equal(await selected.locator('.session-tree-more-action').isVisible(), true);
  await page.mouse.move(1100, 100);
  if (label === 'web') await page.screenshot({ path: join(artifacts, `home-${label}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /显示侧边栏|Show sidebar/ }).click();
  await page.waitForFunction(() => {
    const sidebar = document.querySelector('#session-sidebar');
    return sidebar && Math.abs(sidebar.getBoundingClientRect().left) < 1;
  });
  await page.locator('.workspace-project-tree .session-tree-session.is-selected').waitFor();
  assert.equal(await page.locator('.workspace-project-tree .session-tree-session.is-selected .session-tree-more-action').isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (label === 'web') await page.screenshot({ path: join(artifacts, `home-${label}-mobile.png`) });
  return { client: label, passed: true, cwd, reusedCore: resume, checks: ['历史全宽返回并保留文档', '文件全宽返回并保留标签', '会话与草稿和阅读位置', '重复主页点击', '设置返回', '搜索关闭后返回', '空默认分区隐藏', '鼠标与键盘操作', '手机无横向溢出及菜单可用'] };
}
