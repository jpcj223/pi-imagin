import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, openSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, _electron } from "playwright";
import { createJiti } from "jiti";
const { getLocalePlugin } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

// 私有会话和浏览器配置，不操作用户模型、会话或真实工作目录。
const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "请先停止同目录开发服务");
const artifacts = mkdtempSync(join(tmpdir(), "pi-workspace-i18n-"));
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
  const errors = [], missing = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.text().includes("[i18n] Missing translation")) missing.push(message.text()); });
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem("pi-locale", "en"); });
  await page.goto(`${base}/?session=${id}`);
  const chat = page.locator(".chat-message-area > .scrollbar-subtle");
  await chat.getByText("阅读位置 35：这是用于检查终端打开后消息是否被遮挡的测试消息。", { exact: true }).waitFor();
  const draft = page.locator(".chat-input-shell textarea"); await draft.fill("保留草稿 / Keep this draft");
  const settings = page.locator(".settings-workspace-page:not(.plugins-workspace-page)");
  const rail = page.locator(".workspace-rail"), aux = page.locator(".workspace-aux-tabs");
  await aux.hover(); await aux.locator('[data-aux-tab="history"]').click();
  const frame = page.frameLocator(".workspace-history iframe");
  await frame.locator("#tree-search").waitFor();
  const capture = suffix => page.screenshot({ path: join(artifacts, `${name}-${suffix}.png`), animations: "disabled" });
  let first = true;
  for (const locale of ["en", "zh-TW", "zh-CN", "en"]) {
    const messages = getLocalePlugin(locale).messages, t = key => messages[key];
    await frame.locator("#content").evaluate(el => { el.scrollTop = 160; window.historyLanguageProbe = "keep this document"; });
    const originalFrame = await page.locator(".workspace-history iframe").elementHandle();
    await page.locator(".workspace-rail-settings").click();
    await settings.locator(".settings-section-tabs button").first().click();
    await settings.locator(".settings-language-option").filter({ hasText: getLocalePlugin(locale).label }).click();
    await page.waitForFunction(locale => document.documentElement.lang === locale, locale);
    assert.equal(await settings.locator(".settings-dialog-header").innerText(), t("settings.title"));
    assert.equal(await settings.getByRole("button", { name: t("settings.general"), exact: true }).count(), 1);
    if (locale !== "en" || first) await capture(`settings-${locale}`);
    await page.keyboard.press("Escape"); await settings.waitFor({ state: "hidden" });
    assert.equal(await rail.getByRole("button", { name: t("workspace.home"), exact: true }).count(), 1);
    assert.equal(await rail.getAttribute("aria-label"), t("workspace.navigation"));
    assert.equal(await page.locator(".sidebar-new-label").innerText(), t("i18n.newSession"));
    assert.equal(await page.locator(".workspace-project-heading > span").innerText(), t("sidebar.projects"));
    assert.equal(await page.locator(".workspace-status-ready").innerText(), t("workspace.localWorkspace"));
    assert.equal(await page.locator(".session-tree-time-group").first().getByRole("button").innerText().then(value => value.includes(t("sidebar.today"))), true);
    await frame.locator("#tree-search").getAttribute("placeholder").then(value => assert.equal(value, t("history.search")));
    assert.equal(await frame.locator("body").evaluate(() => window.historyLanguageProbe), "keep this document");
    assert.equal(await originalFrame.evaluate(el => el.isConnected), true);
    assert.ok(await frame.locator("#content").evaluate(el => el.scrollTop) > 0, "语言切换不重置历史阅读位置");
    await aux.hover();
    for (const [tab,key] of [["outline","workspace.outline"],["files","sidebar.tabFiles"],["history","history.full"],["system","system.label"],["tools","tools.label"],["session","session.info"]]) {
      assert.equal(await aux.locator(`[data-aux-tab="${tab}"]`).innerText(), t(key));
      assert.equal(await aux.locator(`[data-aux-tab="${tab}"]`).getAttribute("title"), t("workspace.tabReorderHint").replace("{label}", t(key)));
    }
    await aux.locator('[data-aux-tab="outline"]').click();
    await rail.locator('[data-rail-item="search"]').click();
    const search = page.locator(".workspace-search-dialog");
    await search.locator("input").fill("");
    assert.equal(await search.getByRole("heading").innerText(), t("search.title"));
    assert.equal(await search.locator("input").getAttribute("placeholder"), t("search.placeholder"));
    assert.equal(await search.locator(".workspace-search-empty").innerText(), t("search.empty"));
    if (locale !== "en" || first) await capture(`search-${locale}`);
    await page.route("**/api/sessions/search?**", route => route.fulfill({ status: 503, json: { error: "fixture error" } }));
    await search.locator("input").fill("fixture"); await search.getByRole("button", { name: t("search.retry"), exact: true }).waitFor();
    await page.unroute("**/api/sessions/search?**");
    await search.getByRole("button", { name: t("search.close"), exact: true }).click();
    await page.locator(".workspace-project-heading button").click();
    const editor = page.locator(".project-editor");
    assert.equal(await editor.getByRole("heading").innerText(), t("project.create"));
    await editor.getByRole("textbox", { name: t("sidebar.projectName"), exact: true }).fill("用户项目 / User project");
    if (locale !== "en" || first) await capture(`project-${locale}`);
    await editor.getByRole("button", { name: t("project.close"), exact: true }).click();
    if (first) {
      await page.locator(".workspace-status-terminal").click(); await page.locator(".workspace-terminal .is-ready").waitFor();
    }
    assert.equal(await page.locator(".workspace-status-terminal").innerText(), t("terminal.collapse"));
    await page.locator(".workspace-terminal").getByRole("button", { name: t("terminal.new"), exact: true }).click();
    await page.getByRole("menuitem", { name: t("terminal.addShell"), exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await draft.inputValue(), "保留草稿 / Keep this draft");
    // 再回完整历史，沿用同一元素及滚动，供下一轮设置语言切换验证。
    await aux.hover(); await aux.locator('[data-aux-tab="history"]').click();
    first = false;
  }
  await page.reload(); await chat.getByText("阅读位置 35：这是用于检查终端打开后消息是否被遮挡的测试消息。", { exact: true }).waitFor();
  assert.equal(await page.locator(".workspace-status-ready").innerText(), "Local workspace");
  if (name === "browser") {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => { const el = document.querySelector(".sidebar-overlay-backdrop"); return !el || getComputedStyle(el).pointerEvents === "none"; });
    await capture("mobile-en");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  assert.deepEqual(errors, []); assert.deepEqual(missing, []);
  console.log(`PASS ${name}: 三种语言实时切换、侧栏/搜索/项目/辅助标签/历史/终端/状态栏、历史与草稿保留、刷新记忆`);
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
