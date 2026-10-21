import assert from "node:assert/strict";

// 只验证 ID 输入交互；候选接口受控，不发送模型推理请求。
export async function checkModelIdSuggestions(page, {capture = async () => {}} = {}) {
  const fixture = {providers: {demo: {baseUrl: "https://example.invalid/v1", api: "openai-responses", models: [{id:"start", name:"Existing display"}]}}};
  const models = Array.from({length:60}, (_, i) => ({id:`vendor/model-${String(i).padStart(2,"0")}`, name:`Model ${String(i).padStart(2,"0")}`}));
  const requests = [], saves = [];
  let release, delayFirst = true, fail = false;
  const routes = {
    "**/api/models-config": route => {
      if (route.request().method() === "PUT") {saves.push(route.request().postDataJSON()); return route.fulfill({json:{success:true}});}
      return route.fulfill({json:fixture});
    },
    "**/api/auth/providers": route => route.fulfill({json:{oauthProviders:[],apiKeyProviders:[]}}),
    "**/api/models/enabled*": route => route.fulfill({json:{providers:[],allEnabled:true,patterns:null,stalePatterns:[],enabledTotal:0,availableTotal:0,editable:true,scope:"global",settingsPath:"isolated/settings.json"}}),
    "**/api/models-config/discover": async route => {
      requests.push(route.request().postDataJSON());
      if (delayFirst) {delayFirst=false; await new Promise(resolve=>release=resolve);}
      return route.fulfill(fail ? {status:502,json:{error:"fixture failure"}} : {json:{models}});
    },
  };
  for (const [url, handler] of Object.entries(routes)) await page.route(url, handler);
  const openEditor = async () => {
    await page.reload();
    await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
    await page.getByRole("button",{name:/^(设置|Settings)$/,exact:true}).click();
    const settings = page.getByRole("region",{name:"Settings",exact:true});
    await settings.getByRole("button",{name:"Models",exact:true}).click();
    await settings.locator(".models-sidebar-indented-item:not(.models-sidebar-add-item)").filter({hasText:/^start$/}).click();
    return settings;
  };
  try {
    let settings = await openEditor();
    let input = settings.getByRole("combobox",{name:"ID",exact:true});
    let list = settings.getByRole("listbox",{name:"Model ID suggestions",exact:true});
    await input.click();
    await list.waitFor();
    while (!release) await new Promise(resolve=>setTimeout(resolve,10));
    release();
    await list.getByRole("option").nth(59).waitFor();
    assert.equal(await list.getByRole("option").count(),60);
    assert.equal(requests[0].provider.api,"openai-responses");
    assert.equal(requests[0].provider.models,undefined);
    await list.hover();await page.mouse.wheel(0,1600);
    await page.waitForFunction(()=>document.querySelector('.model-id-options')?.scrollTop>0);
    await capture(page,"id-list");
    await list.getByRole("option").last().click();
    assert.equal(await input.inputValue(),"vendor/model-59");
    assert.equal(await settings.getByPlaceholder("Display name",{exact:true}).inputValue(),"Existing display");
    assert.equal(saves.length,0,"选中候选只填 ID，不保存或修改其他字段");
    assert.equal(await input.getAttribute("aria-expanded"),"false");

    await input.click();
    assert.equal(await list.getByRole("option").count(),60,"再次点击应可浏览完整列表");
    await input.fill("MoDeL 07");
    assert.equal(await list.getByRole("option").count(),1,"名称筛选忽略大小写");
    await input.press("ArrowDown");await input.press("Enter");
    assert.equal(await input.inputValue(),"vendor/model-07");
    assert.equal(requests.length,1,"键入、选择和再次打开不重复获取列表");

    await input.click();await input.press("Escape");
    assert.equal(await input.getAttribute("aria-expanded"),"false");
    assert.equal(await settings.isVisible(),true,"Escape 不关闭设置");
    await input.click();await input.fill("local/private:latest");
    await settings.getByText("No matches. You can still enter an ID manually.",{exact:true}).waitFor();
    await settings.getByPlaceholder("Display name",{exact:true}).click();
    assert.equal(await input.inputValue(),"local/private:latest");
    await settings.locator('.config-footer').getByRole("button",{name:"Save",exact:true}).click();
    await settings.locator('.config-footer').getByText("Saved",{exact:true}).waitFor();
    assert.equal(saves[0].providers.demo.models[0].id,"local/private:latest");

    fail=true;
    settings=await openEditor();input=settings.getByRole("combobox",{name:"ID",exact:true});
    await input.click();
    await settings.getByText("Could not load models. You can still enter an ID manually.",{exact:true}).waitFor();
    await input.fill("custom-offline");assert.equal(await input.inputValue(),"custom-offline");
    fail=false;
    await settings.locator('.model-id-popup').getByRole("button",{name:"Refresh",exact:true}).click();
    await settings.getByText("Choose a suggestion or enter a custom ID.",{exact:true}).waitFor();
    await input.fill("");
    assert.equal(await settings.getByRole("option").count(),60);
    await input.press("Tab");
    assert.equal(await input.getAttribute("aria-expanded"),"false");
    console.log("PASS: ID 点击列表、滚动、筛选、鼠标/键盘选择、缓存、关闭、自由输入及失败重试");
    await settings.getByRole("button",{name:"Close",exact:true}).click();
  } finally {
    release?.();
    for (const [url, handler] of Object.entries(routes)) await page.unroute(url,handler);
  }
}
