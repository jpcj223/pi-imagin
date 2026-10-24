import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

/** 使用隔离目录与确定性数据检验两页共用交互，不操作实际安装。 */
export async function checkResourceSidebars(page, base, artifacts, other) {
  const second = join(artifacts, "second"); mkdirSync(second);
  const response = await page.request.post(`${base}/api/projects`, { data: { action: "save", name: "第二项目", folders: [{ path: second }], defaultPath: second } });
  assert.equal(response.status(), 200);
  const counts = { extensions: 1, skills: 0, prompts: 0, themes: 0 };
  const makeSkill = (name, scope, origin) => ({ name, description: `${name} instructions`, filePath: join(scope === "global" ? artifacts : other, name, "SKILL.md"), baseDir: artifacts, source: scope === "global" ? "user" : "project", sourceInfo: { scope: scope === "global" ? "user" : "project", source: scope === "global" ? "user" : "project" }, installOrigin: origin, disableModelInvocation: false, canRemove: true, install: { package: `fixture/catalog@${name}`, scope, source: "fixture/catalog", sourceType: "github", canCheckForUpdates: false } });
  const makePlugin = (name, scope, origin) => ({ packageName: name, source: `npm:${name}`, scope, installOrigin: origin, counts, resources: [], status: "loaded", disabled: false, filtered: false, canCheckForUpdates: false, description: `${name} description` });
  let skills = [makeSkill("shared", "global", "app"), makeSkill("outside", "global", "external")];
  let plugins = [makePlugin("public-plugin", "global", "app"), makePlugin("outside-plugin", "global", "external")];
  const selected = request => new URL(request.url()).searchParams.get("cwd");
  const listSkills = cwd => ({ skills: [...skills, ...(cwd ? [makeSkill(cwd === other ? "only-a" : "only-b", "project", "app")] : [])], diagnostics: [], projectResourcesLoaded: true, globalSkillsPath: join(artifacts, "agent/skills") });
  const listPlugins = cwd => ({ packages: [...plugins, ...(cwd ? [makePlugin(cwd === other ? "only-a-plugin" : "only-b-plugin", "project", "app")] : [])], standaloneExtensions: [], diagnostics: [], totals: counts, projectResourcesLoaded: true, globalInstallPath: join(artifacts, "agent") });
  await page.route(/\/api\/skills(?:\?.*)?$/, async route => {
    if (route.request().method() === "DELETE") { skills = skills.filter(skill => skill.filePath !== route.request().postDataJSON().filePath); return route.fulfill({ json: { success: true } }); }
    if (selected(route.request())) await delay(650);
    await route.fulfill({ json: listSkills(selected(route.request())) });
  });
  await page.route(/\/api\/plugins(?:\?.*)?$/, async route => {
    if (route.request().method() === "POST") { const body = route.request().postDataJSON(); if (body.action === "remove") plugins = plugins.filter(pkg => pkg.source !== body.source); return route.fulfill({ json: listPlugins(body.cwd) }); }
    if (selected(route.request())) await delay(650);
    await route.fulfill({ json: listPlugins(selected(route.request())) });
  });
  await page.route("**/api/skills/content?*", route => route.fulfill({ json: { content: "---\nname: shared\ndescription: Full installed content\n---\n# Full instructions\n" } }));
  await page.route("**/api/skills/catalog?*", route => route.fulfill({ json: { items: ["shared", "only-a", "only-b"].map(name => ({ name, source: "fixture/catalog", slug: name, package: `fixture/catalog@${name}`, installs: 100, official: false, url: `https://skills.sh/fixture/catalog/${name}` })), page: 0, total: 3, hasNext: false, searchLimited: false } }));
  await page.route("**/api/plugins/search?*", route => route.fulfill({ json: { items: ["public-plugin", "only-a-plugin", "only-b-plugin"].map(name => ({ name, source: `npm:${name}`, description: name, types: ["extension"], url: `https://example.invalid/${name}` })), page: 1, total: 3, hasNext: false } }));
  await page.evaluate(() => { sessionStorage.clear(); for (const kind of ["skills", "plugins"]) localStorage.removeItem(`pi-resource-sidebar:${kind}`); });
  await page.reload();
  await page.locator(".chat-message-area").getByText("Resource trust fixture", { exact: true }).waitFor();

  for (const kind of ["skills", "plugins"]) {
    await page.locator(`.workspace-rail-${kind}`).click();
    const host = page.locator(`.settings-section-host[data-settings-section="${kind}"]`);
    const group = id => host.locator(`[data-resource-group="${id}"]`);
    const toggle = id => group(id).locator(".resource-sidebar-group-toggle");
    await toggle("global").waitFor();
    assert.equal(await host.locator("[data-resource-install-global]").getAttribute("aria-pressed"), "true", `${kind} 首次进入独立选择全局`);
    const catalogSearch = host.locator(".resource-catalog-search").locator("input").or(host.locator("input.resource-catalog-search"));
    await catalogSearch.fill("retained-query");
    const layoutTop = await host.locator(kind === "skills" ? ".skills-catalog-scroll" : ".plugins-card-grid").evaluate(node => node.getBoundingClientRect().top);
    const titleCount = host.locator(kind === "skills" ? ".skills-installed-search small" : ".plugins-list-header>div>span");
    const originalCount = await titleCount.innerText();
    assert.equal(await toggle("global").getAttribute("aria-expanded"), "true");
    assert.equal(await toggle("external").getAttribute("aria-expanded"), "false");
    assert.equal(await group("external").locator(".config-sidebar-group-count").innerText(), "1/1");
    const filter = host.locator(".config-sidebar input[type=search]");
    await filter.fill("outside");
    assert.equal(await toggle("external").getAttribute("aria-expanded"), "true");
    await filter.fill("");
    assert.equal(await toggle("external").getAttribute("aria-expanded"), "false", "搜索临时展开，不覆盖折叠偏好");
    await host.locator("[data-resource-install-target]").click();
    await page.getByRole("menuitemradio", { name: "安装测试项目", exact: true }).click();
    await host.locator(".resource-install-project-name").getByText("安装测试项目", { exact: true }).waitFor();
    assert.equal(await titleCount.innerText(), originalCount, "切换中保留列表数量，不重置为 0");
    assert.equal(await host.locator(".resource-installed-list").getAttribute("aria-busy"), "true");
    assert.equal(await catalogSearch.inputValue(), "retained-query", "切换不重建目录搜索");
    assert.equal(await host.locator(kind === "skills" ? ".skills-catalog-scroll" : ".plugins-card-grid").evaluate(node => node.getBoundingClientRect().top), layoutTop, "安装位置与信任提示不改变卡片起点");
    await toggle("project").waitFor();
    assert.equal(await toggle("project").getAttribute("aria-expanded"), "false");
    assert.deepEqual(await host.locator("[data-resource-group]").evaluateAll(nodes => nodes.map(node => node.dataset.resourceGroup)), ["global", "external", "project"]);
    const card = name => host.locator(kind === "skills" ? ".skills-catalog-card" : ".plugin-card").filter({ has: kind === "skills" ? page.locator(".skills-card-name", { hasText: new RegExp(`^${name}$`) }) : page.getByRole("button", { name, exact: true }) });
    const publicName = kind === "skills" ? "shared" : "public-plugin";
    const ownName = kind === "skills" ? "only-a" : "only-a-plugin";
    const otherName = kind === "skills" ? "only-b" : "only-b-plugin";
    await card(publicName).getByRole("button", { name: "已安装", exact: true }).waitFor();
    await card(ownName).getByRole("button", { name: "已安装", exact: true }).waitFor();
    await card(otherName).getByRole("button", { name: "安装", exact: true }).waitFor();
    await host.locator("[data-resource-install-target]").click();
    await page.getByRole("menuitemradio", { name: "第二项目", exact: true }).click();
    await host.locator(".resource-install-project-name").getByText("第二项目", { exact: true }).waitFor();
    await card(publicName).getByRole("button", { name: "已安装", exact: true }).waitFor();
    await card(ownName).getByRole("button", { name: "安装", exact: true }).waitFor();
    await card(otherName).getByRole("button", { name: "已安装", exact: true }).waitFor();
    assert.equal(await catalogSearch.inputValue(), "retained-query");
    if (kind === "plugins") {
      await page.locator(".workspace-rail-skills").click();
      await page.locator('.settings-section-host[data-settings-section="skills"] .resource-install-project-name').getByText("第二项目", { exact: true }).waitFor();
      await page.locator(".workspace-rail-plugins").click();
      await host.locator(".resource-install-project-name").getByText("第二项目", { exact: true }).waitFor();
    }
    const projectButton = toggle("project");
    await projectButton.press("Alt+ArrowUp");
    assert.deepEqual(await host.locator("[data-resource-group]").evaluateAll(nodes => nodes.map(node => node.dataset.resourceGroup)), ["global", "project", "external"]);
    // 用真实鼠标拖动标题行，落在全局标题前。
    const from = await group("external").locator(".resource-sidebar-group-header").boundingBox();
    const to = await group("global").locator(".resource-sidebar-group-header").boundingBox();
    await page.mouse.move(from.x + 35, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(from.x + 36, from.y + from.height / 2 - 8, { steps: 3 });
    await page.mouse.move(to.x + 35, to.y + 4, { steps: 12 }); await page.mouse.up();
    assert.deepEqual(await host.locator("[data-resource-group]").evaluateAll(nodes => nodes.map(node => node.dataset.resourceGroup)), ["external", "global", "project"]);
    assert.equal(await toggle("external").getAttribute("aria-expanded"), "false");
    assert.deepEqual(await page.evaluate(kind => JSON.parse(localStorage.getItem(`pi-resource-sidebar:${kind}`)).order, kind), ["external", "global", "project"]);
    await toggle("external").click();
    await page.screenshot({ path: join(artifacts, `${kind}-sidebar.png`) });
    await host.locator("[data-resource-install-global]").click();
    await host.locator("[data-resource-install-global][aria-pressed=true]").waitFor();
    await card(ownName).getByRole("button", { name: "安装", exact: true }).waitFor();
    const item = host.locator(".resource-sidebar-row").filter({ has: page.getByRole("button", { name: publicName, exact: true }) });
    await item.locator(".resource-sidebar-remove").click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByText(publicName, { exact: true }).waitFor();
    assert.equal(await host.locator(".config-sidebar-item[aria-current=page]").count(), 0, "移除入口不打开详情");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await item.locator(".resource-sidebar-remove").click();
    await dialog.getByRole("button", { name: "确定", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await item.count(), 0);
    await card(publicName).getByRole("button", { name: "安装", exact: true }).waitFor();
    await page.setViewportSize({ width: 720, height: 900 });
    await page.screenshot({ path: join(artifacts, `${kind}-narrow.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "窄屏无整页横向溢出");
    await page.setViewportSize({ width: 1440, height: 960 });
    if (kind === "skills") {
      await host.locator("[data-resource-install-target]").click();
      await page.getByRole("menuitemradio", { name: "第二项目", exact: true }).click();
      await host.locator(".resource-installed-list[aria-busy=false]").waitFor();
    }
  }
  console.log("PASS 安装目标独立、延迟切换保留列表/计数/目录搜索/布局、全局继承、两项目隔离、分组拖动折叠、移除、窄屏");
}
