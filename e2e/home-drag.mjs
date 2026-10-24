import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync, openSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(!existsSync(join(root, ".next/dev/lock")), "不得重复启动同目录服务");
const artifacts = mkdtempSync(join(root, "output/playwright/home-drag-"));
const agent = join(artifacts, "agent"), project = join(artifacts, "project-a"), other = join(artifacts, "project-b");
for (const folder of [join(agent, "sessions/test"), project, other]) mkdirSync(folder, { recursive: true });
writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: "https://example.invalid/v1", api: "openai-completions", apiKey: "test", models: [{ id: "test" }] } } }));
writeFileSync(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "test", enabledModels: ["fixture/test"] }));
const timestamp = "2026-10-24T00:00:00.000Z";
writeFileSync(join(agent, "sessions/test/home-drag.jsonl"), [
  { type: "session", version: 3, id: "home-drag", timestamp, cwd: project },
  { type: "message", id: "m0", parentId: null, timestamp, message: { role: "user", content: "Home drag fixture" } },
].map(entry => JSON.stringify(entry)).join("\n") + "\n");
const probe = createServer().listen(0, "127.0.0.1"); await once(probe, "listening");
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: "1", PI_WEB_PASSWORD: "", PI_WEB_NO_OPEN: "1" }, stdio: ["ignore", openSync(join(artifacts, "server.log"), "w"), "pipe"], windowsHide: true });
server.stderr.on("data", chunk => process.stderr.write(chunk));
let browser, page;
try {
  for (let i = 0; ; i++) { if ((await fetch(`${base}/api/home`).catch(() => null))?.ok) break; assert.ok(i < 120 && server.exitCode === null); await delay(500); }
  browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
  const name = "真实测试 1019 DeepSeek 很长的主页项目名称";
  for (const [name, path] of [["另一个项目", other], ["真实测试 1019 DeepSeek 很长的主页项目名称", project]]) {
    const response = await page.request.post(`${base}/api/projects`, { data: { action: "save", name, folders: [{ path }], defaultPath: path } });
    assert.equal(response.status(), 200, await response.text());
  }
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?session=home-drag`);
  await page.locator(".chat-message-area").getByText("Home drag fixture", { exact: true }).waitFor();
  page.setDefaultTimeout(10000);
  const groups = page.locator(".workspace-project-tree .session-tree-group");
  const source = groups.filter({ hasText: name }), target = groups.filter({ hasText: "另一个项目" });
  await source.waitFor(); await target.waitFor();
  const before = await groups.evaluateAll(nodes => nodes.map(node => node.dataset.rowKey));
  const expanded = await source.locator(".session-tree-group-toggle").getAttribute("aria-expanded");
  let pointerY;
  const pickup = async () => {
    const box = await source.boundingBox();
    await page.mouse.move(box.x + 60, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + 62, box.y + box.height / 2 + 6, { steps: 3 });
    await page.locator(".session-tree-drag-ghost").waitFor();
    pointerY = box.y + box.height / 2 + 6;
    return box;
  };
  const traces = [];
  const traceTo = async end => {
    let previous = await page.locator(".session-tree-drag-ghost").boundingBox();
    while (Math.abs(end - pointerY) > .01) {
      const next = pointerY + Math.sign(end - pointerY) * Math.min(2, Math.abs(end - pointerY));
      await page.mouse.move(100, next);
      const box = await page.locator(".session-tree-drag-ghost").boundingBox();
      traces.push({ pointerY: next, top: box.y });
      assert.ok(Math.abs(box.y - previous.y) <= Math.abs(next - pointerY) + .5, `跨落点突然跳变：指针 ${pointerY}→${next}，预览 ${previous.y}→${box.y}`);
      pointerY = next; previous = box;
    }
  };
  const box = await pickup();
  const metrics = await page.locator(".session-tree-drag-ghost").evaluate(node => {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect(), tree = node.closest(".session-tree").getBoundingClientRect();
    return { opacity: style.opacity, height: rect.height, width: rect.width, inside: rect.left >= tree.left && rect.right <= tree.right, icons: node.querySelectorAll("svg").length };
  });
  assert.equal(metrics.opacity, "1"); assert.equal(metrics.height, 34); assert.ok(metrics.inside); assert.equal(metrics.icons, 1);
  assert.ok(metrics.width > box.width * .8 && metrics.width <= box.width);
  assert.equal(await source.locator(".session-tree-group-toggle").evaluate(node => getComputedStyle(node).visibility), "hidden");
  assert.equal((await source.boundingBox()).height, box.height, "占位不改变行高");
  await page.screenshot({ path: join(artifacts, "drag-start.png") });
  await page.keyboard.press("Escape"); await page.mouse.up();
  await page.locator(".session-tree-drag-ghost").waitFor({ state: "detached" });
  assert.deepEqual(await groups.evaluateAll(nodes => nodes.map(node => node.dataset.rowKey)), before);
  assert.equal(await source.locator(".session-tree-group-toggle").evaluate(node => getComputedStyle(node).visibility), "visible");
  assert.equal(await source.locator(".session-tree-group-toggle").getAttribute("aria-expanded"), expanded);
  await pickup();
  const destination = await target.boundingBox();
  const sourceFirst = before[0] === await source.getAttribute("data-row-key");
  await traceTo(destination.y + (sourceFirst ? destination.height - 2 : 2));
  await page.screenshot({ path: join(artifacts, "drag-target.png") });
  await page.mouse.up();
  await page.locator(".session-tree-drag-ghost").waitFor({ state: "detached" });
  await page.waitForFunction(keys => JSON.stringify(Array.from(document.querySelectorAll(".workspace-project-tree .session-tree-group"), node => node.dataset.rowKey)) !== JSON.stringify(keys), before);
  assert.equal(await source.locator(".session-tree-group-toggle").getAttribute("aria-expanded"), expanded, "拖动释放不能误触折叠");
  assert.ok(page.url().includes("home-drag"));
  await page.screenshot({ path: join(artifacts, "drop.png") });
  // 排序后反向拖回，逐次采样，不只核对释放后的最终顺序。
  const after = await groups.evaluateAll(nodes => nodes.map(node => node.dataset.rowKey));
  await pickup();
  const reverse = await target.boundingBox();
  const nowFirst = after[0] === await source.getAttribute("data-row-key");
  await traceTo(reverse.y + (nowFirst ? reverse.height - 2 : 2));
  await page.screenshot({ path: join(artifacts, "reverse-drag.png") });
  await page.mouse.up();
  await page.waitForFunction(keys => JSON.stringify(Array.from(document.querySelectorAll(".workspace-project-tree .session-tree-group"), node => node.dataset.rowKey)) === JSON.stringify(keys), before);
  writeFileSync(join(artifacts, "pointer-trace.json"), JSON.stringify(traces, null, 2));
  assert.deepEqual(errors, []);
  console.log(`PASS 正反排序逐点跟随无跳变、预览与占位、Escape取消、释放不误触；${artifacts}`);
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: join(artifacts, "failure.png") }); writeFileSync(join(artifacts, "failure.txt"), await page.locator("body").innerText()); }
  console.error(`Artifacts: ${artifacts}`); throw error;
} finally { await browser?.close(); server.kill(); }
