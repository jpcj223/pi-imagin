import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** 复用隔离设置服务；页面保存与连接测试由请求替身接收，不连接真实 MCP。 */
export async function checkMcpConfig(page, base, artifacts) {
  const sessions = await (await page.request.get(`${base}/api/sessions`)).json();
  const first = sessions.sessions.find(session => session.id === "resource-trust-2").cwd;
  const second = join(artifacts, "mcp-project-b"); mkdirSync(second);
  assert.equal((await page.request.post(`${base}/api/projects`, { data: { action: "save", name: "MCP项目B", folders: [{ path: second }], defaultPath: second } })).status(), 200);
  const globalFile = join(artifacts, "agent/mcp.json");
  const makeServer = (name, scope = "global", owner = null) => ({ name, scope, owner,
    sourcePath: scope === "global" ? globalFile : join(owner, ".pi/mcp.json"),
    configKey: `${scope}:${owner}:${name}`, enabled: true, validated: true, exposure: "codemode", transport: "http",
    url: `https://${name}.example.test/mcp`, envNames: [], headerNames: [], usesOAuth: false,
    commandFields: [], variableReferences: [], masked: false });
  const servers = [makeServer("global-docs"), makeServer("project-a", "project", first), makeServer("project-b", "project", second)];
  const switchChecks = Boolean(process.env.MCP_SWITCH_ONLY);
  if (switchChecks) servers.push({ ...makeServer("global-off"), enabled: false });
  let runtimeEnabled = false;
  let applyReadyAt = 0;
  const autoConnect = Boolean(process.env.MCP_AUTOCONNECT_ONLY);
  const overview = cwd => ({ mcp: runtimeEnabled ? { available: true } : { available: false, reason: "builtin-disabled", settingsPath: join(artifacts, "agent/settings.json") },
    runtime: { enabled: runtimeEnabled, ...(autoConnect ? { application: { sessions: 1, failed: 0, pending: Date.now() < applyReadyAt ? 1 : 0 } } : {}) },
    ...(process.env.MCP_COPY_ONLY && runtimeEnabled ? { hostInactive: { cwd: first, owner: join(artifacts, "extensions/pi-mcp-adapter/index.ts"), updatedAt: Date.now() } } : {}),
    codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic", mode: { settingsPath: globalFile, value: "on" }, inlineBudget: { settingsPath: globalFile, default: 3000, max: 1000000 } },
    files: [{ scope: "global", path: globalFile, exists: true, problems: [] }, ...(cwd ? [{ scope: "project", path: join(cwd, ".pi/mcp.json"), exists: true, problems: [] }] : [])],
    servers: servers.filter(server => server.scope === "global" || server.owner === cwd).map(server => autoConnect && runtimeEnabled
      ? { ...server, status: { origin: "session", state: Date.now() < applyReadyAt ? "connecting" : "connected", updatedAt: Date.now(), sessionId: "fixture", cwd: first,
        tools: [{ name: "live_search", description: "从会话连接获取的工具", readOnly: true, exposure: "codemode" }], toolCount: 1 } } : server),
    ...(cwd ? { project: { cwd, trust: { requiresTrust: true, trusted: true, decision: true, decisionPath: cwd, inherited: false } } } : {}) });
  const writes = [], tests = [];
  await page.route(/\/api\/mcp(?:\?.*)?$/, async route => {
    const request = route.request();
    if (request.method() === "GET") {
      const cwd = new URL(request.url()).searchParams.get("cwd");
      if (cwd) await delay(350); // 刻意放慢首次响应，检查加载前后结构稳定。
      return route.fulfill({ json: overview(cwd) });
    }
    const body = request.postDataJSON(); writes.push(body);
    if (body.action === "set-runtime") {
      runtimeEnabled = body.enabled;
      applyReadyAt = autoConnect ? Date.now() + 1100 : 0;
      return route.fulfill({ json: overview(body.cwd) });
    }
    if (switchChecks && ["enable", "disable", "set-enabled"].includes(body.action)) {
      for (const server of servers) {
        if ((body.action === "set-enabled" ? body.servers.some(item => item.name === server.name && item.scope === server.scope) : server.name === body.name && server.scope === body.scope))
          server.enabled = body.action === "set-enabled" ? body.enabled : body.action === "enable";
      }
      return route.fulfill({ json: overview(body.cwd) });
    }
    assert.equal(body.action, "add");
    servers.push(makeServer(body.name, body.scope, body.cwd ?? null));
    await route.fulfill({ json: { ...overview(body.cwd), added: { scope: body.scope, name: body.name, path: body.scope === "global" ? globalFile : join(body.cwd, ".pi/mcp.json") } } });
  });
  await page.route(/\/api\/mcp\/connect$/, async route => {
    const body = route.request().postDataJSON(); tests.push(body);
    const server = servers.find(server => server.name === body.name && server.scope === body.scope);
    assert.ok(server.enabled);
    server.status = { origin: "session", state: "connected", updatedAt: Date.now(), sessionId: "fixture", cwd: first,
      tools: [{ name: "live_search", description: "实际会话工具", exposure: "codemode" }], toolCount: 1 };
    return route.fulfill({ json: overview(body.cwd) });
  });
  await page.route(/\/api\/mcp\/test$/, async route => {
    const body = route.request().postDataJSON(); tests.push(body);
    const server = servers.find(server => server.name === body.name && server.scope === body.scope && (server.owner ?? null) === (body.cwd ?? null));
    assert.ok(server);
    await route.fulfill({ json: { name: body.name, scope: body.scope, configKey: server.configKey,
      result: { state: "failed", error: "测试连接失败，配置已保留", tools: [], testedAt: Date.now(), durationMs: 10 } } });
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.reload();
  await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  await page.locator(".workspace-rail-settings").click();
  await page.locator(".settings-section-tabs").getByRole("button", { name: "MCP", exact: true }).click();
  const workspace = page.locator('[data-settings-section="mcp"]');
  const host = workspace.locator(".mcp-target-page:visible");
  const groupNames = () => host.locator(".config-sidebar-group-label-text").allTextContents();
  const openAdd = () => host.locator(".config-list-action-button").click();
  const source = host.locator("#mcp-add-source");
  const submit = host.getByRole("button", { name: "添加并测试", exact: true });
  await host.locator(".config-sidebar-item").filter({ hasText: "global-docs" }).waitFor();
  assert.deepEqual(await groupNames(), [switchChecks ? "全局部分开启" : "全局"]);
  assert.equal(tests.length, 0, "查看页面不启动连接测试");
  const runtimeSwitch = host.getByRole("switch", { name: "启用 MCP", exact: true });
  assert.equal(await runtimeSwitch.getAttribute("aria-checked"), "false");
  const runtimeLayout = () => host.evaluate(node => [".mcp-runtime-header", ".mcp-target-toolbar", ".config-sidebar"].map(selector => {
    const box = node.querySelector(selector).getBoundingClientRect(); return { y: box.y, height: box.height };
  }));
  const beforeEnable = autoConnect ? await runtimeLayout() : null;
  const compareAgentHeader = async () => {
    const mcpHeight = await host.locator(".settings-feature-header").evaluate(node => node.getBoundingClientRect().height);
    await page.locator(".settings-section-tabs").getByRole("button", { name: "子代理", exact: true }).click();
    const header = page.locator('[data-settings-section="agents"] .settings-feature-header:visible');
    await header.waitFor();
    assert.equal(await header.evaluate(node => node.getBoundingClientRect().height), mcpHeight, "子代理和 MCP 顶部总开关高度一致");
    await page.locator(".settings-section-tabs").getByRole("button", { name: "MCP", exact: true }).click();
    await host.waitFor();
  };
  await runtimeSwitch.click();
  await host.locator(".mcp-runtime-badge.is-on").waitFor();
  assert.equal(await runtimeSwitch.getAttribute("aria-checked"), "true");
  if (switchChecks) {
    await host.locator(".config-sidebar-item").filter({ hasText: "global-docs" }).click();
    assert.equal(await host.getByText("部分开启", { exact: true }).count(), 1);
    await host.getByRole("button", { name: "连接", exact: true }).click();
    await host.getByRole("button", { name: "重新连接", exact: true }).waitFor();
    await host.getByText("live_search", { exact: true }).waitFor();
    await host.locator(".config-detail-actions").getByRole("button", { name: "移除", exact: true }).waitFor();
    assert.equal(await host.getByRole("button", { name: "更多操作", exact: true }).count(), 0);
    await host.getByRole("switch", { name: "关闭 global-docs", exact: true }).click();
    assert.equal(await host.locator(".config-detail-actions").getByRole("button", { name: /^(连接|重新连接)$/ }).isDisabled(), true);
    await host.getByRole("switch", { name: "开启 全局 中的所有服务器", exact: true }).click();
    assert.ok(servers.filter(s => s.scope === "global").every(s => s.enabled));
    await host.getByRole("switch", { name: "关闭 全局 中的所有服务器", exact: true }).click();
    assert.ok(servers.filter(s => s.scope === "global").every(s => !s.enabled));
    await host.getByRole("button", { name: "连接", exact: true }).waitFor();
    await page.waitForFunction(() => {
      const node = document.querySelector('.mcp-target-page:not([hidden]) .config-detail-actions button[role="switch"]');
      return node?.getAttribute("aria-checked") === "false";
    });
    assert.equal(await host.locator(".mcp-test-tools").count(), 0);
    await page.screenshot({ path: join(artifacts, "mcp-switch-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(artifacts, "mcp-switch-mobile.png") });
    assert.equal(tests.length, 1);
    console.log("PASS MCP 单服务连接、会话工具、直接移除按钮、分组开关及窄屏布局");
    return;
  }
  if (autoConnect) {
    await host.getByText("正在应用，忙碌会话将在任务结束后连接。", { exact: true }).waitFor();
    assert.deepEqual(await runtimeLayout(), beforeEnable, "开启后的原位反馈不改变工具栏或侧栏布局");
    await host.locator(".mcp-sidebar-badge").getByText("会话已连接", { exact: true }).waitFor();
    assert.deepEqual(await runtimeLayout(), beforeEnable, "连接完成仍不改变布局");
    await host.locator(".config-sidebar-item").filter({ hasText: "global-docs" }).click();
    await host.getByText("live_search", { exact: true }).waitFor();
    await host.getByText("从会话连接获取的工具", { exact: true }).waitFor();
    assert.equal(tests.length, 0, "自动会话连接不以一次性测试冒充");
    await compareAgentHeader();
    await page.screenshot({ path: join(artifacts, "mcp-autoconnect-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await runtimeLayout();
    await runtimeSwitch.click();
    await host.getByText("已关闭，现有会话将在空闲时断开。", { exact: true }).waitFor();
    assert.deepEqual(await runtimeLayout(), mobile, "窄屏关闭反馈不撑高页面");
    await compareAgentHeader();
    await page.screenshot({ path: join(artifacts, "mcp-autoconnect-mobile.png") });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log("PASS MCP 自动连接状态刷新、桌面及窄屏开关布局稳定");
    return;
  }
  await host.locator(".mcp-sidebar-badge").getByText("尚未连接", { exact: true }).waitFor();
  assert.equal(tests.length, 0, "开启总开关不运行连接测试");
  if (process.env.MCP_COPY_ONLY) {
    const header = host.locator(".mcp-runtime-header");
    assert.equal(await header.locator("p").textContent(), "让 AI 使用外部工具。");
    assert.equal(await header.locator(".mcp-runtime-hint").textContent(), "已开启，已发起自动连接。");
    const notice = host.locator(".mcp-runtime-status");
    const details = notice.locator("details");
    assert.equal(await details.getAttribute("open"), null);
    assert.equal(await notice.locator("strong").textContent(), "有会话的 MCP 由其他插件管理，内置连接未生效。");
    assert.equal(await details.locator("p").isVisible(), false);
    await page.screenshot({ path: join(artifacts, "mcp-copy-desktop.png") });
    await details.locator("summary").focus(); await page.keyboard.press("Enter");
    assert.ok((await details.locator("p").textContent()).includes("pi-mcp-adapter"));
    assert.equal(await details.locator("p").isVisible(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(artifacts, "mcp-copy-mobile.png") });
    await details.locator("summary").click();
    assert.equal(await details.locator("p").isVisible(), false);
    assert.equal(tests.length, 0);
    console.log("PASS MCP 简短说明、默认折叠诊断、键盘展开、窄屏排版及不启动连接");
    return;
  }
  await host.locator(".mcp-advanced-entry button").click();
  const advanced = host.locator(".mcp-calling-more");
  assert.equal(await advanced.getAttribute("open"), null);
  await advanced.locator("summary").focus(); await page.keyboard.press("Enter");
  assert.equal(await host.locator(".mcp-advanced-pane").getByRole("button", { name: "自动", exact: true }).getAttribute("aria-pressed"), "true");
  await page.screenshot({ path: join(artifacts, "mcp-runtime-advanced.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(artifacts, "mcp-runtime-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 960 });
  if (process.env.MCP_CALLING_ONLY) {
    await host.locator(".config-sidebar-item").filter({ hasText: "global-docs" }).click();
    const trigger = host.locator(".mcp-exposure-select");
    await trigger.click();
    const menu = page.locator(".mcp-exposure-menu");
    await menu.waitFor();
    assert.equal(await menu.getByRole("menuitemradio").count(), 4);
    assert.equal(await menu.getByRole("menuitemradio", { checked: true }).count(), 1);
    await page.keyboard.press("ArrowDown");
    assert.ok(await menu.locator(":focus").count());
    await page.waitForTimeout(250); // 等菜单入场动画结束再截取视觉结果。
    await page.screenshot({ path: join(artifacts, "mcp-tool-menu.png") });
    await page.keyboard.press("Escape");
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    await menu.waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(artifacts, "mcp-tool-menu-mobile.png") });
    assert.equal(tests.length, 0);
    console.log("PASS MCP 调用设置、预算折叠、主题菜单、方向键/Escape焦点及窄屏");
    return;
  }
  await runtimeSwitch.click();
  await host.locator(".mcp-runtime-status").waitFor();
  assert.equal(await runtimeSwitch.getAttribute("aria-checked"), "false");
  assert.equal(writes.length, 2);
  writes.length = 0;
  await openAdd();
  assert.equal(await host.locator(".mcp-add-examples").getAttribute("open"), null);
  assert.equal(await host.locator(".mcp-add-catalogs").getAttribute("open"), null);
  await host.locator(".mcp-add-catalogs summary").click();
  assert.equal(await host.locator(".mcp-add-catalogs a:visible").count(), 5);
  await host.getByRole("button", { name: "管理网站", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "管理网站", exact: true });
  await manager.getByRole("button", { name: "新增网站", exact: true }).click();
  let row = manager.locator(".mcp-catalog-edit-row").last();
  await row.getByLabel("名称", { exact: true }).fill("本地文档");
  await row.getByLabel("网站链接", { exact: true }).fill("javascript:alert(1)");
  await manager.getByRole("button", { name: "保存", exact: true }).click();
  await manager.getByRole("alert").waitFor();
  await row.getByLabel("网站链接", { exact: true }).fill("https://docs.example.test/catalog");
  await manager.getByRole("button", { name: "保存", exact: true }).click();
  await host.getByRole("link", { name: "本地文档", exact: true }).waitFor();
  assert.equal(await host.locator(".mcp-add-catalogs a").count(), 6);
  await page.reload();
  await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  await page.locator(".workspace-rail-settings").click();
  await page.locator(".settings-section-tabs").getByRole("button", { name: "MCP", exact: true }).click();
  await host.locator(".config-list-action-button").waitFor();
  await openAdd();
  await host.locator(".mcp-add-catalogs summary").click();
  assert.equal(await host.getByRole("link", { name: "本地文档", exact: true }).getAttribute("href"), "https://docs.example.test/catalog", "重新打开应用保留网站入口");
  await host.getByRole("button", { name: "管理网站", exact: true }).click();
  row = manager.locator(".mcp-catalog-edit-row").last();
  await row.getByLabel("名称", { exact: true }).fill("新版文档");
  await manager.getByRole("button", { name: "保存", exact: true }).click();
  assert.equal(await host.getByRole("link", { name: "新版文档", exact: true }).getAttribute("href"), "https://docs.example.test/catalog");
  await host.getByRole("button", { name: "管理网站", exact: true }).click();
  await manager.getByRole("button", { name: "删除 新版文档", exact: true }).click();
  await manager.getByRole("button", { name: "保存", exact: true }).click();
  assert.equal(await host.locator(".mcp-add-catalogs a").count(), 5);
  await host.getByRole("button", { name: "管理网站", exact: true }).click();
  await manager.locator(".mcp-catalog-edit-row").first().getByLabel("名称", { exact: true }).fill("已改名");
  await manager.getByRole("button", { name: "重置网站", exact: true }).click();
  await page.screenshot({ path: join(artifacts, "mcp-catalog-manager.png") });
  await manager.getByRole("button", { name: "保存", exact: true }).click();
  assert.equal(await host.locator(".mcp-add-catalogs a").first().textContent(), "glama.ai");
  assert.equal(writes.length, 0, "网站管理与重置不修改服务器");
  await host.locator(".mcp-runtime-status details summary").click();
  assert.ok((await host.locator(".mcp-runtime-status details").textContent()).includes("settings.json"));
  await page.screenshot({ path: join(artifacts, "mcp-status-details.png") });
  await host.locator(".mcp-runtime-status details summary").click();
  await host.locator(".mcp-add-catalogs summary").click();
  await host.locator(".mcp-add-examples summary").click();
  const examples = host.locator(".mcp-add-examples");
  assert.equal(await examples.locator("button.mcp-add-example").count(), 19);
  assert.ok(await examples.locator("button").first().evaluate(node => node.getBoundingClientRect().height >= 50));
  assert.equal(await examples.locator(".mcp-add-example-list").evaluate(node => getComputedStyle(node).overflowY), "visible", "示例随正文滚动");
  assert.equal(await examples.evaluate(node => getComputedStyle(node).borderTopWidth), "0px");
  await page.screenshot({ path: join(artifacts, "mcp-add-examples.png") });
  await examples.getByRole("button", { name: "URL https://mcp.example.com/mcp", exact: true }).click();
  assert.equal(await source.inputValue(), "https://mcp.example.com/mcp");
  assert.equal(await examples.getAttribute("open"), null, "点击填入后自动折叠");
  assert.equal(await source.evaluate(node => node === document.activeElement), true);
  assert.equal(writes.length, 0); assert.equal(tests.length, 0, "点击示例不保存或测试");
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await host.getByText("这是演示地址，请替换为服务商提供的真实 MCP 地址。", { exact: true }).count(), 0);
  if (process.env.MCP_EXAMPLES_ONLY) {
    await examples.locator("summary").click();
    const command = examples.getByRole("button", { name: "命令行 npx -y @modelcontextprotocol/server-everything", exact: true });
    await command.focus(); await page.keyboard.press("Enter");
    assert.equal(await source.inputValue(), "npx -y @modelcontextprotocol/server-everything");
    assert.equal(await examples.getAttribute("open"), null);
    assert.equal(await host.getByLabel("名称", { exact: true }).inputValue(), "everything");
    await page.screenshot({ path: join(artifacts, "mcp-example-filled.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await examples.locator("summary").click();
    await command.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await command.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length), 1);
    await page.screenshot({ path: join(artifacts, "mcp-examples-mobile.png") });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.screenshot({ path: join(artifacts, "mcp-examples-mobile-dark.png") });
    await command.click();
    assert.equal(await source.inputValue(), "npx -y @modelcontextprotocol/server-everything");
    assert.equal(await examples.getAttribute("open"), null);
    assert.equal(writes.length, 0); assert.equal(tests.length, 0);
    console.log("PASS MCP 示例无边框、舒适行高、正文滚动、鼠标和键盘填入、自动折叠聚焦与窄屏布局");
    return;
  }
  await examples.locator("summary").click();
  const keyboardExample = examples.getByRole("button", { name: "命令行 npx -y @modelcontextprotocol/server-everything", exact: true });
  await keyboardExample.focus(); await page.keyboard.press("Enter");
  assert.equal(await source.inputValue(), "npx -y @modelcontextprotocol/server-everything");
  assert.equal(await examples.getAttribute("open"), null);
  assert.equal(writes.length, 0); assert.equal(tests.length, 0);
  await source.fill("https://global-new.example.test/mcp");
  await host.getByLabel("名称", { exact: true }).fill("global-new");
  assert.equal(await submit.isDisabled(), false);
  await host.locator(".mcp-add-target .resource-copy-button").click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), globalFile);
  await host.getByRole("button", { name: "取消", exact: true }).click();
  await openAdd(); assert.equal(await source.inputValue(), "", "取消彻底清空草稿");
  assert.equal(await host.getByLabel("名称", { exact: true }).count(), 0);
  await source.fill("https://global-new.example.test/mcp");
  await host.getByLabel("名称", { exact: true }).fill("global-new");
  const layout = () => host.evaluate(node => [".mcp-target-toolbar", ".config-sidebar", ".config-footer"].map(selector => {
    const box = node.querySelector(selector).getBoundingClientRect(); return [box.x, box.y, box.width, box.height];
  }));
  const initialLayout = await layout();
  const choose = async name => {
    await host.locator("[data-resource-install-target]").click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
    await host.locator(".resource-install-project-name").getByText(name, { exact: true }).waitFor();
    assert.deepEqual(await layout(), initialLayout, "首次项目加载期间工具栏、侧栏与页脚不跳动");
    await host.locator(".config-sidebar-item").first().waitFor();
    assert.deepEqual(await layout(), initialLayout, "加载完成与通知出现不重排页面");
  };
  await choose("安装测试项目");
  assert.deepEqual(await groupNames(), ["全局", "项目"]);
  await openAdd(); await source.fill("https://project-new.example.test/mcp");
  await host.getByLabel("名称", { exact: true }).fill("project-new");
  await choose("MCP项目B"); await openAdd();
  assert.equal(await source.inputValue(), "", "不同项目不串草稿");
  await choose("安装测试项目");
  assert.equal(await source.inputValue(), "https://project-new.example.test/mcp");
  await submit.click();
  await host.getByText("测试连接失败，配置已保留", { exact: true }).waitFor();
  assert.equal(writes.at(-1).cwd, first); assert.equal(writes.at(-1).scope, "project");
  assert.equal(tests.length, 1); assert.equal(tests[0].cwd, first);
  await host.locator(".config-sidebar-item").filter({ hasText: "project-new" }).waitFor();
  await host.locator("[data-resource-install-global]").click();
  await source.waitFor(); assert.equal(await source.inputValue(), "https://global-new.example.test/mcp");
  assert.deepEqual(await groupNames(), ["全局"]);
  await submit.click();
  await host.getByText("测试连接失败，配置已保留", { exact: true }).waitFor();
  assert.equal(writes.at(-1).cwd, undefined); assert.equal(writes.at(-1).scope, "global");
  assert.equal(tests.length, 2); assert.equal(tests[1].cwd, undefined);
  await openAdd();
  await source.fill('npx -y @fixture/docs-server');
  assert.ok(await host.locator(".mcp-add-target .resource-path-trigger").evaluate(node => node.getBoundingClientRect().width < 340), "长配置路径保持缩略");
  await host.locator(".mcp-add-advanced summary").click();
  await page.screenshot({ path: join(artifacts, "mcp-add-command-light.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await delay(150);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "窄屏无水平溢出");
  await host.getByLabel("名称", { exact: true }).scrollIntoViewIfNeeded();
  await host.getByLabel("名称", { exact: true }).fill("docs-mobile");
  assert.ok(await submit.isVisible(), "滚动正文时操作栏可见");
  await page.screenshot({ path: join(artifacts, "mcp-add-mobile.png") });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: join(artifacts, "mcp-add-mobile-dark.png") });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await choose("MCP项目B");
  await page.locator(".workspace-rail-skills").click();
  assert.equal(await page.locator('[data-settings-section="skills"] [data-resource-install-global]').getAttribute("aria-pressed"), "true", "技能不继承 MCP 项目");
  await page.locator(".workspace-rail-plugins").click();
  assert.equal(await page.locator('[data-settings-section="plugins"] [data-resource-install-global]').getAttribute("aria-pressed"), "true", "插件不继承 MCP 项目");
  await page.locator(".workspace-rail-settings").click();
  await page.locator(".settings-section-tabs").getByRole("button", { name: "MCP", exact: true }).click();
  await host.locator(".resource-install-project-name").getByText("MCP项目B", { exact: true }).waitFor();
  assert.equal(writes.length, 2, "输入、展开和切换均不额外保存");
  await host.locator("[data-resource-install-global]").click();
  await openAdd();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "pine"));
  await page.screenshot({ path: join(artifacts, "mcp-add-pine.png") });
  await host.locator(".mcp-add-catalogs summary").click();
  await host.getByRole("button", { name: "管理网站", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await manager.evaluate(node => node.getBoundingClientRect().right <= innerWidth));
  assert.ok(await manager.evaluate(node => node.getBoundingClientRect().bottom <= innerHeight));
  await page.screenshot({ path: join(artifacts, "mcp-catalog-manager-mobile.png") });
  await page.keyboard.press("Escape");
  assert.equal(await manager.count(), 0, "Escape 只关闭网站管理");
  assert.equal(await host.isVisible(), true);
  console.log("PASS MCP 范围独立及首次加载稳定、通知详情、示例与校验、草稿清空、网站管理持久化、统一底栏及明暗窄屏");
}
