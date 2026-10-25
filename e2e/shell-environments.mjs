import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, openSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, _electron } from "playwright";
import { createJiti } from "jiti";
const { getLocalePlugin } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

// 私有会话和浏览器配置，不操作用户模型、会话或真实工作目录。
const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "请先停止同目录开发服务");
const artifactRoot = join(root, "output", "playwright"); mkdirSync(artifactRoot, { recursive: true });
const artifacts = mkdtempSync(join(artifactRoot, "shell-environments-"));
console.log(`Artifacts: ${artifacts}`);
const agent = join(artifacts, "agent"), project = join(artifacts, "terminal-project");
mkdirSync(join(agent, "sessions", "test"), { recursive: true }); mkdirSync(project);
writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: "https://example.invalid/v1", api: "openai-completions", apiKey: "test", models: [{ id: "test" }] } } }));
writeFileSync(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "test", enabledModels: ["fixture/test"] }));
const timestamp = "2026-10-23T00:00:00.000Z", id = "terminal-layout-fixture";
const entries = [{ type: "session", version: 3, id, timestamp, cwd: project }];
for (let i = 0; i < 36; i++) entries.push({ type: "message", id: `m${i}`, parentId: i ? `m${i - 1}` : null, timestamp, message: { role: "user", content: `阅读位置 ${i}：这是用于检查终端打开后消息是否被遮挡的测试消息。` } });
writeFileSync(join(agent, "sessions", "test", `${id}.jsonl`), entries.map(item => JSON.stringify(item)).join("\n") + "\n");
const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const log = openSync(join(artifacts, "server.log"), "w");
const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1", PI_WEB_PASSWORD: "", PI_WEB_NO_OPEN: "1" }, stdio: ["ignore", log, log], windowsHide: true });
let browser, desktop;
async function check(page, name) {
  page.setDefaultTimeout(30000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem("pi-locale", "en"); });
  await page.goto(`${base}/?session=${id}`);
  await page.locator('.workspace-rail-settings').waitFor();
  await page.locator('.chat-message-area').getByText('阅读位置 35：这是用于检查终端打开后消息是否被遮挡的测试消息。', { exact: true }).waitFor();
  const request = (method, body) => page.evaluate(async ({ method, body }) => {
    const response = await fetch('/api/shell-profiles', { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }, { method, body });
  assert.equal((await request('PUT', { action: 'reset' })).status, 200);
  await page.locator('.workspace-rail-settings').click();
  const settings = page.locator('.settings-workspace-page:not(.plugins-workspace-page)');
  const shells = settings.locator('.shell-settings');
  await shells.locator('[data-shell-id="powershell"]').waitFor();
  const capture = async suffix => { await shells.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(artifacts, `${name}-${suffix}.png`), animations: 'disabled' }); };
  assert.equal(await shells.locator('.shell-profile-list').getByRole('switch').count(), 0);
  assert.equal((await request('GET')).data.selectedId, 'powershell');
  const row = id => shells.locator(`[data-shell-id="${id}"]`);
  await row('powershell').getByRole('button', { name: 'Actions for Windows PowerShell' }).click();
  assert.equal(await page.getByRole('menuitem', { name: 'Remove from list' }).count(), 0);
  await page.getByRole('menuitem', { name: 'Show executable path' }).click();
  assert.match(await row('powershell').locator('code').innerText(), /powershell.exe/i);
  assert.equal((await request('PUT', { action: 'remove', id: 'powershell' })).status, 400);
  await row('cmd').getByRole('button', { name: 'Actions for CMD' }).click();
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  await page.waitForFunction(() => document.querySelector('.shell-profile-list > li')?.dataset.shellId === 'cmd');
  assert.equal((await request('GET')).data.selectedId, 'cmd');
  await row('powershell').getByRole('button', { name: 'Reorder Windows PowerShell' }).press('Alt+ArrowUp');
  await page.waitForFunction(() => document.querySelector('.shell-profile-list > li')?.dataset.shellId === 'powershell');
  await row('cmd').locator('.shell-profile-drag').dragTo(row('powershell'));
  await page.waitForFunction(() => document.querySelector('.shell-profile-list > li')?.dataset.shellId === 'cmd');
  await capture('list-en');
  await shells.getByRole('button', { name: 'Add environment', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add environment', exact: true });
  await dialog.locator('h4').first().waitFor();
  await page.screenshot({ path: join(artifacts, `${name}-add.png`) });
  await dialog.getByLabel('Display name').fill('My PowerShell');
  await dialog.getByLabel('Command syntax').selectOption('powershell');
  await dialog.getByLabel('Executable path').fill('C:\\missing-shell.exe');
  await dialog.getByRole('button', { name: 'Validate and add' }).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByLabel('Display name').inputValue(), 'My PowerShell');
  const detected = (await request('GET')).data.detected;
  const ps7 = detected.find(item => item.id === 'pwsh');
  assert.ok(ps7, '本机 PowerShell 7 用于真实自定义环境验证');
  await dialog.getByLabel('Executable path').fill(ps7.path);
  await dialog.getByRole('button', { name: 'Validate and add' }).click();
  await dialog.waitFor({ state: 'hidden' });
  let value = (await request('GET')).data;
  const custom = value.profiles.find(item => item.label === 'My PowerShell'); assert.ok(custom);
  // 优先级成为新终端默认值，同时不卸载或结束已经启动的环境。
  await request('PUT', { action: 'order', order: [custom.id, ...value.profiles.filter(item => item.id !== custom.id).map(item => item.id)] });
  const terminal = await page.evaluate(async cwd => { const response = await fetch('/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd, cols: 80, rows: 24 }) }); return { status: response.status, data: await response.json() }; }, project);
  assert.equal(terminal.status, 200, JSON.stringify(terminal)); assert.equal(terminal.data.shellId, custom.id);
  await page.evaluate(() => window.dispatchEvent(new Event('pi-shell-profiles-changed')));
  await row(custom.id).getByRole('button', { name: 'Actions for My PowerShell' }).click();
  await page.getByRole('menuitem', { name: 'Remove from list' }).click();
  await row(custom.id).waitFor({ state: 'detached' });
  const alive = await page.evaluate(async id => (await fetch(`/api/terminal/${id}`)).status, terminal.data.id); assert.equal(alive, 200);
  await page.evaluate(async id => fetch(`/api/terminal/${id}`, { method: 'DELETE' }), terminal.data.id);
  await page.keyboard.press('Escape'); await settings.waitFor({ state: 'hidden' });
  await page.locator('.workspace-status button').click();
  const dock = page.locator('.workspace-terminal');
  await dock.locator('.is-ready').waitFor();
  await dock.getByRole('button', { name: 'New terminal', exact: true }).click();
  const shellMenu = page.getByRole('menu'); await shellMenu.waitFor();
  assert.equal(await shellMenu.getByRole('menuitem', { name: 'Add other terminals', exact: true }).count(), 0);
  const configured = await page.evaluate(async () => (await (await fetch('/api/terminal')).json()).shells);
  const menuLabels = await shellMenu.getByRole('menuitem').allTextContents();
  assert.equal(menuLabels.length, configured.length);
  configured.forEach((profile, index) => assert.ok(menuLabels[index].startsWith(profile.label), '终端菜单顺序来自设置'));
  await page.screenshot({ path: join(artifacts, `${name}-terminal-menu.png`) });
  await page.keyboard.press('Escape');
  await page.locator('.workspace-rail-settings').click();
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    const plugin = getLocalePlugin(locale);
    await settings.locator('.settings-language-option').filter({ hasText: plugin.label }).click();
    await shells.getByRole('heading', { name: plugin.messages['shell.title'], exact: true }).waitFor();
    await capture(`list-${locale}`);
  }
  await page.reload();
  await page.locator('.chat-message-area').getByText('阅读位置 35：这是用于检查终端打开后消息是否被遮挡的测试消息。', { exact: true }).waitFor();
  await page.locator('.workspace-rail-settings').click();
  await shells.locator('.shell-profile-list').waitFor();
  assert.equal((await request('GET')).data.profiles[0].id, 'cmd');
  if (name === 'browser') {
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('narrow');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await shells.getByRole('button', { name: 'Add environment', exact: true }).click();
    await dialog.getByLabel('Display name').waitFor();
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: join(artifacts, 'browser-narrow-add.png') });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.ok(await settings.isVisible(), 'Esc 只关闭添加弹窗');
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${name}: 内置保护、排序/拖动/键盘、添加校验/错误保留、终端共享/不关闭进程、三语、刷新与窄屏`);
}

try {
  for (let i = 0; ; i++) { if ((await fetch(`${base}/api/home`).catch(() => null))?.ok) break; assert.ok(i < 120 && server.exitCode === null, "服务启动失败"); await delay(500); }
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await check(await context.newPage(), "browser"); await context.close();
  if (process.platform === "win32" && !process.env.SKIP_DESKTOP) {
    const require = createRequire(import.meta.url);
    desktop = await _electron.launch({ executablePath: require("../desktop/node_modules/electron"), args: [join(root, "desktop/main.cjs")], env: { ...process.env, PI_IMAGIN_DESKTOP_DEV_URL: base, PI_IMAGIN_DESKTOP_DEV_PROFILE: join(artifacts, "desktop"), PI_IMAGIN_DESKTOP_SMOKE: "1" } });
    // 初始 loadURL 完成并写入就绪标记后再导航，避免测试抢跑导致 ERR_ABORTED。
    for (let i = 0; ; i++) {
      if (existsSync(join(artifacts, "desktop", "smoke-ready.json"))) break;
      assert.ok(i < 150, "桌面启动未完成"); await delay(200);
    }
    let page;
    for (let i = 0; i < 100; i++) { page = desktop.windows().find(window => window.url().startsWith(base)); if (page) break; await delay(200); }
    assert.ok(page);
    await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith("http")); window.setSize(1440, 1000); window.showInactive();
      globalThis.terminalOverlayChecks = [];
      const original = window.setTitleBarOverlay.bind(window);
      window.setTitleBarOverlay = options => { globalThis.terminalOverlayChecks.push(options.height); original(options); };
    });
    await check(page, "desktop");

  }
} catch (error) {
  for (const page of [...(browser?.contexts().flatMap(context => context.pages()) ?? []), ...(desktop?.windows() ?? [])]) {
    if (!page.isClosed()) { await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {}); writeFileSync(join(artifacts, "failure.txt"), await page.locator("body").innerText().catch(() => "")); }
  }
  throw error;
} finally {
  await desktop?.close(); await browser?.close();
  if (process.platform === "win32") { const killer = spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true }); await once(killer, "exit"); }
  else { server.kill("SIGTERM"); await once(server, "exit"); }
  const rules = join(root, "AGENTS.md");
  writeFileSync(rules, readFileSync(rules, "utf8").replace(/\r?\n<!-- BEGIN:nextjs-agent-rules -->[\s\S]*?<!-- END:nextjs-agent-rules -->\r?\n?/, ""));
}
