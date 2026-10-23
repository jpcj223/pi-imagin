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
import { checkTerminalTools } from "./terminal-tools.mjs";

// 私有会话和浏览器配置，不操作用户模型、会话或真实工作目录。
const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "请先停止同目录开发服务");
const artifacts = mkdtempSync(join(tmpdir(), "pi-terminal-workspace-"));
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
  const errors = [], created = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/terminal" && request.method() === "POST" && !created.includes(request.postDataJSON().id)) created.push(request.postDataJSON().id); });
  await page.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  await page.goto(`${base}/?session=${id}`);
  const scroll = page.locator(".chat-message-area > .scrollbar-subtle");
  await scroll.getByText("阅读位置 35：这是用于检查终端打开后消息是否被遮挡的测试消息。", { exact: true }).waitFor();
  const draft = page.locator(".chat-input-shell textarea"); await draft.fill("草稿保留");
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; }); await delay(150);
  const tail = async () => {
    await page.waitForFunction(() => { const el = document.querySelector(".chat-message-area > .scrollbar-subtle"); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 3; });
    const bounds = await page.locator(".chat-content").evaluate(el => {
      const scroller = el.querySelector(".chat-message-area > .scrollbar-subtle").getBoundingClientRect();
      const composer = el.querySelector(".chat-composer-region").getBoundingClientRect();
      return { end: scroller.bottom, input: composer.top, height: scroller.height };
    });
    assert.ok(bounds.end <= bounds.input + 1 && bounds.height > 80, JSON.stringify(bounds));
  };
  const dock = page.locator(".workspace-terminal");
  const statusLayout = await page.locator(".workspace-status").evaluate(el => {
    const button = el.querySelector("button").getBoundingClientRect(), bar = el.getBoundingClientRect();
    return { gap: bar.right - button.right, version: /Pi Imagin\s+\d/.test(el.textContent) };
  });
  assert.ok(statusLayout.gap <= 14); assert.equal(statusLayout.version, false);
  await page.locator(".workspace-status button").click();
  await dock.locator(".is-ready").waitFor(); await tail();
  const firstId = created[0]; assert.ok(firstId);
  const run = async command => { await dock.locator(".terminal-panel:visible .xterm-helper-textarea").focus(); await page.keyboard.type(command); await page.keyboard.press("Enter"); };
  const output = text => page.waitForFunction(text => [...document.querySelectorAll(".terminal-panel")].filter(el => el.offsetHeight).some(el => el.querySelector(".xterm-rows")?.textContent.includes(text)), text);
  await run(process.platform === "win32" ? "set PI_LAYOUT_ALIVE=retained" : "export PI_LAYOUT_ALIVE=retained");
  await run(process.platform === "win32" ? "echo INITIAL:%PI_LAYOUT_ALIVE%" : "echo INITIAL:$PI_LAYOUT_ALIVE"); await output("INITIAL:retained");
  await run(process.platform === "win32" ? "ping -t 127.0.0.1" : "sleep 30"); await delay(300);
  await page.keyboard.press("Control+C");
  await run(process.platform === "win32" ? "echo INTERRUPT:%PI_LAYOUT_ALIVE%" : "echo INTERRUPT:$PI_LAYOUT_ALIVE"); await output("INTERRUPT:retained");
  const before = await dock.boundingBox();
  const handle = dock.getByRole("separator", { name: "Resize terminal height" }); const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y - 85, { steps: 8 }); await page.mouse.up();
  const after = await dock.boundingBox(); assert.ok(after.height > before.height + 30); await tail();
  assert.ok(await page.evaluate(() => Number(localStorage.getItem("pi-terminal-height"))) > before.height);
  const historyTop = await scroll.evaluate(el => { el.scrollTop = Math.min(700, el.scrollHeight / 3); return el.scrollTop; }); await delay(150);
  await handle.press("ArrowDown"); await delay(100); assert.ok(Math.abs(await scroll.evaluate(el => el.scrollTop) - historyTop) < 2);
  const heightBeforeFull = (await dock.boundingBox()).height;
  await dock.getByRole("button", { name: "Expand terminal", exact: true }).click();
  assert.ok((await dock.boundingBox()).height > heightBeforeFull + 100);
  assert.equal(await page.locator(".workspace-workbench-row").isVisible(), false);
  await dock.getByRole("button", { name: "Restore terminal", exact: true }).click(); await delay(150);
  assert.ok(Math.abs((await dock.boundingBox()).height - heightBeforeFull) < 2);
  assert.ok(Math.abs(await scroll.evaluate(el => el.scrollTop) - historyTop) < 2);
  assert.equal(await draft.inputValue(), "草稿保留");
  await run(process.platform === "win32" ? "echo RESIZED:%PI_LAYOUT_ALIVE%" : "echo RESIZED:$PI_LAYOUT_ALIVE"); await output("RESIZED:retained");
  assert.equal(created.length, 1, "拖动、全屏不重建进程");
  // 真正的粘贴事件经 xterm 写入 PTY，检查中文与换行。
  await dock.locator(".xterm-helper-textarea").evaluate(el => {
    const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", "echo 中文测试\r");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }); await page.waitForFunction(() => [...document.querySelectorAll(".terminal-panel")].filter(el => el.offsetHeight).some(el => (el.querySelector(".xterm-rows")?.textContent.match(/中文测试/g) ?? []).length >= 2));
  await dock.getByRole("button", { name: "Find in terminal", exact: true }).click();
  await dock.getByRole("textbox", { name: "Find in terminal", exact: true }).fill("INITIAL:retained");
  await dock.getByRole("textbox", { name: "Find in terminal", exact: true }).press("Enter");
  await page.waitForFunction(() => /[1-9]\d*\/[1-9]\d*/.test(document.querySelector(".terminal-panel:has(.terminal-search) .terminal-search-count")?.textContent ?? ""));
  await dock.getByRole("textbox", { name: "Find in terminal", exact: true }).press("Escape");
  await dock.getByRole("button", { name: "Collapse terminal", exact: true }).click(); await delay(100);
  assert.ok(Math.abs(await scroll.evaluate(el => el.scrollTop) - historyTop) < 2);
  assert.equal(await draft.inputValue(), "草稿保留");
  await page.locator(".workspace-status button").click(); await dock.locator(".is-ready").waitFor();
  await run(process.platform === "win32" ? "echo COLLAPSE:%PI_LAYOUT_ALIVE%" : "echo COLLAPSE:$PI_LAYOUT_ALIVE"); await output("COLLAPSE:retained");
  assert.equal(created.length, 1);
  if (process.platform === "win32") {
    await dock.getByLabel("New terminal", { exact: true }).click();
    await page.getByRole("menuitem", { name: /^Windows PowerShell/ }).click(); await dock.locator(".is-ready").waitFor();
    await run("Write-Output ('POWERSHELL:' + $PID)"); await output("POWERSHELL:");
    assert.equal(created.length, 2);
    assert.equal(await page.evaluate(() => localStorage.getItem("pi-terminal-shell")), "powershell");
  }
  await checkTerminalTools(page, { base, project, capture: suffix => page.screenshot({ path: join(artifacts, `${name}-${suffix}.png`), animations: "disabled" }) });
  const createdBeforeReload = created.length;
  await page.reload(); await dock.locator(".is-ready").waitFor(); assert.equal(created.length, createdBeforeReload);
  await scroll.getByText("阅读位置 35：这是用于检查终端打开后消息是否被遮挡的测试消息。", { exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, `${name}-terminal.png`) });
  // 短窗口保留可阅读对话区，全屏还原后仍适配。
  if (name === "browser") {
    await page.setViewportSize({ width: 1100, height: 650 }); await delay(100);
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; }); await tail();
    await page.screenshot({ path: join(artifacts, `${name}-short.png`) });
    await page.setViewportSize({ width: 390, height: 844 }); await delay(150);
    await page.waitForFunction(() => {
      const backdrop = document.querySelector(".sidebar-overlay-backdrop");
      return !backdrop || (getComputedStyle(backdrop).opacity === "0" && getComputedStyle(backdrop).pointerEvents === "none");
    });
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; }); await tail();
    await dock.getByRole("button", { name: "Find in terminal", exact: true }).click();
    await dock.getByRole("textbox", { name: "Find in terminal", exact: true }).fill("2026"); await delay(150);
    const mobileSearch = await dock.locator(".terminal-search").evaluate(el => {
      const row = el.getBoundingClientRect(), nav = el.querySelector(".terminal-search-navigation").getBoundingClientRect();
      return { rowRight: row.right, navRight: nav.right, width: el.clientWidth, scrollWidth: el.scrollWidth };
    });
    assert.ok(mobileSearch.navRight <= mobileSearch.rowRight && mobileSearch.scrollWidth <= mobileSearch.width);
    await page.screenshot({ path: join(artifacts, `${name}-mobile.png`) });
    await dock.getByRole("textbox", { name: "Find in terminal", exact: true }).press("Escape");
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  for (const terminalId of created) await page.request.delete(`${base}/api/terminal/${terminalId}`);
  assert.deepEqual(errors, []);
  console.log(`PASS ${name}: 拖动/键盘调整、全屏还原、进程/草稿保留、中文粘贴、查找、Shell 选择、刷新恢复、消息底部和历史位置`);
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
    for (const zoom of [1, 1.25, 1.5]) {
      await desktop.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith("http")).webContents.setZoomFactor(zoom), zoom);
      await delay(300);
      const height = await page.locator(".workspace-titlebar").evaluate(el => el.getBoundingClientRect().height);
      const nativeHeight = await desktop.evaluate(() => globalThis.terminalOverlayChecks.at(-1));
      assert.equal(nativeHeight, Math.round(height * zoom) - 1);
    }
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith("http")).webContents.setZoomFactor(1));
    await page.screenshot({ path: join(artifacts, "desktop-titlebar.png"), clip: { x: 0, y: 0, width: 1400, height: 42 } });
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
