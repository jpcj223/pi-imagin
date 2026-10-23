import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function checkTerminalTools(page, { base, project, capture }) {
  const dock = page.locator(".workspace-terminal");
  const activePanel = dock.locator(".terminal-panel:visible");
  const activeId = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs")).activeId);
  const run = async command => {
    const textarea = activePanel.locator(".xterm-helper-textarea"); await textarea.focus();
    await textarea.evaluate((el, command) => { const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", command); el.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true })); }, command);
    await page.keyboard.press("Enter");
  };
  const originalId = await activeId();
  const metadata = async id => (await page.request.get(`${base}/api/terminal/${id}`)).json();
  const shellMenu = () => dock.getByRole("button", { name: "New terminal", exact: true });
  const more = () => dock.getByRole("button", { name: "Terminal actions", exact: true });
  const openedMenu = () => page.getByRole("menu");
  const captureMenu = async name => {
    await openedMenu().evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))); });
    await capture(name);
    assert.equal(await openedMenu().count(), 1);
  };
  await shellMenu().click(); assert.equal(await openedMenu().count(), 1);
  const addItem = openedMenu().getByRole("menuitem", { name: "Add other terminals", exact: true });
  const mainItems = await openedMenu().getByRole("menuitem").allTextContents();
  assert.equal(mainItems.at(-1).trim(), "Add other terminals", "添加入口单独放在列表底部");
  await addItem.click();
  await captureMenu("terminal-add-shell");
  await openedMenu().getByRole("menuitem", { name: "Refresh terminal list", exact: true }).click();
  await openedMenu().getByRole("menuitem", { name: "Refresh terminal list", exact: true }).waitFor();
  const availableShells = await (await page.request.get(`${base}/api/terminal`)).json();
  if (availableShells.shells.some(shell => shell.id === "gitbash")) {
    const createdBefore = await activeId();
    await openedMenu().getByRole("menuitem", { name: "Git Bash", exact: true }).click();
    assert.equal(await activeId(), createdBefore, "添加类型不立即新建进程");
    assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem("pi-terminal-added-shells")))).includes("gitbash"));
    await openedMenu().getByRole("menuitem", { name: "Git Bash", exact: true }).click();
    await dock.locator(".is-ready").waitFor();
    const gitId = await activeId(); assert.notEqual(gitId, createdBefore);
    assert.equal((await metadata(gitId)).shellId, "gitbash");
    await run("echo GIT_READY:$BASH_VERSION");
    await page.waitForFunction(() => [...document.querySelectorAll(".terminal-panel")].filter(el => el.offsetHeight).some(el => /GIT_READY:\d+/.test(el.querySelector(".xterm-rows")?.textContent ?? "")));
    await dock.locator('.workspace-file-tab[aria-selected="true"] .file-tab-close').click();
    await page.waitForFunction(id => JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs")).activeId === id, createdBefore);
    await dock.locator(".is-ready").waitFor();
    // 恢复原选择偏好，让后续复制与持久化回归仍基于当前 PowerShell。
    await page.evaluate(() => { localStorage.setItem("pi-terminal-shell", "powershell"); window.dispatchEvent(new Event("storage")); });
  } else {
    await page.keyboard.press("Escape");
  }
  await shellMenu().click();
  await captureMenu("terminal-shell-menu");
  assert.equal(await openedMenu().getByText("Use preferred shell", { exact: true }).count(), 0);
  assert.equal(await shellMenu().innerText(), "", "外面只显示下拉图标");
  await more().click(); assert.equal(await openedMenu().count(), 1);
  await captureMenu("terminal-more-menu");
  assert.equal(await openedMenu().getByRole("menuitem", { name: "Duplicate terminal", exact: true }).count(), 1);
  await page.keyboard.press("Escape"); assert.equal(await openedMenu().count(), 0);
  assert.equal(await more().evaluate(el => document.activeElement === el), true);
  await shellMenu().click(); await activePanel.locator(".terminal-xterm").click(); assert.equal(await openedMenu().count(), 0);
  await more().click(); await dock.getByRole("button", { name: "Expand terminal", exact: true }).click(); assert.equal(await openedMenu().count(), 0);
  await dock.getByRole("button", { name: "Restore terminal", exact: true }).click();

  if (process.platform === "win32") {
    const child = join(project, "子目录 %20"); mkdirSync(child, { recursive: true });
    const tabs = await page.evaluate(() => JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs")).tabs);
    const cmd = tabs.find(tab => tab.id !== originalId);
    if (cmd && (await metadata(cmd.id)).shellId === "cmd") {
      await page.request.post(`${base}/api/terminal/${cmd.id}`, { data: { type: "input", data: `cd /d "${child}"\r` } });
      for (let i = 0; ; i++) { if ((await metadata(cmd.id)).currentCwd === child) break; assert.ok(i < 60, "CMD 目录应跟随 cd"); await delay(100); }
    }
    await run(`Set-Location -LiteralPath '${child.replaceAll("'", "''")}'`);
    for (let i = 0; ; i++) { if ((await metadata(originalId)).currentCwd === child) break; assert.ok(i < 60, "PowerShell 目录应跟随 cd"); await delay(100); }
    await more().click(); await openedMenu().getByRole("menuitem", { name: "Duplicate terminal", exact: true }).click();
    await page.waitForFunction(old => JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs")).activeId !== old, originalId);
    await dock.locator(".is-ready").waitFor();
    const copiedId = await activeId(), copied = await metadata(copiedId), original = await metadata(originalId);
    assert.equal(copied.shellId, original.shellId); assert.equal(copied.cwd, child);
    assert.equal(await openedMenu().count(), 0);
    // 复制没有终止原进程，且只新建一个选中的标签。
    assert.equal((await page.request.get(`${base}/api/terminal/${originalId}`)).status(), 200);
    await dock.locator('.workspace-file-tab[aria-selected="true"] .file-tab-close').click();
    await page.waitForFunction(old => JSON.parse(sessionStorage.getItem("pi-web:terminal-tabs")).activeId === old, originalId);
    await dock.locator(".is-ready").waitFor();

    // 输出 ANSI 基础色与亮色，之后切换应用主题检查真实重绘，不重建 PTY。
    await run('[Console]::WriteLine("$([char]27)[93mYELLOW_DEMO$([char]27)[0m $([char]27)[92mGREEN_DEMO$([char]27)[0m")');
    await page.waitForFunction(() => [...document.querySelectorAll(".terminal-panel")].filter(el => el.offsetHeight).some(el => el.querySelector(".xterm-rows")?.textContent.includes("GREEN_DEMO")));
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const theme of ["mist", "rose", "dark", "pine", "light"]) {
      await page.locator(".workspace-rail-settings").click();
      await page.locator(`.settings-general input[name="theme"][value="${theme}"]`).evaluate(el => el.click());
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme && !document.documentElement.dataset.themeTransition, theme);
      await page.keyboard.press("Escape");
      await dock.locator(".is-ready").waitFor();
      assert.equal(await activeId(), originalId);
      await capture(`terminal-${theme}`);
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // 先清除输入回显和历史，再输出确定内容，精确校验每种搜索的命中数量。
    await run('[Console]::Write(([char]27) + "[2J" + ([char]27) + "[3J" + ([char]27) + "[HNeedle needle needless NEEDLE`r`n中文测试 中文测试`r`n")');
    await page.waitForFunction(() => [...document.querySelectorAll(".terminal-panel")].filter(el => el.offsetHeight).some(el => el.querySelector(".xterm-rows")?.textContent.startsWith("Needle needle needless NEEDLE")));
    await dock.getByRole("button", { name: "Find in terminal", exact: true }).click();
    const geometry = await activePanel.locator(".terminal-search").evaluate(el => {
      const field = el.querySelector(".terminal-search-field").getBoundingClientRect();
      const nav = el.querySelector(".terminal-search-navigation").getBoundingClientRect();
      const row = el.getBoundingClientRect();
      return { width: field.width, height: row.height, right: row.right - nav.right, left: field.left - row.left, rowWidth: row.width };
    });
    assert.ok(geometry.width <= 261 && geometry.height <= 38 && geometry.right <= 12 && geometry.left > geometry.rowWidth / 2, JSON.stringify(geometry));
    const search = activePanel.getByRole("textbox", { name: "Find in terminal", exact: true });
    const result = activePanel.locator(".terminal-search-count");
    const count = async expected => { await page.waitForFunction(expected => [...document.querySelectorAll(".terminal-panel")].filter(el => el.offsetHeight).some(el => el.querySelector(".terminal-search-count")?.textContent?.endsWith(`/${expected}`)), expected); };
    await search.fill("Needle"); await count(4);
    assert.ok(await activePanel.locator(".xterm-find-result-decoration").count() >= 4);
    const before = await result.innerText();
    await search.press("Enter"); assert.notEqual(await result.innerText(), before);
    await search.press("Shift+Enter"); assert.equal(await result.innerText(), before);
    await activePanel.getByRole("button", { name: "Match case", exact: true }).click(); await count(1);
    await activePanel.getByRole("button", { name: "Match case", exact: true }).click();
    await activePanel.getByRole("button", { name: "Match whole word", exact: true }).click(); await count(3);
    await activePanel.getByRole("button", { name: "Match whole word", exact: true }).click();
    await activePanel.getByRole("button", { name: "Use regular expression", exact: true }).click();
    await search.fill("Needle|中文测试"); await count(6);
    await capture("terminal-search-matches");
    await search.fill("["); await page.waitForFunction(() => document.querySelector('.terminal-search input[aria-invalid="true"]'));
    assert.equal(await activePanel.locator(".xterm-find-result-decoration").count(), 0);
    await search.fill("中文测试"); await count(2);
    // 焦点移到终端正文时仍保留全部高亮。
    await activePanel.locator(".terminal-xterm").click(); assert.ok(await activePanel.locator(".xterm-find-result-decoration").count() >= 2);
    await search.focus(); await search.press("Escape");
    assert.equal(await activePanel.locator(".terminal-search").count(), 0);
    assert.equal(await activePanel.locator(".xterm-find-result-decoration").count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("pi-terminal-shell")), "powershell");
    const available = await (await page.request.get(`${base}/api/terminal`)).json();
    if (available.shells.some(shell => shell.id === "pwsh")) {
      await shellMenu().click();
      await openedMenu().getByRole("menuitem", { name: /^PowerShell(?:\s|$)/ }).click();
      await dock.locator(".is-ready").waitFor();
      await run("Write-Output ('PWSH_READY:' + $PSVersionTable.PSVersion.Major)");
      await page.waitForFunction(() => [...document.querySelectorAll(".terminal-panel")].filter(el => el.offsetHeight).some(el => /PWSH_READY:\d+/.test(el.querySelector(".xterm-rows")?.textContent ?? "")));
      assert.equal((await metadata(await activeId())).shellId, "pwsh");
      assert.equal(await page.evaluate(() => localStorage.getItem("pi-terminal-shell")), "pwsh");
    }
  }
  console.log("PASS: 菜单互斥/外部关闭/Esc/全屏关闭、当前目录复制、五主题与 ANSI、大小写/全字/正则/中文高亮及计数");
}
