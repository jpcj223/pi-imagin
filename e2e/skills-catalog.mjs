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
const artifacts = mkdtempSync(join(artifactRoot, "skills-catalog-"));
console.log(`Artifacts: ${artifacts}`);
const agent = join(artifacts, "agent"), project = join(artifacts, "terminal-project");
mkdirSync(join(agent, "sessions", "test"), { recursive: true }); mkdirSync(project);
for (const folder of ["frontend", "backend", "docs", "tests", "assets", "scripts", "examples"]) mkdirSync(join(project, folder));
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
  const errors = [], catalogCalls = [], contentCalls = [], installs = [], detailCalls = [];
  const longSkillPath = 'C:/Users/fixture/AppData/Roaming/Pi Imagin Development/303757b63056/agent/skills';
  page.on('pageerror', error => errors.push(error.message));
  const skill = i => ({ name: `Skill ${i}`, source: 'fixture/catalog', slug: `skill-${i}`, package: `fixture/catalog@skill-${i}`, installs: i * 101, official: false, url: `https://skills.sh/fixture/catalog/skill-${i}` });
  let failNext = true;
  await page.route('**/api/skills/catalog?*', async route => {
    const url = new URL(route.request().url()), q = url.searchParams.get('q'), number = Number(url.searchParams.get('page'));
    catalogCalls.push([q, number]);
    if (number === 1 && failNext) { failNext = false; await route.fulfill({ status: 502, json: { error: 'Fixture unavailable' } }); return; }
    if (q === 'slow') await delay(800);
    await route.fulfill({ json: { items: Array.from({ length: q ? 12 : number === 2 ? 10 : 200 }, (_, i) => ({ ...skill(i + number * 200), name: `${q || 'Skill'} ${i + number * 200}` })), page: number, total: q ? 12 : 410, hasNext: !q && number < 2, searchLimited: false } }).catch(() => {});
  });
  await page.route('**/api/skills/catalog/detail?*', route => { detailCalls.push(route.request().url()); return route.fulfill({ json: { package: 'fixture/catalog@skill-0', description: 'Real source description', readmeHtml: '<h2>Catalog instructions</h2><p>Read-only preview.</p><script>window.skillInjected=true</script><a href="javascript:alert(1)">unsafe</a><a href="file:///C:/secret">file</a>', truncated: false, markdown: '# Catalog instructions\n\nComplete remote instructions.\n\n## Final usage example\n\nFull document tail.', documentUrl: 'https://raw.githubusercontent.com/fixture/catalog/main/skills/skill-0/SKILL.md' } }); });
  const a = { name: 'Installed A', description: 'First local skill', filePath: join(project, 'a', 'SKILL.md'), baseDir: join(project, 'a'), sourceInfo: { source: 'user', scope: 'user' }, disableModelInvocation: false, canRemove: true };
  const b = { ...a, installOrigin: 'app', name: 'Installed B', description: 'Second local skill', filePath: join(project, 'b', 'SKILL.md'), baseDir: join(project, 'b') };
  let installedSkills = [a, b], holdInstalls = false;
  const pendingInstalls = [];
  await page.route(/\/api\/skills(?:\?.*)?$/, async route => {
    if (route.request().method() === 'DELETE') installedSkills = installedSkills.filter(item => item.filePath !== route.request().postDataJSON().filePath);
    await route.fulfill({ json: { success: true, skills: installedSkills, diagnostics: [], projectResourcesLoaded: true, globalSkillsPath: longSkillPath } });
  });
  await page.route('**/api/skills/content?*', route => { const path = new URL(route.request().url()).searchParams.get('filePath'); contentCalls.push(path); return route.fulfill({ json: { content: `---\nname: local\n---\n# ${path === a.filePath ? 'Instructions A' : path === b.filePath ? 'Instructions B' : 'Installed skill instructions'}\n\nLocal instructions.` } }); });
  await page.route('**/api/skills/install', async route => {
    const body = route.request().postDataJSON(); installs.push(body);
    let release;
    if (holdInstalls) await new Promise(resolve => { release = resolve; pendingInstalls.push({ body, finish: resolve }); });
    if (release && pendingInstalls.find(item => item.body === body)?.fail) return route.fulfill({ status: 500, json: { error: 'Fixture independent failure' } });
    const slug = body.package.split('@')[1];
    installedSkills = [...installedSkills.filter(item => item.install?.package !== body.package), { ...a, name: slug, filePath: join(project, slug, 'SKILL.md'), baseDir: join(project, slug), install: { scope: body.scope, package: body.package, source: 'fixture/catalog', canCheckForUpdates: false } }];
    await route.fulfill({ json: { success: true } });
  });
  const pluginTotals = { extensions: 0, skills: 0, prompts: 0, themes: 0 };
  let pluginPackages = [], holdPlugins = true;
  const pendingPlugins = [];
  const pluginSnapshot = () => ({ packages: pluginPackages, standaloneExtensions: [], totals: { extensions: pluginPackages.length, skills: pluginPackages.length * 2, prompts: pluginPackages.length * 3, themes: 0 }, diagnostics: [], projectResourcesLoaded: true, globalInstallPath: 'C:/Users/fixture/AppData/Roaming/Pi Imagin Development/303757b63056/agent/npm' });
  await page.route(/\/api\/plugins(?:\?.*)?$/, async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (body.action === 'install') {
        if (holdPlugins) await new Promise(resolve => pendingPlugins.push({ body, finish: resolve }));
        pluginPackages.push({ source: body.source, scope: body.scope, packageName: body.source.slice(4), installedPath: 'C:/fixture/plugin', canCheckForUpdates: false, filtered: false, disabled: false, installOrigin: 'app', status: 'installed', counts: { extensions: 1, skills: 2, prompts: 3, themes: 0 }, resources: [] });
      }
    }
    await route.fulfill({ json: pluginSnapshot() });
  });
  await page.route('**/api/plugins/search?*', route => route.fulfill({ json: { items: Array.from({ length: 4 }, (_, i) => ({ name: `fixture-plugin-${i}`, source: `npm:fixture-plugin-${i}`, description: 'Concurrent plugin', types: ['extension'], url: `https://pi.dev/packages/fixture-plugin-${i}` })), page: 1, total: 4, hasNext: false } }));
  await page.route('**/api/plugins/logos?*', route => route.fulfill({ json: {} }));
  await page.route('**/api/plugins/detail?*', route => route.fulfill({ json: { name: new URL(route.request().url()).searchParams.get('name'), description: 'Fixture plugin', partial: false } }));
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.fixtureCopiedPath = value; } } }); if (window === window.top) { localStorage.setItem('pi-locale', 'en'); if (!localStorage.getItem('pi-workspace-rail-order')) localStorage.setItem('pi-workspace-rail-order', JSON.stringify(['plugins', 'home', 'search'])); } });
  await page.goto(`${base}/?session=${id}`);
  await page.locator('.chat-message-area').getByText('阅读位置 35：这是用于检查终端打开后消息是否被遮挡的测试消息。', { exact: true }).waitFor();
  // 工作区空闲时预热，打开目录不重复读取同一个首页。
  await page.waitForFunction(() => sessionStorage.getItem('pi-skills-catalog-home-v1') !== null);
  assert.equal(catalogCalls.filter(([q, n]) => !q && n === 0).length, 1);
  assert.deepEqual(await page.locator('[data-rail-item]').evaluateAll(nodes => nodes.map(node => node.dataset.railItem)), ['plugins', 'home', 'search', 'skills']);
  await page.locator('.workspace-rail-skills').press('Alt+ArrowUp');
  assert.deepEqual(await page.locator('[data-rail-item]').evaluateAll(nodes => nodes.map(node => node.dataset.railItem)), ['plugins', 'home', 'skills', 'search']);
  await page.locator('.workspace-rail-skills').click();
  const settings = page.locator('.settings-workspace-page:not(.resource-workspace-page)');
  const section = page.locator('.skills-workspace-page [data-settings-section="skills"]');
  const catalog = section.locator('.skills-catalog-host'), cards = catalog.locator('.skills-catalog-card');
  const search = catalog.getByRole('searchbox', { name: 'Search the skills directory…' });
  await cards.first().waitFor();
  assert.equal(await page.locator('.skills-workspace-page .settings-section-tabs:visible').count(), 0, '独立页没有设置分类栏');
  assert.equal(await page.locator('.workspace-rail-skills').getAttribute('aria-current'), 'page');
  const railStyle = await page.locator('.workspace-rail-skills').evaluate(el => ({ style: getComputedStyle(el).display, padding: getComputedStyle(el).paddingLeft, bg: getComputedStyle(el).backgroundColor }));
  assert.equal(railStyle.style, 'grid'); assert.equal(railStyle.padding, '0px'); assert.notEqual(railStyle.bg, 'rgba(0, 0, 0, 0)');
  const bounds = await page.locator('.skills-workspace-page').boundingBox();
  const sidebarBounds = await section.locator('.config-sidebar').boundingBox();
  assert.ok(Math.abs(sidebarBounds.x - bounds.x) < 1, '侧栏贴合工作区边界');
  assert.ok(Math.abs(bounds.x + bounds.width - await page.evaluate(() => innerWidth)) < 2, '页面覆盖到右侧边缘');
  await page.locator('[data-testid="settings-sidebar-resizer"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(width => document.querySelector('.skills-workspace-page .config-sidebar').getBoundingClientRect().width > width, sidebarBounds.width);
  const adjusted = await section.locator('.config-sidebar').evaluate(el => el.getBoundingClientRect().width);
  await page.locator('.workspace-rail-plugins').click();
  await page.locator('.plugins-workspace-page .config-sidebar:visible').waitFor();
  assert.equal(await page.locator('.plugins-workspace-page .config-sidebar:visible').evaluate(el => el.getBoundingClientRect().width), adjusted);
  await page.locator('.workspace-rail-skills').click();
  await page.locator('[data-testid="settings-sidebar-resizer"]').press('Enter');
  assert.equal(await cards.count(), 200); assert.equal(contentCalls.length, 0);
  assert.equal(catalogCalls.filter(([q, n]) => !q && n === 0).length, 1);
  assert.equal(await section.locator('.config-list-action').count(), 0, '移除左下角常驻返回');
  assert.equal(await section.locator('.config-sidebar-group').count(), 2, '同一全局范围区分应用安装和外置');
  const searchStyle = await search.evaluate(el => { const s = getComputedStyle(el); return [s.height, s.padding, s.borderRadius, s.borderColor, s.fontSize]; });
  const pathTrigger = catalog.locator('.skills-catalog-options .resource-path-trigger');
  await pathTrigger.waitFor();
  assert.ok(!(await pathTrigger.innerText()).includes('AppData'), '路径默认收起中间目录');
  const divider = await section.locator('.skills-installed-search').evaluate(el => el.getBoundingClientRect().bottom);
  await page.locator('.workspace-rail-plugins').click();
  assert.ok(Math.abs(await page.locator('.plugins-workspace-page .plugins-list-header').evaluate(el => el.getBoundingClientRect().bottom) - divider) < 1, '插件与技能分隔线对齐');
  await page.locator('.workspace-home').click();
  assert.equal(await page.locator('.workspace-project-heading:visible').evaluate(el => getComputedStyle(el).borderBottomWidth), '0px', '主页去掉分隔线，不强制与资源页对齐');
  assert.equal((await page.locator('.sidebar-header:visible').boundingBox()).height, 80, '主页入口区域适度下移10px');
  await page.screenshot({ path: join(artifacts, `${name}-compact-home.png`) });
  if (process.env.RESOURCE_LAYOUT_ONLY || process.env.PROJECT_UI_ONLY) {
    await page.locator('.workspace-rail-plugins').click();
    const header = page.locator('.plugins-workspace-page .plugins-list-header');
    assert.equal((await header.boundingBox()).height, 96);
    assert.equal(await header.locator('input').evaluate(el => getComputedStyle(el).height), '34px');
    await page.screenshot({ path: join(artifacts, `${name}-comfortable-plugins.png`) });
    await page.locator('.workspace-rail-skills').click();
    assert.equal((await section.locator('.skills-installed-search').boundingBox()).height, 96);
    await page.screenshot({ path: join(artifacts, `${name}-comfortable-skills.png`) });
    if (process.env.PROJECT_UI_ONLY) await checkProjectUi(page, name);
    console.log(`PASS ${name}: 主页无分隔线，插件/技能96px标题区与34px搜索框`); return;
  }
  await page.locator('.workspace-rail-search').click();
  await page.getByRole('dialog', { name: 'Search conversations', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close search', exact: true }).click();
  assert.equal(await page.locator('.workspace-rail-search').evaluate(el => el.matches(':focus-visible') || el.classList.contains('is-active')), false, '鼠标关闭搜索后无残留高亮');
  await page.locator('.workspace-rail-skills').click();
  const beforeHover = await catalog.locator('.skills-catalog-tools').boundingBox();
  await pathTrigger.hover();
  const pathPopup = page.locator('.resource-path-popup'); await pathPopup.waitFor();
  assert.equal(await pathPopup.locator('.resource-path-full').innerText(), longSkillPath);
  await pathPopup.getByRole('button', { name: 'Copy path', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureCopiedPath), longSkillPath);
  assert.equal((await catalog.locator('.skills-catalog-tools').boundingBox()).height, beforeHover.height, '悬停浮层不挤动页面');
  await pathTrigger.press('Escape'); await pathPopup.waitFor({ state: 'detached' });
  await page.screenshot({ path: join(artifacts, `${name}-catalog.png`) });
  await page.locator('.workspace-rail-settings').click();
  await settings.getByRole('button', { name: 'General', exact: true }).waitFor();
  assert.equal(await settings.getByRole('button', { name: 'Skills', exact: true }).count(), 0, '设置分类不再重复提供技能');
  await page.keyboard.press('Escape'); await catalog.waitFor();
  assert.equal(await page.locator('.workspace-rail-skills').getAttribute('aria-current'), 'page', '关闭设置返回技能页');

  const row = label => section.locator('.config-sidebar').getByRole('button', { name: label, exact: true });
  await row('Installed A').click(); await section.getByRole('heading', { name: 'Instructions A', exact: true }).waitFor();
  await section.locator('.skills-installed-toolbar').getByRole('button', { name: 'Copy name', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureCopiedPath), 'Installed A');
  assert.ok((await section.locator('.skills-installed-toolbar').getByRole('button', { name: 'Back', exact: true }).boundingBox()).width >= 78);
  await row('Installed B').click(); await section.getByRole('heading', { name: 'Instructions B', exact: true }).waitFor();
  await row('Installed B').click(); await search.waitFor();
  await row('Installed A').click(); await section.getByRole('heading', { name: 'Instructions A', exact: true }).waitFor(); await row('Installed A').click();
  assert.equal(contentCalls.filter(path => path === a.filePath).length, 1, '已安装详情复用缓存');
  const scroller = catalog.locator('.skills-catalog-scroll').first();
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await catalog.getByRole('alert').waitFor(); assert.equal(await cards.count(), 200);
  await catalog.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.skills-catalog-card').length === 400);
  assert.equal(catalogCalls.filter(([, n]) => n === 1).length, 2);
  await scroller.evaluate(el => { el.scrollTop = 1500; });
  await row('Installed A').click(); await row('Installed A').click();
  assert.ok(await scroller.evaluate(el => el.scrollTop) >= 1490, '返回保留累计目录及滚动'); assert.equal(await cards.count(), 400);
  await search.fill('react'); await page.waitForFunction(() => document.querySelectorAll('.skills-catalog-card').length === 12);
  await row('Installed B').click(); await row('Installed B').click(); assert.equal(await search.inputValue(), 'react');
  await cards.first().locator('.skills-card-open').click();
  await catalog.getByRole('heading', { name: 'Catalog instructions' }).waitFor();
  await catalog.getByRole('heading', { name: 'Final usage example' }).waitFor();
  await page.screenshot({ path: join(artifacts, `${name}-source-detail.png`) });
  assert.equal(await search.isVisible(), false, '详情模式收起目录搜索');
  assert.equal(await catalog.getByRole('heading', { name: 'Add skill', exact: true }).count(), 0);
  assert.equal(await catalog.locator('script, a[href^="javascript:"], a[href^="file:"]').count(), 0);
  assert.equal(await page.evaluate(() => window.skillInjected), undefined);
  await catalog.locator('.skills-detail-toolbar').getByRole('button', { name: 'Back', exact: true }).click();
  assert.equal(await cards.count(), 12);
  await cards.first().getByRole('button', { name: 'Install', exact: true }).click();
  await cards.first().getByRole('button', { name: 'Installed', exact: true }).waitFor();
  assert.deepEqual(installs[0], { package: 'fixture/catalog@skill-0', scope: 'global', cwd: project });
  const detailCount = detailCalls.length;
  await cards.first().locator('.skills-card-open').click();
  await section.getByRole('heading', { name: 'Installed skill instructions', exact: true }).waitFor();
  assert.equal(detailCalls.length, detailCount, '已安装卡片直接读取本地完整说明');
  await section.locator('.skills-installed-toolbar').getByRole('button', { name: 'Back', exact: true }).click();

  assert.equal(await catalog.locator('.skills-catalog-detail').count(), 0, '安装按钮不打开详情');
  // A/B/C 在任何任务完成前均已发出；失败独立，其他项目仍可安装。
  holdInstalls = true;
  for (const index of [1, 2, 3]) await cards.nth(index).getByRole('button', { name: 'Install', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(pendingInstalls.length, 3);
  assert.ok(await cards.nth(4).getByRole('button', { name: 'Install', exact: true }).isEnabled());
  pendingInstalls[1].fail = true;
  pendingInstalls[1].finish(); pendingInstalls[2].finish(); pendingInstalls[0].finish();
  await cards.nth(2).getByRole('alert').waitFor();
  await cards.nth(1).getByRole('button', { name: 'Installed', exact: true }).waitFor();
  await cards.nth(3).getByRole('button', { name: 'Installed', exact: true }).waitFor();
  holdInstalls = false;
  await cards.nth(2).getByRole('button', { name: 'Install', exact: true }).click();
  await cards.nth(2).getByRole('button', { name: 'Installed', exact: true }).waitFor();
  await row('skill-2').waitFor();
  // 删除有确认，删除后卡片和左侧同步。
  await row('skill-2').click();
  await section.locator('.skills-installed-toolbar').getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.ok(await row('skill-2').isVisible());
  await section.locator('.skills-installed-toolbar').getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await search.waitFor();
  assert.equal(await row('skill-2').count(), 0);
  assert.ok(await cards.nth(2).getByRole('button', { name: 'Install', exact: true }).isEnabled());
  // 插件页也同时开始三个安装，安装列表重复点击返回目录。
  await page.locator('.workspace-rail-plugins').click();
  const pluginSection = page.locator('.plugins-manager:visible'), pluginCards = pluginSection.locator('.plugin-card');
  await pluginCards.first().waitFor();
  assert.equal(await pluginSection.locator('.config-list-action').count(), 0);
  assert.deepEqual(await pluginSection.locator('.plugins-catalog-heading input').evaluate(el => { const s = getComputedStyle(el); return [s.height, s.padding, s.borderRadius, s.borderColor, s.fontSize]; }), searchStyle, '技能与插件搜索复用同一套样式');
  const pluginPath = pluginSection.locator('.plugins-catalog-options .resource-path-trigger');
  await pluginPath.hover(); await page.locator('.resource-path-popup').waitFor();
  await pluginPath.press('Escape');
  for (const index of [0, 1, 2]) await pluginCards.nth(index).getByRole('button', { name: 'Install', exact: true }).click();
  await page.waitForTimeout(200); assert.equal(pendingPlugins.length, 3);
  assert.ok(await pluginCards.nth(3).getByRole('button', { name: 'Install', exact: true }).isEnabled());
  pendingPlugins[2].finish(); pendingPlugins[0].finish(); pendingPlugins[1].finish();
  for (const index of [0, 1, 2]) await pluginCards.nth(index).getByRole('button', { name: 'Installed', exact: true }).waitFor();
  const pluginRow = pluginSection.locator('.config-sidebar').getByRole('button', { name: 'fixture-plugin-0', exact: true });
  await pluginRow.click();
  await page.waitForTimeout(300);
  await page.locator('.plugins-workspace-page .plugins-detail-toolbar .config-button').waitFor();
  assert.equal(await page.locator('.plugins-workspace-page .plugins-detail-toolbar .config-button').innerText(), 'Back');
  assert.match(await pluginSection.locator('.plugins-footer-summary').innerText(), /fixture-plugin-0.*1.*2.*3/s, '选中时显示该插件各类资源数量');
  await pluginSection.getByRole('button', { name: 'Copy name', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureCopiedPath), 'fixture-plugin-0');
  await pluginSection.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('alertdialog').waitFor();
  assert.match(await page.getByRole('alertdialog').innerText(), /fixture-plugin-0/);
  await page.screenshot({ path: join(artifacts, name + '-remove-dialog.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('alertdialog').count(), 0);
  assert.ok(await pluginSection.isVisible(), 'Escape只关闭最上层确认');
  await pluginRow.click(); await pluginCards.first().waitFor();
  assert.match(await pluginSection.locator('.plugins-footer-summary').innerText(), /Total.*3.*6.*9/s, '回到列表恢复总计');
  await page.locator('.workspace-rail-skills').click();
  await search.fill('slow'); await delay(400); await search.fill('fast'); await search.press('Enter');
  await cards.first().getByText('fast 0', { exact: true }).waitFor(); await delay(900); assert.equal(await cards.first().locator('.skills-card-name').innerText(), 'fast 0');
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    const plugin = getLocalePlugin(locale);
    await row('Installed A').click();
    await page.locator('.workspace-rail-settings').click();
    await settings.locator('.settings-section-tab').first().click();
    await settings.locator('.settings-language-option').filter({ hasText: plugin.label }).click();
    await page.locator('.workspace-rail-skills').click();
    await catalog.getByRole('searchbox', { name: plugin.messages['skills.catalog.search'] }).waitFor();
    assert.equal(await section.locator('.skills-installed-detail').count(), 0, '重新进入默认添加页');
    assert.equal(await catalog.locator('.skills-catalog-search input').inputValue(), 'fast');
    await page.screenshot({ path: join(artifacts, `${name}-${locale}.png`) });
  }

  await page.locator('.workspace-rail-settings').click();
  await settings.getByRole('button', { name: 'General', exact: true }).click();
  await settings.locator('.settings-theme-option').filter({ hasText: /^Dark$/ }).click();
  await page.locator('.workspace-rail-skills').click();
  await page.screenshot({ path: join(artifacts, `${name}-dark.png`) });
  await page.locator('.workspace-rail-settings').click();
  await settings.locator('.settings-theme-option').filter({ hasText: /^Light$/ }).click();
  await page.locator('.workspace-rail-skills').click();
  await section.getByRole('searchbox', { name: 'Search installed skills…' }).fill('Installed B');
  assert.equal(await row('Installed A').count(), 0); assert.equal(await row('Installed B').count(), 1);
  if (name === 'browser') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(artifacts, 'browser-narrow.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const box = await cards.first().boundingBox(); assert.ok(box.width > 200 && box.x + box.width <= 390);
    await section.getByRole('button', { name: `Installed skills (${installedSkills.length})`, exact: true }).click();
    await row('Installed B').click(); await section.getByRole('heading', { name: 'Instructions B' }).waitFor();
    const narrowPath = section.locator('.skill-detail-heading .resource-path-trigger'); await narrowPath.focus();
    await page.locator('.resource-path-popup').waitFor();
    const popupBox = await page.locator('.resource-path-popup').boundingBox(); assert.ok(popupBox.x >= 0 && popupBox.x + popupBox.width <= 390);
    await page.screenshot({ path: join(artifacts, 'browser-narrow-detail.png') });
    await narrowPath.press('Escape');
  }
  if (name === "browser") {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.workspace-home').click();
    await page.locator('.sidebar-new-button:visible').click();
    await page.locator('.new-session-intro').waitFor();
    const composer = await page.locator('.chat-content.is-empty-new .chat-composer-region').boundingBox();
    const chat = await page.locator('.chat-content.is-empty-new').boundingBox();
    assert.ok(composer.y + composer.height / 2 > chat.y + chat.height / 2, '新会话输入区域适当下移');
    await page.locator('.workspace-project-heading button:visible').click();
    const editor = page.locator('.project-editor'); await editor.waitFor();
    await editor.locator('.project-editor-recents summary').click();
    const recent = editor.locator('.project-recent-row').first();
    await recent.waitFor();
    assert.ok(!(await recent.locator('.project-recent-name').innerText()).includes('\\'), '最近默认显示名称');
    const recentPath = recent.locator('.inline-resource-path');
    const beforeHover = await editor.boundingBox(), rowBeforeHover = await recent.boundingBox();
    await recentPath.hover();
    assert.equal(await page.locator('.resource-path-popup:visible').count(), 0, '悬停不再展开路径');
    await recentPath.locator('.resource-path-trigger').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Show full path', exact: true }).click();
    await page.locator('.resource-path-popup:visible').waitFor();
    assert.equal(await recentPath.locator('.resource-path-trigger').evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
    assert.deepEqual(await editor.boundingBox(), beforeHover, '悬停不会移动或撑高项目弹窗');
    assert.deepEqual(await recent.boundingBox(), rowBeforeHover, '最近路径悬停时行高保持稳定');
    assert.ok((await recentPath.locator('.resource-path-trigger').innerText()).startsWith('…'), '默认省略路径前缀');
    const recentText = await page.locator('.resource-path-popup .resource-path-full').innerText();
    await recentPath.getByRole('button', { name: 'Copy path', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixtureCopiedPath), recentText);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.resource-path-popup:visible').count(), 0);
    assert.ok(await editor.isVisible(), 'Escape只收起路径，不关闭项目编辑');
    const recentsBefore = await editor.locator('.project-recent-row').count();
    await recent.locator('.project-recent-remove').click();
    assert.equal(await editor.locator('.project-recent-row').count(), recentsBefore - 1);
    for (const folder of ['frontend', 'backend']) {
      await editor.getByRole('textbox', { name: 'Folder path', exact: true }).fill(join(project, folder));
      await editor.getByRole('button', { name: 'Add', exact: true }).click();
      await editor.locator('.project-editor-folder').filter({ hasText: folder }).waitFor();
    }
    const folders = editor.locator('.project-editor-folder');
    const targetHeight = (await folders.nth(1).boundingBox()).height;
    await folders.first().dragTo(folders.nth(1), { sourcePosition: { x: 12, y: 20 }, targetPosition: { x: 16, y: targetHeight - 4 } });
    assert.equal(await folders.first().locator('input').inputValue(), 'backend', '从整行拖动排序');
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await folders.first().dispatchEvent('dragstart', { dataTransfer: transfer });
    assert.equal(await page.locator('.project-folder-drag-preview').count(), 1, '自定义拖动预览只保留一个副本');
    assert.equal(await page.locator('.project-folder-drag-preview input,.project-folder-drag-preview button').count(), 0, '预览不重复截取输入框或操作按钮');
    assert.equal(await page.locator('.resource-path-popup:visible').count(), 0, '拖动期间不展开路径');
    assert.equal(await folders.first().getAttribute('class').then(value => value.includes('is-dragging')), true);
    await folders.first().dispatchEvent('dragend', { dataTransfer: transfer });
    assert.equal(await page.locator('.project-folder-drag-preview').count(), 0);
    for (const folder of ['docs', 'tests', 'assets', 'scripts', 'examples']) {
      await editor.getByRole('textbox', { name: 'Folder path', exact: true }).fill(join(project, folder));
      await editor.getByRole('button', { name: 'Add', exact: true }).click();
      await editor.locator('.project-editor-folder').filter({ hasText: folder }).waitFor();
    }
    assert.equal((await editor.boundingBox()).height, beforeHover.height, '增加文件夹不改变弹窗高度');
    assert.ok(await editor.locator('.project-editor-body').evaluate(el => el.scrollHeight > el.clientHeight), '过多内容在正文内滚动');
    await editor.locator('.project-editor-body').evaluate(el => { el.scrollTop = 0; });
    await folders.first().locator('input').fill('');
    await editor.getByRole('textbox', { name: 'Project name', exact: true }).fill('');
    assert.ok(await editor.getByRole('button', { name: 'Create project', exact: true }).isEnabled(), '不命名也可创建');
    await page.screenshot({ path: join(artifacts, 'browser-project-editor.png') });
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();

    let profiles = ['one', 'two', 'three'].map((id, index) => ({ id, label: 'Shell ' + id, kind: index ? 'bash' : 'powershell', path: 'C:/fixture/' + id, builtin: index === 0, available: true, modelSupported: true }));
    let ordered;
    await page.route('**/api/shell-profiles', async route => {
      if (route.request().method() === 'PUT') { const change = route.request().postDataJSON(); ordered = change.order; profiles = change.order.map(id => profiles.find(item => item.id === id)); }
      await route.fulfill({ json: { profiles, detected: profiles, selectedId: profiles[0].id } });
    });
    await page.locator('.workspace-rail-settings').click();
    await settings.getByRole('button', { name: 'General', exact: true }).click();
    const shellRows = settings.locator('.shell-profile-row');
    await page.evaluate(() => window.dispatchEvent(new Event('pi-shell-profiles-changed')));
    await shellRows.first().getByText('Shell one', { exact: true }).waitFor();
    await shellRows.first().dragTo(shellRows.nth(2));
    await page.waitForFunction(() => document.querySelector('.shell-profile-name')?.textContent.includes('Shell two'));
    assert.deepEqual(ordered, ['two', 'three', 'one']);
    await shellRows.first().locator('.shell-profile-more').click();
    await page.getByRole('menu').waitFor();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: join(artifacts, 'browser-shell-row.png') });
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${name}: 默认目录、A/B切换与取消、分页/重试/去重、缓存、滚动恢复、搜索防抖/过时取消、详情净化、安装、三语、窄屏`);
}

async function checkProjectUi(page, name) {
  const opened = [];
  await page.route('**/api/open-in-explorer', route => {
    if (route.request().method() === 'POST') opened.push(route.request().postDataJSON().cwd);
    return route.fulfill({ json: { supported: true, platform: 'win32', opened: true } });
  });
  await page.locator('.workspace-home').click();
  await page.locator('.sidebar-new-button:visible').click();
  await page.keyboard.press('Control+f');
  assert.equal(await page.locator('.scoped-find,[data-find-scope]').count(), 0, '已删除区域Ctrl+F查找');
  assert.equal(await page.getByRole('dialog', { name: 'Search conversations', exact: true }).count(), 0, '不通过区域快捷键打开搜索');
  await page.locator('.workspace-project-heading button:visible').click();
  const editor = page.locator('.project-editor'); await editor.waitFor();
  const modalBox = await editor.boundingBox();
  await editor.locator('.project-editor-recents summary').click();
  const recent = editor.locator('.project-recent-row').first(); await recent.waitFor();
  const path = recent.locator('.resource-path-trigger');
  await path.hover(); assert.equal(await page.locator('.resource-path-popup').count(), 0);
  await path.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show full path', exact: true }).click();
  await page.locator('.resource-path-popup:visible').waitFor();
  const fullPath = await page.locator('.resource-path-full').innerText();
  assert.ok((await path.innerText()).startsWith('…'));
  await page.locator('.resource-path-popup').getByRole('button', { name: 'Copy path', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureCopiedPath), fullPath);
  await page.keyboard.press('Escape'); assert.ok(await editor.isVisible());
  await page.locator('.resource-path-popup').waitFor({ state: 'detached' });
  await path.press('Shift+F10');
  const explorer = page.getByRole('menuitem', { name: 'Open in Explorer', exact: true });
  await page.waitForFunction(() => [...document.querySelectorAll('[role="menuitem"]')].some(el => el.textContent.includes('Open in Explorer') && el.getAttribute('aria-disabled') !== 'true'));
  await explorer.click(); assert.deepEqual(opened, [fullPath]);
  await path.click({ button: 'right' }); await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'detached' }); assert.ok(await editor.isVisible());
  for (const folder of ['frontend', 'backend']) {
    await editor.getByRole('textbox', { name: 'Folder path', exact: true }).fill(join(project, folder));
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.locator('.project-editor-folder').filter({ hasText: folder }).waitFor();
  }
  const folders = editor.locator('.project-editor-folder');
  assert.equal(await folders.first().locator('input').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', '名称正常显示无输入框底色');
  const firstFolderHeight = (await folders.first().boundingBox()).height;
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await folders.first().dispatchEvent('dragstart', { dataTransfer: transfer });
  await folders.first().locator('.project-folder-drag-name').waitFor();
  assert.equal(await folders.first().locator('input').evaluate(el => getComputedStyle(el).visibility), 'hidden', '拖动时不绘制名称输入框');
  assert.equal(await folders.first().locator('.project-folder-drag-name').innerText(), 'frontend');
  assert.equal((await folders.first().boundingBox()).height, firstFolderHeight, '拖动名称占位保持行高');
  assert.equal(await page.locator('.project-folder-drag-preview input,.project-folder-drag-preview button').count(), 0);
  await page.screenshot({ path: join(artifacts, `${name}-project-drag-name.png`) });
  await folders.first().dispatchEvent('dragend', { dataTransfer: transfer });
  await folders.first().locator('input').waitFor({ state: 'visible' });
  const dropHeight = (await folders.last().boundingBox()).height;
  await folders.first().dragTo(folders.last(), { sourcePosition: { x: 12, y: 20 }, targetPosition: { x: 16, y: dropHeight - 4 } });
  assert.equal(await folders.first().locator('input').inputValue(), 'backend');
  await folders.last().press('Alt+ArrowUp');
  assert.equal(await folders.first().locator('input').inputValue(), 'frontend');
  if (name === 'desktop') {
    const initialViewport = await page.evaluate(() => ({ width: innerWidth, ratio: devicePixelRatio }));
    for (const scale of [1, 1.25, 1.5]) {
      await desktop.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http')).webContents.setZoomFactor(value), scale);
      await page.waitForFunction(({ width, ratio, scale }) => Math.abs(innerWidth * scale - width) < 2 && Math.abs(devicePixelRatio - ratio * scale) < .02, { ...initialViewport, scale });
      await page.waitForFunction(() => Math.abs(document.querySelector('.project-editor-backdrop').getBoundingClientRect().top - document.querySelector('.workspace-titlebar').getBoundingClientRect().bottom) < 1);
      const chrome = await page.evaluate(() => ({ bar: document.querySelector('.workspace-titlebar').getBoundingClientRect().bottom, overlay: navigator.windowControlsOverlay?.getTitlebarAreaRect().height }));
      if (chrome.overlay) assert.ok(Math.abs(chrome.overlay - chrome.bar) <= 2);
      await page.screenshot({ path: join(artifacts, `${name}-project-titlebar-${scale}.png`), scale: 'css' });
    }
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('http')).webContents.setZoomFactor(1));
    await page.waitForFunction(width => Math.abs(innerWidth - width) < 2, initialViewport.width);
  } else assert.equal(await page.locator('.project-editor-backdrop').evaluate(el => el.getBoundingClientRect().top), 0, '浏览器遮罩仍覆盖页面');
  await folders.last().getByRole('button', { name: 'Set as default', exact: true }).click();
  let firstActionXs;
  for (let i = 0; i < 2; i++) {
    const buttons = folders.nth(i).locator('.project-folder-actions button');
    const boxes = await buttons.evaluateAll(elements => elements.map(el => { const box = el.getBoundingClientRect(); return { x: box.x, center: box.y + box.height / 2 }; }));
    assert.ok(boxes.every(box => Math.abs(box.center - boxes[0].center) < 1), '每行按钮处于同一水平线');
    if (i === 0) firstActionXs = boxes.map(box => box.x);
    else assert.deepEqual(boxes.map(box => box.x), firstActionXs, '不同默认状态不改变操作列位置');
  }
  await folders.first().locator('.resource-path-trigger').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show full path', exact: true }).click();
  assert.equal(await page.locator('.resource-path-full').innerText(), join(project, 'frontend'));
  await page.keyboard.press('Escape');
  await page.locator('.resource-path-popup').waitFor({ state: 'detached' });
  assert.deepEqual(await editor.boundingBox(), modalBox);
  await page.screenshot({ path: join(artifacts, `${name}-project-actions.png`) });
  await editor.getByRole('textbox', { name: 'Project name', exact: true }).fill('UI project');
  await editor.getByRole('button', { name: 'Create project', exact: true }).click();
  await editor.waitFor({ state: 'detached' });
  await page.locator('.new-session-project-selector:visible').click();
  await page.getByRole('menuitemradio').filter({ hasText: 'UI project' }).click();
  await page.waitForFunction(() => document.querySelector('.new-session-project-selector')?.textContent.includes('UI project'));
  assert.equal(await page.locator('.new-session-directory-selector').count(), 0, '多目录项目也不展示执行目录入口');
  await page.screenshot({ path: join(artifacts, `${name}-project-home.png`) });
  const saved = (await (await page.request.get(`${base}/api/projects`)).json()).state.projects.find(project => project.name === 'UI project');
  assert.equal(saved.folders.find(folder => folder.id === saved.defaultFolderId).name, 'backend', '隐藏入口不改变默认目录配置');
  assert.ok((await page.request.post(`${base}/api/projects`, { data: { action: 'remove', id: saved.id, revision: saved.revision } })).ok());
  console.log(`PASS ${name}: 删除区域查找、拖动纯文字、排序、弹窗标题栏适配及原有路径操作`);
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
