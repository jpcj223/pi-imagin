import assert from "node:assert/strict";
import { join } from "node:path";

/** 两端复用同一验收：设置导航、未保存配置、模型错误与紧凑项目菜单。 */
export async function checkWorkspaceNavigation(page, label, artifacts) {
  await page.route("**/api/models?**",route=>route.fulfill({json:{models:{"test-provider:test-model":"本地测试模型"},modelList:[{id:"test-model",provider:"test-provider",name:"本地测试模型"}],defaultModel:{provider:"test-provider",modelId:"test-model"},defaultThinkingLevel:"off",thinkingLevels:{},thinkingLevelMaps:{},thinkingLevelPins:{}}}));
  await page.reload();await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  const input=page.locator(".chat-input-textarea"),settings=page.getByRole("region",{name:"设置",exact:true});
  const rail=page.getByRole("navigation",{name:"全局导航",exact:true});
  const openSettings=async()=>{await page.locator(".workspace-rail-settings").click();await settings.waitFor();};
  await input.fill("返回工作区应保留草稿");
  await openSettings();await settings.locator(".settings-section-tabs").getByRole("button",{name:"模型",exact:true}).click();
  await settings.getByRole("button",{name:"添加 Provider",exact:true}).click();
  await page.getByRole("button",{name:/OpenAI \/ Anthropic compatible/}).click();
  const provider=settings.getByPlaceholder("provider-name");await provider.fill("尚未保存的配置");
  await page.locator('.workspace-rail [data-rail-item="home"]').click();await settings.waitFor({state:"hidden"});
  assert.equal(await input.inputValue(),"返回工作区应保留草稿");
  await openSettings();assert.equal(await provider.inputValue(),"尚未保存的配置");
  await rail.getByRole("button",{name:"搜索会话",exact:true}).click();await settings.waitFor({state:"hidden"});
  await page.getByRole("dialog").waitFor();await page.keyboard.press("Escape");
  await openSettings();await page.locator(".workspace-project-heading button").click();
  await settings.waitFor({state:"hidden"});const create=page.getByRole("dialog",{name:"创建项目",exact:true});await create.waitFor();await create.getByRole("button",{name:"取消",exact:true}).click();
  await openSettings();const before=await page.evaluate(()=>JSON.parse(sessionStorage.getItem("pi-web:tab-open-session")??"null")?.draftId);
  await page.locator(".sidebar-new-button").click();await settings.waitFor({state:"hidden"});
  await page.waitForFunction(before=>JSON.parse(sessionStorage.getItem("pi-web:tab-open-session")??"null")?.draftId!==before,before);
  await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  await page.locator(".new-session-project-selector").click();const menu=page.getByRole("menu");await menu.waitFor();
  const box=await menu.boundingBox();assert.ok(box.width>=220&&box.width<=260);
  const row=await menu.getByRole("menuitemradio").first().boundingBox();assert.ok(row.height>=30&&row.height<=36);
  await menu.evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
  await page.screenshot({path:join(artifacts,`navigation-${label}-menu.png`)});await page.keyboard.press("Escape");
  await page.route("**/api/agent/new",route=>route.fulfill({status:409,json:{error:"No API key found for the selected model.\nUse /login. See: C:\\internal\\providers.md"}}));
  await input.fill("检查缺少认证的提示");await page.locator(".workspace-send").click();
  const notice=page.locator(".model-problem-notice");await notice.getByText(/当前模型缺少认证配置/).waitFor();
  assert.equal((await notice.innerText()).includes("C:\\internal"),false);
  await notice.getByText("技术信息",{exact:true}).click();await notice.getByText(/C:\\internal/).waitFor();
  await notice.getByRole("button",{name:"前往模型设置",exact:true}).click();await settings.waitFor();
  assert.equal(await provider.inputValue(),"尚未保存的配置");
  await page.locator('.workspace-rail [data-rail-item="home"]').click();await settings.waitFor({state:"hidden"});
  await page.screenshot({path:join(artifacts,`navigation-${label}-notice.png`)});
  await page.unroute("**/api/agent/new");
  return {client:label,menuWidth:box.width,rowHeight:row.height,passed:true};
}
