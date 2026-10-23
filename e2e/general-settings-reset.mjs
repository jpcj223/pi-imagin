import assert from "node:assert/strict";

export async function checkGeneralSettingsReset(page, { capture = async () => {} } = {}) {
  const settings = page.locator('.settings-workspace-page:not(.plugins-workspace-page)');
  const general = settings.locator('.settings-general');
  const reset = general.locator('.settings-reset-section');
  const before = await page.evaluate(() => ({ width: localStorage.getItem('pi-sidebar-width'), notification: typeof Notification === 'undefined' ? null : Notification.permission }));
  await page.evaluate(() => localStorage.setItem('e2e-preserve-on-reset', 'untouched'));
  await general.locator('#settings-font-ui').fill('serif');
  await general.locator('#settings-font-mono').fill('monospace');
  await general.locator('#settings-font-ui-weight').selectOption('500');
  await general.locator('#settings-font-mono-weight').selectOption('600');
  await general.locator('#settings-chat-content-font-size').fill('18');
  await general.locator('#settings-chat-content-width').fill('1200');
  const switches = general.locator('.settings-chat-switch-option [role="switch"]');
  for (const toggle of await switches.all()) if (await toggle.getAttribute('aria-checked') === 'false') await toggle.click();
  await general.locator('.settings-send-mode-option').filter({ hasText: 'Ctrl/Cmd+Enter' }).click();
  await general.locator('input[name="theme"][value="dark"]').evaluate(node => node.click());
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && !document.documentElement.dataset.themeTransition);
  await reset.getByRole('button', { name: 'Restore defaults', exact: true }).click();
  await reset.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await general.locator('#settings-font-ui').inputValue(), 'serif', '取消恢复保留当前设置');

  let failSave = true;
  const writes = [];
  const tools = { isWindows: true, powerShellEnabled: true, codemode: 'automatic', codemodeMode: 'on', codemodeInlineBudget: null };
  const handler = async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: tools });
    writes.push(route.request().postDataJSON());
    if (failSave) return route.fulfill({ status: 500, json: { error: 'Fixture save failure' } });
    tools.powerShellEnabled = false;
    return route.fulfill({ json: tools });
  };
  await page.route('**/api/tools/settings', handler);
  try {
    await reset.getByRole('button', { name: 'Restore defaults', exact: true }).click();
    await reset.getByRole('button', { name: 'Confirm restore', exact: true }).click();
    await reset.getByRole('alert').waitFor();
    assert.equal(await general.locator('#settings-font-ui').inputValue(), 'serif', '共享设置写入失败前不恢复本机偏好');
    assert.equal(await general.locator('#settings-chat-content-font-size').inputValue(), '18');
    await capture(page, 'settings-restore-retry');
    failSave = false;
    await reset.getByRole('button', { name: 'Confirm restore', exact: true }).click();
    await reset.getByRole('status').filter({ hasText: '常规设置已恢复默认' }).waitFor();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light' && !document.documentElement.dataset.themeTransition);
    assert.equal(await general.locator('#settings-font-ui').inputValue(), '');
    assert.equal(await general.locator('#settings-font-mono').inputValue(), '');
    assert.equal(await general.locator('#settings-font-ui-weight').inputValue(), '400');
    assert.equal(await general.locator('#settings-font-mono-weight').inputValue(), '400');
    assert.equal(await general.locator('#settings-chat-content-font-size').inputValue(), '14');
    assert.equal(await general.locator('#settings-chat-content-width').inputValue(), '820');
    for (const toggle of await switches.all()) assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    assert.equal(await general.locator('input[name="enter-send-mode"]:checked').inputValue(), 'enter');
    assert.equal(await general.locator('.settings-language-option[aria-checked="true"] .settings-language-label').innerText(), '简体中文');
    assert.equal(await general.getByRole('switch', { name: '使用 PowerShell 替代 Bash', exact: true }).getAttribute('aria-checked'), 'false');
    assert.deepEqual(writes, [{ enabled: false }, { enabled: false }], '只恢复 Shell，不覆盖其他工具或 MCP 配置');
    const stored = await page.evaluate(() => ({
      ui: localStorage.getItem('pi-ui-font-family'), mono: localStorage.getItem('pi-mono-font-family'),
      uiWeight: localStorage.getItem('pi-ui-font-weight'), monoWeight: localStorage.getItem('pi-mono-font-weight'),
      width: localStorage.getItem('pi-chat-content-width'), fontSize: localStorage.getItem('pi-chat-content-font-size'),
      theme: localStorage.getItem('pi-theme'), locale: localStorage.getItem('pi-locale'),
      sidebar: localStorage.getItem('pi-sidebar-width'), untouched: localStorage.getItem('e2e-preserve-on-reset'),
      notification: typeof Notification === 'undefined' ? null : Notification.permission,
    }));
    assert.deepEqual(stored, { ui: null, mono: null, uiWeight: null, monoWeight: null, width: '820', fontSize: '14', theme: 'light', locale: 'zh-CN', sidebar: before.width, untouched: 'untouched', notification: before.notification });
    await capture(page, 'settings-restored-defaults');
    await settings.getByRole('button', { name: '模型', exact: true }).click();
    assert.equal(await settings.locator('[data-settings-section="models"] input').evaluateAll(nodes => nodes.some(node => node.value === 'Layout draft stays')), true, '恢复默认不清空模型草稿');
    await settings.getByRole('button', { name: '常规', exact: true }).click();
    await general.locator('.settings-language-option').filter({ hasText: 'English' }).click();
  } finally {
    await page.unroute('**/api/tools/settings', handler);
    await page.evaluate(() => localStorage.removeItem('e2e-preserve-on-reset'));
  }
  console.log('PASS: 常规默认恢复、取消、失败保留与重试、存储与无关配置及草稿保留');
}
