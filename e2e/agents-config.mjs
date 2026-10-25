import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const { getLocalePlugin } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

/** 复用 resource-trust 的隔离服务，配置写入由页面请求替身接收，不启动真实子任务。 */
export async function checkAgentsConfig(page, base, artifacts) {
  const sessions = await (await page.request.get(`${base}/api/sessions`)).json();
  const fixture = sessions.sessions?.find(session => session.id === "resource-trust-2");
  assert.ok(fixture);
  const data = await (await page.request.get(`${base}/api/subagents/profiles?cwd=${encodeURIComponent(fixture.cwd)}`)).json();
  let profiles = data.profiles;
  assert.ok(profiles?.some(profile => profile.name === "explore" && profile.scope === "builtin"));
  const originalExplore = structuredClone(profiles.find(profile => profile.name === "explore"));
  const second = join(artifacts, "agents-project-b"); mkdirSync(second);
  assert.equal((await page.request.post(`${base}/api/projects`, { data: { action: "save", name: "子代理项目B", folders: [{ path: second }], defaultPath: second } })).status(), 200);
  const makeProfile = (name, displayName, scope, owner) => ({ ...originalExplore, name, displayName, description: displayName, scope, filePath: join(owner ?? artifacts, ".pi", "agents", name + ".md"), owner });
  profiles.push(makeProfile("global-fixture", "全局测试角色", "global", null), makeProfile("same-id", "项目A角色", "project", fixture.cwd), makeProfile("same-id", "项目B角色", "project", second), makeProfile("legacy-a", "兼容角色A", "workspace", fixture.cwd));
  const writes = [];
  let failDelete = false;
  let failLoadFor = null;
  let settings = { enabled: false, maxConcurrent: 10 };
  let saved;
  await page.route(/\/api\/subagents\/settings$/, async route => {
    if (route.request().method() === "PUT") settings = { ...settings, ...route.request().postDataJSON() };
    await route.fulfill({ json: settings });
  });
  await page.route(/\/api\/subagents\/profiles(?:\?.*)?$/, async route => {
    if (route.request().method() === "GET") {
      const cwd = new URL(route.request().url()).searchParams.get("cwd");
      if (cwd) await delay(300);
      if (cwd && cwd === failLoadFor) { failLoadFor = null; return route.fulfill({ status: 500, json: { error: "fixture list failure" } }); }
      return route.fulfill({ json: { profiles: profiles.filter(profile => profile.scope === "builtin" || profile.scope === "global" || profile.owner === cwd), globalAgentsPath: join(artifacts, "agent/agents"), ...(cwd ? { projectAgentsPath: join(cwd, ".pi/agents") } : {}) } });
    }
    const body = route.request().postDataJSON();
    writes.push({ method: route.request().method(), ...body });
    if (route.request().method() === "DELETE") {
      if (failDelete) { failDelete = false; return route.fulfill({ status: 400, json: { error: "fixture deletion failure" } }); }
      profiles = profiles.filter(profile => !(profile.name === body.name && profile.scope === body.scope && (profile.owner ?? null) === (body.cwd ?? null)));
      return route.fulfill({ json: { ok: true } });
    }
    if (route.request().method() === "PATCH") {
      const profile = profiles.find(profile => profile.name === body.name && profile.scope === body.scope && (profile.owner ?? null) === (body.cwd ?? null));
      profile.enabled = body.enabled;
      return route.fulfill({ json: { profile } });
    }
    assert.equal(route.request().method(), "PUT");
    saved = body.profile;
    const profile = { ...saved, scope: body.scope, owner: body.cwd ?? null, filePath: join(body.cwd ?? artifacts, ".pi/agents", saved.name + ".md") };
    profiles = [...profiles.filter(item => !(item.name === profile.name && item.scope === profile.scope && item.owner === profile.owner)), profile];
    await route.fulfill({ json: { profile } });
  });
  if (process.env.RESOURCE_TARGET_UI_ONLY) {
    const longName = "用于验证较长项目名称能够舒适换行并且不会撑出菜单范围的项目";
    for (let index = 0; index < 9; index++) {
      const path = join(artifacts, `menu-project-${index}`); mkdirSync(path);
      assert.equal((await page.request.post(`${base}/api/projects`, { data: { action: "save", name: index === 0 ? longName : `菜单测试项目 ${index}`, folders: [{ path }], defaultPath: path } })).status(), 200);
    }
    await page.reload();
    await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
    const checkMenu = async (section, mobile = false) => {
      const host = page.locator(`[data-settings-section="${section}"]`);
      await host.waitFor({ state: "visible" });
      if (section === "agents") {
        await host.locator('[data-agent-group="builtin"]').waitFor();
        const geometry = await host.evaluate(node => {
          const toolbar = node.querySelector(".agents-target-toolbar").getBoundingClientRect();
          const split = node.querySelector(".config-split-view").getBoundingClientRect();
          const button = node.querySelector("[data-resource-install-global]").getBoundingClientRect();
          return { left: button.x - split.x, height: toolbar.height };
        });
        assert.ok(Math.abs(geometry.left) <= 1, `子代理范围工具栏与内容左边界对齐：${JSON.stringify(geometry)}`);
        assert.ok(geometry.height <= 64, "桌面及窄屏工具栏减少多余留白");
      }
      await host.locator("[data-resource-install-target]").click();
      const menu = page.locator(mobile ? ".sidebar-sheet.resource-project-menu" : ".sidebar-menu.resource-project-menu");
      await menu.waitFor();
      await menu.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
      assert.equal(await host.locator(".resource-install-target-row > span").count(), 0);
      if (!mobile) {
        const bounds = await menu.boundingBox(); assert.equal(bounds.width, 300);
        assert.ok(bounds.height <= 360);
        assert.ok(await menu.evaluate(node => node.scrollHeight > node.clientHeight), "长项目列表内部滚动");
      }
      const item = menu.getByRole("menuitemradio", { name: longName, exact: true });
      assert.ok(await item.evaluate((node, minimum) => node.getBoundingClientRect().height >= minimum, mobile ? 44 : 36));
      assert.ok(await item.locator(".sidebar-menu-label").evaluate(node => node.scrollHeight <= 2 * parseFloat(getComputedStyle(node).lineHeight) + 1));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(artifacts, `${section}-project-menu${mobile ? "-mobile" : ""}.png`) });
      await page.keyboard.press("Escape");
    };
    await page.locator(".workspace-rail-plugins").click(); await checkMenu("plugins");
    await page.locator(".workspace-rail-skills").click(); await checkMenu("skills");
    await page.locator(".workspace-rail-settings").click();
    await page.locator(".settings-section-tabs").getByRole("button", { name: "子代理", exact: true }).click();
    await checkMenu("agents");
    await page.setViewportSize({ width: 390, height: 844 });
    await checkMenu("agents", true);
    console.log("PASS 插件、技能、子代理菜单尺寸、长名称、长列表滚动、隐藏标签与手机布局");
    return;
  }
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.reload();
  await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  await page.locator(".workspace-rail-settings").click();
  await page.locator(".settings-section-tabs").getByRole("button", { name: "子代理", exact: true }).click();
  const host = page.locator('[data-settings-section="agents"]');
  await host.locator('[data-agent-group="builtin"]').waitFor();
  assert.deepEqual(await host.locator("[data-agent-group]").evaluateAll(nodes => nodes.map(node => node.dataset.agentGroup)), ["builtin", "global"]);
  assert.equal(await host.locator('[data-agent-group="builtin"] button[aria-expanded]').getAttribute("aria-expanded"), "false");
  assert.equal(await host.locator('[data-agent-group="project"]').count(), 0);
  assert.equal(await host.locator(".resource-install-target-row > span").count(), 0, "不显示配置范围文字，保留无障碍名称");
  const globalModels = await page.request.get(`${base}/api/models?scope=global`);
  assert.equal(globalModels.status(), 200);
  assert.ok((await globalModels.json()).modelList.some(model => model.provider === "fixture"));
  await host.getByText("Access denied", { exact: true }).waitFor({ state: "hidden" });
  await host.locator('[data-agent-group="builtin"] button[aria-expanded]').click();
  await host.getByRole("button", { name: "代码探查", exact: true }).click();
  await host.getByRole("heading", { name: "代码探查", exact: true }).waitFor();
  assert.equal(await host.locator(".agents-state-badge").innerText(), "未启用");
  assert.equal(await host.locator(".agents-feature-copy > span").count(), 1, "顶部只保留一句用途说明");
  assert.equal(await host.locator(".agents-compatibility").count(), 0);
  assert.equal(await host.locator(".agents-permission-tag").innerText(), "只读工具");
  assert.equal(await host.locator(".agents-prompt-preview").innerText(), getLocalePlugin("zh-CN").messages["agents.role.explore.prompt"]);
  assert.equal(await host.locator(".agents-advanced").getAttribute("open"), null);
  assert.equal(await host.getByLabel("显示名称", { exact: true }).count(), 0, "内置配置不用禁用输入框展示");
  assert.ok(await host.locator(".agents-prompt-preview").evaluate(node => node.getBoundingClientRect().height <= 132));
  await page.screenshot({ path: join(artifacts, "agents-explore-light.png") });

  await host.getByRole("button", { name: "通用任务", exact: true }).click();
  assert.equal(await host.locator(".agents-permission-tag").innerText(), "可修改文件");
  await host.getByRole("button", { name: "方案规划", exact: true }).click();
  assert.equal(await host.locator(".agents-permission-tag").innerText(), "只读工具");
  await host.getByRole("switch", { name: "启用内置子代理", exact: true }).click();
  await host.locator(".agents-state-badge.is-enabled").waitFor();
  assert.equal(settings.enabled, true);
  assert.equal(await host.locator(".agents-feature-disabled-note").count(), 0);

  await host.getByRole("button", { name: "代码探查", exact: true }).click();
  await host.getByRole("button", { name: "创建副本并编辑", exact: true }).click();
  assert.equal(await host.getByLabel("显示名称", { exact: true }).inputValue(), "代码探查 副本");
  assert.equal(await host.getByLabel("系统指令", { exact: true }).inputValue(), originalExplore.systemPrompt);
  await host.locator(".agents-advanced summary").click();
  await host.getByLabel("最大轮次", { exact: true }).fill("7");
  await host.getByLabel("继承父会话上下文", { exact: true }).check();
  await host.locator(".agents-advanced summary").click();
  await host.getByRole("button", { name: "保存", exact: true }).click();
  await host.getByRole("button", { name: "已保存", exact: true }).waitFor();
  assert.equal(saved.maxTurns, 7);
  assert.equal(saved.inheritContext, true);
  assert.deepEqual(saved.tools, originalExplore.tools);
  assert.equal(saved.systemPrompt, originalExplore.systemPrompt);
  assert.equal(saved.codemode, originalExplore.codemode);

  await host.getByRole("button", { name: "代码探查", exact: true }).click();
  const chooseProject = async name => {
    await host.locator("[data-resource-install-target]").click();
    const projectMenu = page.locator(".sidebar-menu.resource-project-menu");
    await projectMenu.waitFor();
    assert.ok(await projectMenu.evaluate(node => Math.abs(node.getBoundingClientRect().width - 300) < 1));
    assert.ok(await projectMenu.getByRole("menuitemradio").first().evaluate(node => node.getBoundingClientRect().height >= 36));
    await page.screenshot({ path: join(artifacts, "agents-project-menu.png") });
    await page.getByRole("menuitemradio", { name, exact: true }).click();
    await host.locator(".resource-install-project-name").getByText(name, { exact: true }).waitFor();
    await host.locator('[data-agent-group="project"][aria-busy="false"]').waitFor();
  };
  const group = scope => host.locator(`[data-agent-group="${scope}"]`);
  await chooseProject("安装测试项目");
  assert.equal(await group("project").getByRole("button", { name: "项目A角色", exact: true }).count(), 1);
  assert.equal(await group("project").getByRole("button", { name: "项目B角色", exact: true }).count(), 0);
  assert.equal(await group("project").getByRole("button", { name: "兼容角色A", exact: true }).count(), 1);
  await group("global").getByRole("button", { name: "全局测试角色", exact: true }).click();
  await host.getByLabel("描述", { exact: true }).fill("全局未保存草稿");
  await chooseProject("子代理项目B");
  assert.equal(await group("project").getByRole("button", { name: "项目B角色", exact: true }).count(), 1);
  assert.equal(await group("project").getByRole("button", { name: "项目A角色", exact: true }).count(), 0);
  await chooseProject("安装测试项目");
  assert.equal(await host.getByLabel("描述", { exact: true }).inputValue(), "全局未保存草稿", "返回范围恢复独立草稿");
  await host.getByRole("button", { name: "保存", exact: true }).click();
  await host.getByRole("button", { name: "已保存", exact: true }).waitFor();
  assert.equal(writes.at(-1).scope, "global", "查看全局角色不会改存到当前所选项目");
  assert.equal(writes.at(-1).cwd, null);

  await host.getByRole("button", { name: "新建子代理", exact: true }).click();
  await host.getByLabel("子代理 ID", { exact: true }).fill("created-a");
  await host.getByLabel("描述", { exact: true }).fill("A 的新角色草稿");
  const fullPath = await host.locator(".inline-resource-path .resource-copy-button").getAttribute("aria-label");
  assert.ok(fullPath, "路径旁提供复制按钮");
  await host.locator(".inline-resource-path .resource-copy-button").click();
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\\/g, "/"), join(fixture.cwd, ".pi/agents/created-a.md").replace(/\\/g, "/"), "复制完整原始路径而非缩略文字");
  await chooseProject("子代理项目B");
  await host.getByRole("button", { name: "新建子代理", exact: true }).click();
  await host.getByLabel("子代理 ID", { exact: true }).fill("created-b");
  await chooseProject("安装测试项目");
  assert.equal(await host.getByLabel("子代理 ID", { exact: true }).inputValue(), "created-a");
  assert.equal(await host.getByLabel("描述", { exact: true }).inputValue(), "A 的新角色草稿");
  await host.getByRole("button", { name: "保存", exact: true }).click();
  await host.getByRole("button", { name: "已保存", exact: true }).waitFor();
  assert.equal(writes.at(-1).scope, "project"); assert.equal(writes.at(-1).cwd, fixture.cwd);
  assert.equal(await group("project").getByRole("button", { name: "自定义角色", exact: true }).count(), 1);
  await host.getByLabel("描述", { exact: true }).fill("删除其他角色时保留当前编辑");
  assert.equal(await host.locator('.config-detail-actions').getByRole("button", { name: "删除", exact: true }).count(), 0);
  assert.equal(await group("builtin").locator(".resource-sidebar-remove").count(), 0);
  const removeA = group("project").locator(".resource-sidebar-row").filter({ has: page.getByRole("button", { name: "项目A角色", exact: true }) }).locator(".resource-sidebar-remove");
  await removeA.click();
  const dialog = page.getByRole("alertdialog"); await dialog.getByText("项目A角色", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await removeA.count(), 1);
  await removeA.click(); failDelete = true;
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await dialog.getByRole("alert").getByText("fixture deletion failure", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(writes.at(-1).cwd, fixture.cwd); assert.equal(writes.at(-1).name, "same-id");
  assert.equal(await host.getByLabel("描述", { exact: true }).inputValue(), "删除其他角色时保留当前编辑");
  await chooseProject("子代理项目B");
  assert.equal(await group("project").getByRole("button", { name: "项目B角色", exact: true }).count(), 1, "删除 A 不影响 B 的同名角色");
  assert.equal(await host.getByLabel("子代理 ID", { exact: true }).inputValue(), "created-b");
  await host.locator("[data-resource-install-global]").click();
  await group("project").waitFor({ state: "detached" });
  failLoadFor = second;
  await host.locator("[data-resource-install-target]").click();
  await page.getByRole("menuitemradio", { name: "子代理项目B", exact: true }).click();
  await host.getByRole("alert").getByText("fixture list failure", { exact: true }).waitFor();
  await host.getByRole("button", { name: "重试", exact: true }).click();
  await group("project").getByRole("button", { name: "项目B角色", exact: true }).waitFor();
  await host.locator("[data-resource-install-global]").click();
  await group("project").waitFor({ state: "detached" });
  await page.locator(".workspace-rail-skills").click();
  assert.equal(await page.locator('[data-settings-section="skills"] [data-resource-install-global]').getAttribute("aria-pressed"), "true", "技能目标仍为全局");
  await page.locator(".workspace-rail-settings").click();
  await page.locator(".settings-section-tabs").getByRole("button", { name: "子代理", exact: true }).click();
  // 界面译文和新建提示随语言切换；实际副本的英文指令仍按上文断言原样保存。
  for (const [locale, label] of [["en", "English"], ["zh-TW", "繁體中文"], ["zh-CN", "简体中文"]]) {
    const messages = getLocalePlugin(locale).messages;
    await page.locator(".settings-section-tabs button").first().click();
    await page.locator(".settings-language-option").filter({ hasText: label }).click();
    await page.waitForFunction(locale => document.documentElement.lang === locale, locale);
    await page.locator(".settings-section-tabs").getByRole("button", { name: messages["common.agents"], exact: true }).click();
    for (const name of ["explore", "general-purpose", "plan"]) {
      await host.getByRole("button", { name: messages[`agents.role.${name}.name`], exact: true }).click();
      assert.equal(await host.locator(".agents-prompt-preview").innerText(), messages[`agents.role.${name}.prompt`]);
    }
    await host.getByRole("button", { name: messages["agents.new"], exact: true }).click();
    assert.equal(await host.getByLabel(messages["agents.displayName"], { exact: true }).inputValue(), messages["agents.newDisplayName"]);
    assert.equal(await host.getByLabel(messages["agents.name"], { exact: true }).inputValue(), "custom-agent");
    assert.equal(await host.locator("#agents-profile-id-hint").innerText(), messages["agents.nameHint"]);
    for (const field of ["name", "displayName", "description", "prompt"]) {
      assert.equal(await host.getByLabel(messages[`agents.${field}`], { exact: true }).getAttribute("placeholder"), messages[`agents.${field}Placeholder`]);
    }
    if (locale === "zh-CN") await page.screenshot({ path: join(artifacts, "agents-create-localized.png") });
  }
  await host.getByRole("button", { name: "代码探查", exact: true }).click();
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.classList.add("dark"); });
  await page.screenshot({ path: join(artifacts, "agents-explore-dark.png") });
  await page.setViewportSize({ width: 720, height: 900 });
  assert.ok(await host.evaluate(node => node.scrollWidth <= node.clientWidth + 1), "中等宽度不横向溢出");
  await page.screenshot({ path: join(artifacts, "agents-medium.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await host.getByRole("heading", { name: "代码探查", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "窄屏无整页横向溢出");
  assert.ok(await host.evaluate(node => node.scrollWidth <= node.clientWidth + 1), "窄屏配置不横向溢出");
  await page.screenshot({ path: join(artifacts, "agents-mobile.png") });
  console.log("PASS 子代理角色中文展示、只读详情、总开关状态、副本保留运行配置、折叠字段保存、深浅主题与窄屏布局");
}
