import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** 四页使用同一隔离服务；逐帧观察实际绘制，避免只检查请求完成后的截图。 */
export async function checkResourceSwitching(page, base, artifacts, first) {
  const second = join(artifacts, "switch-b"); mkdirSync(second);
  assert.equal((await page.request.post(`${base}/api/projects`, { data: { action: "save", name: "项目B", folders: [{ path: second }], defaultPath: second } })).status(), 200);
  const profiles = await (await page.request.get(`${base}/api/subagents/profiles?scope=global`)).json();
  const builtin = profiles.profiles.find(profile => profile.scope === "builtin"); assert.ok(builtin);
  let latency = 20;
  const writes = [];
  await page.route("**/api/cwd/validate", async route => {
    const body = route.request().postDataJSON();
    await delay(10);
    await route.fulfill({ json: { cwd: body.cwd, projectRoot: body.cwd, projectKey: body.projectId } });
  });
  const tag = cwd => cwd === first ? "A" : "B";
  const totals = { extensions: 1, skills: 0, prompts: 0, themes: 0 };
  const skill = (name, cwd) => ({ name, description: name, filePath: join(cwd ?? artifacts, name, "SKILL.md"), baseDir: cwd ?? artifacts, source: cwd ? "project" : "user", sourceInfo: { scope: cwd ? "project" : "user", source: cwd ? "project" : "user" }, installOrigin: "app", disableModelInvocation: false, canRemove: true });
  const plugin = (name, cwd) => ({ packageName: name, source: `npm:${name}`, scope: cwd ? "project" : "global", installOrigin: "app", counts: totals, resources: [], status: "loaded", disabled: false, filtered: false, canCheckForUpdates: false });
  const server = (name, cwd) => ({ name, scope: cwd ? "project" : "global", sourcePath: join(cwd ?? artifacts, "mcp.json"), configKey: `${cwd}:${name}`, enabled: true, validated: true, transport: "http", url: "https://example.test/mcp", envNames: [], headerNames: [], usesOAuth: false, commandFields: [], variableReferences: [], masked: false });
  const project = cwd => ({ cwd, trust: { trusted: true, requiresTrust: false } });
  const overview = (kind, cwd) => {
    const marker = cwd ? `only-${tag(cwd)}` : "shared";
    if (kind === "skills") return { skills: [skill("shared", null), ...(cwd ? [skill(marker, cwd)] : [])], diagnostics: [], projectResourcesLoaded: true, globalSkillsPath: join(artifacts, "agent/skills") };
    if (kind === "plugins") return { packages: [plugin("shared", null), ...(cwd ? [plugin(marker, cwd)] : [])], standaloneExtensions: [], diagnostics: [], totals, projectResourcesLoaded: true, globalInstallPath: join(artifacts, "agent/npm") };
    if (kind === "agents") return { profiles: [builtin, { ...builtin, name: "shared", displayName: "shared", scope: "global", filePath: join(artifacts, "shared.md") }, ...(cwd ? [{ ...builtin, name: marker, displayName: marker, scope: "project", filePath: join(cwd, marker + ".md") }] : [])], globalAgentsPath: join(artifacts, "agent/agents"), projectAgentsPath: cwd ? join(cwd, ".pi/agents") : undefined };
    return { mcp: { available: true }, runtime: { enabled: true }, codemode: { sandbox: { state: "available" }, builtinDisabled: false, preference: "automatic" }, files: [{ scope: "global", path: join(artifacts, "agent/mcp.json"), exists: true, problems: [] }, ...(cwd ? [{ scope: "project", path: join(cwd, ".pi/mcp.json"), exists: true, problems: [] }] : [])], servers: [server("shared", null), ...(cwd ? [server(marker, cwd)] : [])], ...(cwd ? { project: project(cwd) } : {}) };
  };
  for (const kind of ["plugins", "skills", "agents", "mcp"]) {
    const endpoint = kind === "agents" ? "subagents/profiles" : kind;
    await page.route(new RegExp(`/api/${endpoint}(?:\\?.*)?$`), async route => {
      const request = route.request();
      if (request.method() !== "GET") { writes.push(request.url()); return route.fulfill({ status: 409, json: { error: "Unexpected write" } }); }
      const cwd = new URL(request.url()).searchParams.get("cwd");
      const wait = latency;
      await delay(wait);
      await route.fulfill({ json: overview(kind, cwd) });
    });
  }
  await page.reload();
  await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  await page.locator(".chat-message-area").getByText("Resource trust fixture", { exact: true }).waitFor();
  for (const kind of ["plugins", "skills", "agents", "mcp"]) {
    if (kind === "plugins" || kind === "skills") await page.locator(`.workspace-rail-${kind}`).click();
    else {
      if (!await page.locator(".settings-section-tabs").isVisible()) await page.locator(".workspace-rail-settings").click();
      await page.locator(".settings-section-tabs").getByRole("button", { name: kind === "agents" ? "子代理" : "MCP", exact: true }).click();
    }
    const workspace = page.locator(`[data-settings-section="${kind}"]`);
    const host = kind === "mcp" ? workspace.locator(".mcp-target-page:visible") : workspace;
    await host.locator(".config-sidebar").getByText("shared", { exact: true }).waitFor();
    assert.equal(await host.locator("[data-resource-install-global]").getAttribute("aria-pressed"), "true", `${kind} 目标独立`);
    const start = async () => {
      await page.evaluate(kind => {
        window.switchFrames = [];
        window.switchSampling = true;
        const sample = () => {
          const root = document.querySelector(`[data-settings-section="${kind}"]`);
          const panel = kind === "mcp" ? root.querySelector(".mcp-target-page:not([hidden])") : root;
          const sidebar = panel.querySelector(".config-sidebar");
          const toolbar = panel.querySelector(".resource-install-target");
          const rect = sidebar.getBoundingClientRect();
          window.switchFrames.push({ at: performance.now(), name: panel.querySelector(".resource-install-project-name")?.textContent ?? "global", text: sidebar.textContent, hint: toolbar.querySelector(".resource-install-target-status").textContent, top: rect.top, height: rect.height, scroll: document.documentElement.scrollTop });
          if (window.switchSampling) requestAnimationFrame(sample);
        }; requestAnimationFrame(sample);
      }, kind);
    };
    const choose = async name => {
      await host.locator("[data-resource-install-target]").click();
      await page.getByRole("menuitemradio", { name, exact: true }).click();
    };
    const finish = async expectHint => {
      const frames = await page.evaluate(() => { window.switchSampling = false; return window.switchFrames; });
      assert.ok(frames.length > 1);
      for (const frame of frames) {
        if (frame.name === "安装测试项目") { assert.ok(frame.text.includes("only-A"), `${kind} 项目A名称必须和内容同时切换`); assert.ok(!frame.text.includes("only-B")); }
        if (frame.name === "项目B") { assert.ok(frame.text.includes("only-B")); assert.ok(!frame.text.includes("only-A")); }
        assert.ok(!/加载/.test(frame.text), `${kind} 不用整页加载替换旧列表`);
        assert.equal(frame.top, frames[0].top, `${kind} 侧栏起点稳定`);
        assert.equal(frame.height, frames[0].height, `${kind} 侧栏高度稳定`);
        assert.equal(frame.scroll, frames[0].scroll, `${kind} 不自动滚动外层页面`);
      }
      assert.equal(frames.some(frame => /^正在(?:刷新|加载)/.test(frame.hint)), expectHint, `${kind} 仅慢请求提示加载：${JSON.stringify(frames.filter((frame, index) => !index || frame.hint !== frames[index - 1].hint || frame.name !== frames[index - 1].name).map(({ at, name, hint }) => ({ at, name, hint })))}`);
    };
    await start(); await choose("安装测试项目");
    await host.locator(".resource-install-project-name").getByText("安装测试项目", { exact: true }).waitFor();
    await host.locator(".config-sidebar").getByText("only-A", { exact: true }).waitFor({ state: "attached" });
    await delay(50); await finish(false);
    latency = 450;
    await start(); await choose("项目B");
    await host.locator(".resource-install-target-status").getByText(/^正在(?:刷新|加载)/).waitFor();
    assert.equal(await host.locator(".resource-install-project-name").innerText(), "安装测试项目", "慢请求期间保留原项目名称与内容");
    assert.equal(await host.locator("[data-resource-install-global]").isDisabled(), true, "切换期间暂停操作");
    await host.locator(".resource-install-project-name").getByText("项目B", { exact: true }).waitFor();
    await delay(50); await finish(true);
    latency = 20;
    await start(); await choose("安装测试项目");
    await host.locator(".resource-install-project-name").getByText("安装测试项目", { exact: true }).waitFor();
    await delay(100); await finish(false);
    await page.screenshot({ path: join(artifacts, `${kind}-stable-switch.png`) });
  }
  assert.deepEqual(writes, [], "切换只读取配置，不安装、不授权、不连接或写入配置");
  console.log("PASS 四页快速切换无加载闪烁、慢请求延后提示、名称内容原子切换、返回缓存、尺寸滚动稳定、独立目标");
}
