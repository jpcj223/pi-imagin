import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, openSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "复用现有服务或先停止同目录服务");
const artifacts = mkdtempSync(join(root, "output/playwright/resource-trust-"));
const agent = join(artifacts, "agent"), workspaces = join(artifacts, "workspaces"), other = join(artifacts, "other");
mkdirSync(join(agent, "sessions/test"), { recursive: true });
mkdirSync(join(agent, "skills/shared"), { recursive: true });
writeFileSync(join(agent, "skills/shared/SKILL.md"), "---\nname: shared\ndescription: Public skill\n---\n# Shared instructions\n");
writeFileSync(join(agent, "skills-lock.json"), JSON.stringify({ version: 1, skills: { shared: { source: "fixture/catalog", sourceType: "github", piImaginInstalled: true } } }));
writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: "https://example.invalid/v1", api: "openai-completions", apiKey: "test", models: [{ id: "test" }] } } }));
writeFileSync(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "test", enabledModels: ["fixture/test"] }));
const folders = [join(workspaces, "20261024"), join(workspaces, "20261025"), other];
if (process.env.RESOURCE_SIDEBAR_ONLY) folders.push(join(artifacts, "history/default"), join(artifacts, "old/default"), join(artifacts, "switch"));
for (const [i, cwd] of folders.entries()) {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi/settings.json"), "{}");
  if (i < 2) { mkdirSync(join(cwd, ".pi/skills/shared"), { recursive: true }); writeFileSync(join(cwd, ".pi/skills/shared/SKILL.md"), "---\nname: shared\ndescription: Stale daily copy\n---\nOld instructions"); }
  const id = `resource-trust-${i}`, timestamp = "2026-10-24T00:00:00.000Z";
  writeFileSync(join(agent, `sessions/test/${id}.jsonl`), [
    { type: "session", version: 3, id, timestamp, cwd },
    { type: "message", id: "m0", parentId: null, timestamp, message: { role: "user", content: "Resource trust fixture" } },
  ].map(value => JSON.stringify(value)).join("\n") + "\n");
}
const probe = createServer().listen(0, "127.0.0.1"); await once(probe, "listening");
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_IMAGIN_DESKTOP_DEV: "1", PI_IMAGIN_DESKTOP_DEV_WORKSPACE: workspaces, PI_OFFLINE: "1", PI_WEB_PASSWORD: "", PI_WEB_NO_OPEN: "1" }, stdio: ["ignore", openSync(join(artifacts, "server.log"), "w"), "pipe"], windowsHide: true });
server.stderr.on("data", value => process.stderr.write(value));
let browser, page;
try {
  for (let i = 0; ; i++) { if ((await fetch(`${base}/api/home`).catch(() => null))?.ok) break; assert.ok(i < 120 && server.exitCode === null); await delay(500); }
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.route("**/api/plugins/search?*", route => route.fulfill({ json: { items: [{ name: "public-plugin", source: "npm:public-plugin", description: "Fixture local plugin", types: ["extension"], url: "https://example.invalid/plugin" }, { name: "project-plugin", source: "npm:project-plugin", description: "Project install fixture", types: ["extension"], url: "https://example.invalid/project-plugin" }], page: 1, total: 2, hasNext: false } }));
  await page.route("**/api/skills/catalog?*", route => route.fulfill({ json: { items: [{ name: "example-skill", source: "fixture/catalog", slug: "example-skill", package: "fixture/catalog@example-skill", installs: 100, official: false, url: "https://skills.sh/fixture/catalog/example-skill" }], page: 0, total: 1, hasNext: false, searchLimited: false } }));
  const savedProject = await page.request.post(`${base}/api/projects`, { data: { action: "save", name: "安装测试项目", folders: [{ path: other }], defaultPath: other } });
  assert.equal(savedProject.status(), 200, await savedProject.text());
  // 默认区安装沿用真实插件 API，以本地测试包验证公共安装记录，不访问网络。
  const pkg = join(artifacts, "public-plugin"); mkdirSync(pkg);
  const projectPkg = join(artifacts, "project-plugin"); mkdirSync(projectPkg);
  writeFileSync(join(projectPkg, "package.json"), JSON.stringify({ name: "project-plugin", version: "1.0.0", pi: { extensions: ["index.js"] } }));
  writeFileSync(join(projectPkg, "index.js"), "export default () => {};\n");
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "public-plugin", version: "1.0.0", pi: { extensions: ["index.js"] } }));
  writeFileSync(join(pkg, "index.js"), "export default () => {};\n");
  let pluginBody;
  await page.route(/\/api\/plugins$/, route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().action === 'install') {
      pluginBody = route.request().postDataJSON();
      return route.continue({ postData: JSON.stringify({ ...pluginBody, source: pluginBody.source === "npm:project-plugin" ? projectPkg : pkg }) });
    }
    return route.continue();
  });
  await page.route('**/api/plugins/detail?*', route => route.fulfill({ json: { name: 'public-plugin', description: 'Fixture plugin', partial: false } }));
  await page.route('**/api/plugins/logos?*', route => route.fulfill({ json: {} }));
  if (!process.env.RESOURCE_SWITCH_ONLY && !process.env.RESOURCE_SIDEBAR_ONLY && !process.env.AGENTS_UI_ONLY && !process.env.MCP_UI_ONLY) for (const [i, cwd] of folders.entries()) {
    await page.goto(`${base}/?session=resource-trust-${i}`);
    await page.locator(".chat-message-area").getByText("Resource trust fixture", { exact: true }).waitFor();
    const status = await (await page.request.get(`${base}/api/project-trust?cwd=${encodeURIComponent(cwd)}`)).json();
    assert.equal(status.trusted, i < 2);
    if (i === 0) {
      const response = await page.request.post(`${base}/api/plugins`, { data: { action: "install", source: pkg, scope: "global", cwd } });
      assert.equal(response.status(), 200, await response.text());
    }
    if (i < 2) assert.equal(status.defaultWorkspace, true);
    else await page.locator(".project-trust-badge:visible").waitFor();
    await page.locator(".workspace-rail-skills").click();
    await page.locator('.settings-section-host[data-settings-section="skills"] .skills-installed-search input').waitFor();
    await page.locator('.settings-section-host[data-settings-section="skills"]').getByText("shared", { exact: true }).waitFor();
    await page.locator(".skills-catalog-card").first().waitFor();
    const actualSkills = await (await page.request.get(`${base}/api/skills${i < 2 ? `?cwd=${encodeURIComponent(cwd)}` : ''}`)).json();
    assert.equal(actualSkills.skills.find(skill => skill.name === 'shared').filePath, join(agent, 'skills/shared/SKILL.md'));
    assert.equal(actualSkills.skills.find(skill => skill.name === 'shared').sourceInfo.scope, 'user');
    assert.equal(await page.locator(".project-trust-badge:visible").count(), 0, '全局目标不跟随当前会话的项目授权状态');
    assert.equal(await page.locator('.skills-catalog-options [data-resource-install-global]').getAttribute('aria-pressed'), "true");
    await page.screenshot({ path: join(artifacts, `skills-${i}.png`) });
    await page.locator(".workspace-rail-plugins").click();
    await page.locator('.plugins-list-header input').waitFor();
    await page.locator('.plugins-workspace-page .config-sidebar-list').getByText("public-plugin", { exact: true }).waitFor();
    assert.equal(await page.locator(".project-trust-badge:visible").count(), 0);
    assert.equal(await page.locator('.plugins-catalog-options [data-resource-install-global]').getAttribute('aria-pressed'), "true");
    await page.screenshot({ path: join(artifacts, `plugins-${i}.png`) });
    if (i === 0) {
      await page.route('**/api/cwd/validate', async route => { await delay(400); await route.continue(); });
      await page.locator('.plugins-catalog-options [data-resource-install-target]').click();
      await page.getByRole('menuitemradio', { name: '安装测试项目', exact: true }).click();
      assert.equal(await page.locator('.plugins-catalog-options [data-resource-install-target]').isDisabled(), true, '目录校验期间禁止误用旧目标安装');
      await page.locator('.settings-dialog-header .project-trust-badge:visible').waitFor();
      await page.unroute('**/api/cwd/validate');
      assert.ok(page.url().includes('resource-trust-0'), '安装选择不切换当前会话');
      await page.locator('.workspace-rail-skills').click();
      assert.equal(await page.locator('.skills-catalog-options [data-resource-install-global]').getAttribute('aria-pressed'), 'true', '技能不继承插件的项目选择');
      await page.locator('.skills-catalog-options [data-resource-install-target]').click();
      await page.getByRole('menuitemradio', { name: '安装测试项目', exact: true }).click();
      await page.locator('.skills-catalog-options .resource-install-project-name').getByText('安装测试项目', { exact: true }).waitFor();
      await page.locator('.skills-catalog-card').first().getByRole('button', { name: '安装', exact: true }).waitFor();
      assert.equal(await page.locator('.skills-catalog-card').first().getByRole('button', { name: '安装', exact: true }).isDisabled(), true, '未信任项目不能安装');
      await page.locator('.settings-dialog-header .project-trust-badge:visible').click();
      await page.getByRole('dialog').getByRole('button', { name: '信任项目', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !document.querySelector('.skills-catalog-card button:last-child')?.disabled);
      let skillBody;
      await page.route('**/api/skills/install', async route => { skillBody = route.request().postDataJSON(); await route.fulfill({ json: { success: true } }); });
      await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/skills/install')), page.locator('.skills-catalog-card').first().getByRole('button', { name: '安装', exact: true }).click()]);
      assert.equal(skillBody.scope, 'project'); assert.equal(skillBody.cwd, other);
      await page.unroute('**/api/skills/install');
      await page.locator('.workspace-rail-plugins').click();
      const globalPlugin = page.locator('.plugin-card').filter({ has: page.getByRole('button', { name: 'public-plugin', exact: true }) });
      assert.equal(await globalPlugin.getByRole('button', { name: '已安装', exact: true }).isDisabled(), true, '项目继承全局插件已安装状态');
      const projectPlugin = page.locator('.plugin-card').filter({ has: page.getByRole('button', { name: 'project-plugin', exact: true }) });
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/api/plugins') && response.request().method() === 'POST'),
        projectPlugin.getByRole('button', { name: '安装', exact: true }).click(),
      ]);
      assert.equal(pluginBody.scope, 'project'); assert.equal(pluginBody.cwd, other);
      const projectSettings = JSON.parse(await (await import('node:fs/promises')).readFile(join(other, '.pi/settings.json'), 'utf8'));
      assert.ok(projectSettings.packages.some(entry => resolve(other, '.pi', typeof entry === 'string' ? entry : entry.source) === projectPkg), '插件实际安装到所选项目');
      await page.locator('.workspace-rail-skills').click();
      await page.screenshot({ path: join(artifacts, 'selected-project.png') });
      await page.locator('.skills-catalog-options [data-resource-install-global]').click();
      assert.equal(await page.locator('.skills-catalog-options [data-resource-install-global]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.project-trust-badge:visible').count(), 0);
      // 留给后续页面验证的项目仍保持未授权状态，确认测试不修改默认授权逻辑。
      new ProjectTrustStore(agent).set(other, null);
    }
  }

  if (process.env.RESOURCE_SWITCH_ONLY || process.env.RESOURCE_SIDEBAR_ONLY || process.env.AGENTS_UI_ONLY || process.env.MCP_UI_ONLY) await page.goto(`${base}/?session=resource-trust-2`);
  if (process.env.RESOURCE_SWITCH_ONLY) await (await import("./resource-switching.mjs")).checkResourceSwitching(page, base, artifacts, other);
  else if (!process.env.RESOURCE_TRUST_ONLY && !process.env.AGENTS_UI_ONLY && !process.env.MCP_UI_ONLY) await (await import("./resource-sidebar-checks.mjs")).checkResourceSidebars(page, base, artifacts, other);
  if (process.env.MCP_UI_ONLY) await (await import("./mcp-config.mjs")).checkMcpConfig(page, base, artifacts);
  else if (process.env.AGENTS_UI_ONLY) await (await import("./agents-config.mjs")).checkAgentsConfig(page, base, artifacts);
  assert.deepEqual(errors, []);
  console.log(`${process.env.RESOURCE_SWITCH_ONLY ? "PASS 四页项目切换检查" : process.env.MCP_UI_ONLY ? "PASS MCP 添加和范围检查" : process.env.AGENTS_UI_ONLY ? "PASS 子代理页面检查" : process.env.RESOURCE_SIDEBAR_ONLY ? "PASS 本轮资源侧栏检查" : "PASS 默认工作区无授权、公共插件安装和技能跨日期使用、其他项目受限、三个页面状态入口"}；${artifacts}`);
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: join(artifacts, 'failure.png') }); writeFileSync(join(artifacts, 'failure.txt'), await page.locator('body').innerText()); }
  console.error(`Artifacts: ${artifacts}`); throw error;
} finally {
  await browser?.close();
  server.kill();
}
