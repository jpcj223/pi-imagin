import assert from "node:assert/strict";

// 浏览器与桌面复用隔离响应；目录与来源接口另做真实只读验证。
export async function checkPluginsWorkspace(page,{capture=async()=>{}}={}) {
  await page.evaluate(()=>{localStorage.removeItem("pi-plugin-description-translation");localStorage.removeItem("pi-plugin-description-cache");localStorage.removeItem("pi-plugin-description-local-cache");localStorage.setItem("pi-plugin-description-translation",JSON.stringify({enabled:true,provider:"old-paid-provider",id:"old-model"}));});
  const totals={extensions:0,skills:0,prompts:0,themes:0};
  let packages=[],failInstall=true,failCatalog=false,failDetail=false,failMore=true;
  const actions=[],searches=[],details=[],translations=[];
  const item=name=>({name,source:`npm:${name}`,description:`Search files with ${name}`,author:"Example author",types:["extension"],url:`https://pi.dev/packages/${name}`});
  const makePackage=name=>({source:`npm:${name}`,packageName:name,scope:"global",version:"1.0.0",description:`Installed ${name}`,installedPath:`C:/isolated/${name}`,canCheckForUpdates:false,disabled:false,filtered:false,status:"loaded",counts:{...totals,extensions:1},resources:[{kind:"extension",name:"index",path:`C:/isolated/${name}/index.ts`,relativePath:"index.ts"}]});
  const snapshot=()=>({packages,standaloneExtensions:[],totals:{...totals,extensions:packages.length},diagnostics:[],projectResourcesLoaded:false});
  const handler=async route=>{
    if(route.request().method()==="GET")return route.fulfill({json:snapshot()});
    const body=route.request().postDataJSON();actions.push(body);
    if(body.action==="install"){
      if(failInstall)return route.fulfill({status:502,json:{error:"Fixture install failed"}});
      packages=[makePackage(body.source.slice(4)),...Array.from({length:40},(_,i)=>makePackage(`installed-${i}`))];
    }else if(body.action==="enable"||body.action==="disable")packages=packages.map(pkg=>pkg.source===body.source?{...pkg,disabled:body.action==="disable",status:body.action==="disable"?"disabled":"loaded"}:pkg);
    else if(body.action==="remove")packages=packages.filter(pkg=>pkg.source!==body.source);
    return route.fulfill({json:snapshot()});
  };
  const catalogHandler=async route=>{
    const query=new URL(route.request().url()).searchParams;searches.push(Object.fromEntries(query));
    if(failCatalog)return route.fulfill({status:502,json:{error:"unavailable"}});
    const second=query.get("page")==="2",empty=query.get("q")==="no-match";
    if(second&&query.get("q")==="more-failure"&&failMore)return route.fulfill({status:502,json:{error:"next page unavailable"}});
    if(second)await new Promise(resolve=>setTimeout(resolve,400));
    if(query.get("q")==="obsolete")await new Promise(resolve=>setTimeout(resolve,800));
    return route.fulfill({json:{items:empty?[]:second?[item("pi-demo"),item("second-page")]:[item("pi-demo"),...Array.from({length:49},(_,i)=>item(`catalog-${i}`))],page:second?2:1,total:empty?0:51,hasNext:!second&&!empty}});
  };
  const detailHandler=async route=>{
    const name=new URL(route.request().url()).searchParams.get("name");details.push(name);
    if(failDetail)return route.fulfill({status:502,json:{error:"unavailable"}});
    return route.fulfill({json:{name,description:`Full description for ${name}`,version:"2.1.0",author:"Example author",license:"MIT",dependencies:"2 dependencies",repository:"https://github.com/example/plugin",readmeHtml:'<h2>Fixture usage</h2><p>Configure the plugin here.</p><pre><code>npm example</code></pre><script>window.__pluginInjection=true</script><iframe src="https://evil.invalid"></iframe><a href="file:///C:/private">Unsafe file</a><img src="file:///C:/private" onerror="window.__pluginInjection=true">',partial:false}});
  };
  // 旧偏好存在时也不得发起翻译请求。
  const translationHandler=async route=>{translations.push(route.request().method());return route.abort();};
  const logoHandler=async route=>route.fulfill({json:{}});
  await page.route("**/api/plugins",handler);await page.route("**/api/plugins?*",handler);
  await page.route("**/api/plugins/search?*",catalogHandler);await page.route("**/api/plugins/detail?*",detailHandler);await page.route("**/api/plugins/translate",translationHandler);
  await page.route("**/api/plugins/logos?*",logoHandler);
  const rail=page.locator(".workspace-rail"),panel=page.locator(".plugins-workspace-page"),manager=panel.locator(".plugins-manager"),main=manager.locator(".config-detail"),cards=manager.locator(".plugin-card");
  const back=()=>manager.getByRole("button",{name:/Back to plugins/}).click();
  try{
    await page.evaluate(()=>sessionStorage.removeItem("pi-plugin-catalog-home-v1"));
    const warmed=page.waitForResponse(response=>response.url().includes("/api/plugins/search?")&&new URL(response.url()).searchParams.get("q")==="");
    await page.reload();await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();await warmed;
    await rail.locator(".workspace-rail-plugins").click();await cards.first().waitFor();
    assert.equal(searches.filter(query=>query.q===""&&query.page==="1").length,1,"首次打开复用空闲时预热的首页");
    assert.equal(await manager.locator(".plugins-modes").count(),0);assert.equal(await panel.locator(".settings-dialog-close,.workspace-back").count(),0);
    assert.ok((await panel.locator(".settings-dialog-header").boundingBox()).height<=40);
    assert.ok((await manager.locator(".config-footer").boundingBox()).height<=40);
    assert.equal(await manager.locator(".plugins-sidebar-empty").count(),1);assert.equal(await manager.locator(".plugins-content").getByText("No plugins installed yet.",{exact:true}).count(),0);
    assert.equal(translations.length,0);
    const search=manager.locator(".plugins-catalog-heading").getByRole("searchbox"),installedSearch=manager.locator(".config-sidebar").getByRole("searchbox");
    const query=async value=>{const result=page.waitForResponse(response=>response.url().includes("/api/plugins/search?")&&new URL(response.url()).searchParams.get("q")===value);await search.fill(value);await result;};
    await installedSearch.fill("missing-installed");assert.equal(await cards.count(),50);await installedSearch.fill("");
    const preloaded=page.waitForResponse(response=>response.url().includes("/api/plugins/search?")&&new URL(response.url()).searchParams.get("q")==="mcp & tools"&&new URL(response.url()).searchParams.get("page")==="2");
    await query("mcp & tools");await cards.first().waitFor();await preloaded;assert.equal(await cards.count(),50,"远离底部时已预取下一批，暂不追加或抓取第三批");
    await main.evaluate(node=>node.scrollTop=520);const scroll=await main.evaluate(node=>node.scrollTop);
    await cards.nth(12).getByRole("button",{name:"catalog-11",exact:true}).click();
    await manager.getByRole("heading",{name:"Fixture usage",exact:true}).waitFor();
    assert.ok(await manager.getByText("Full description for catalog-11",{exact:true}).isVisible());
    assert.equal(await manager.locator(".plugin-readme script,.plugin-readme iframe,.plugin-readme [onerror]").count(),0);
    assert.equal(await page.evaluate(()=>window.__pluginInjection),undefined);
    assert.equal(await manager.locator('.plugin-readme a[href^="file:"]').count(),0);
    await page.locator(".workspace-rail-settings").click();
    await page.locator(".workspace-rail-settings").click();
    await manager.getByRole("heading",{name:"Fixture usage",exact:true}).waitFor();
    assert.ok(await manager.getByText("Full description for catalog-11",{exact:true}).isVisible(),"关闭设置返回原插件详情");
    await capture(page,"plugin-detail");await back();await cards.first().waitFor();
    assert.equal(await search.inputValue(),"mcp & tools");assert.ok(Math.abs((await main.evaluate(node=>node.scrollTop))-scroll)<=2,"详情返回恢复目录滚动");
    await page.waitForFunction(()=>document.querySelectorAll('.plugin-card').length===50);
    await main.evaluate(node=>node.scrollTop=node.scrollHeight-node.clientHeight-500);const beforeAppend=await main.evaluate(node=>node.scrollTop);
    await cards.filter({hasText:"second-page"}).waitFor();assert.equal(await cards.count(),51,"追加页面去重，不替换原列表");
    assert.ok(Math.abs((await main.evaluate(node=>node.scrollTop))-beforeAppend)<2,"追加卡片不跳动");
    await cards.last().getByRole("button",{name:"second-page",exact:true}).click();await manager.getByRole("heading",{name:"Fixture usage",exact:true}).waitFor();await back();
    assert.equal(await cards.count(),51);assert.equal(await manager.locator('.plugins-pagination').count(),0);await main.evaluate(node=>node.scrollTop=0);
    const detailCount=details.length;
    await cards.first().getByRole("button",{name:"Install",exact:true}).click();await manager.getByText("Fixture install failed",{exact:true}).waitFor();assert.equal(details.length,detailCount,"安装不误触详情");
    failInstall=false;await cards.first().getByRole("button",{name:"Install",exact:true}).click();await cards.first().getByRole("button",{name:"Installed",exact:true}).waitFor();
    assert.equal(actions.at(-1).scope,"global");await installedSearch.fill("PI-DEMO");assert.equal(await manager.locator(".config-sidebar-item").count(),1);
    await capture(page,"plugins-catalog");await manager.locator(".config-sidebar-item").click();await manager.getByText("Resources found",{exact:true}).waitFor();
    await manager.getByRole("heading",{name:"Fixture usage",exact:true}).waitFor();await manager.getByRole("switch",{name:"Disable package",exact:true}).click();await manager.getByRole("switch",{name:"Enable package",exact:true}).waitFor();
    const before=actions.length;await manager.getByRole("button",{name:"Remove",exact:true}).click();await manager.locator(".plugins-remove-confirm").getByRole("button",{name:"Cancel",exact:true}).click();assert.equal(actions.length,before);
    await back();failDetail=true;await cards.nth(1).getByRole("button",{name:"catalog-0",exact:true}).click();await manager.getByRole("button",{name:"Retry",exact:true}).waitFor();failDetail=false;await manager.getByRole("button",{name:"Retry",exact:true}).click();await manager.getByRole("heading",{name:"Fixture usage",exact:true}).waitFor();await back();
    await query("more-failure");await cards.first().waitFor();await main.evaluate(node=>node.scrollTop=node.scrollHeight);await manager.getByText("Could not load more plugins. Your current list is preserved.",{exact:true}).waitFor();assert.equal(await cards.count(),50);failMore=false;await manager.getByRole("button",{name:"Retry",exact:true}).click();await cards.filter({hasText:"second-page"}).waitFor();assert.equal(await cards.count(),51);
    const obsolete=page.waitForRequest(request=>request.url().includes("/api/plugins/search?")&&new URL(request.url()).searchParams.get("q")==="obsolete");await search.fill("obsolete");await obsolete;await query("mcp-fresh");await cards.first().waitFor();assert.equal(await search.inputValue(),"mcp-fresh");assert.equal(await cards.count(),50);
    failCatalog=true;await query("failure");await manager.getByRole("button",{name:"Retry",exact:true}).waitFor();assert.equal(await cards.count(),0);failCatalog=false;await manager.getByRole("button",{name:"Retry",exact:true}).click();await cards.first().waitFor();
    await query("no-match");await manager.getByText("No matching plugins. Try another search.",{exact:true}).waitFor();await query("mcp");await cards.first().waitFor();
    await main.evaluate(node=>node.scrollTop=300);const retainedScroll=await main.evaluate(node=>node.scrollTop);
    const installedWidth=(await manager.locator('.config-sidebar').boundingBox()).width;
    await page.locator(".workspace-rail-settings").click();const settings=page.locator(".settings-workspace-page:visible");
    assert.equal((await settings.locator('.settings-section-tabs').boundingBox()).width,installedWidth,"插件与设置侧栏宽度一致");
    await settings.getByRole("button",{name:"Models",exact:true}).click();await settings.locator(".models-sidebar-indented-item:not(.models-sidebar-add-item)").first().click();await settings.getByPlaceholder("Display name",{exact:true}).fill("Unsaved model label");
    await page.locator(".workspace-rail-settings").click();await panel.waitFor({state:'visible'});
    assert.equal(await installedSearch.inputValue(),"PI-DEMO");assert.equal(await search.inputValue(),"mcp");
    assert.ok(Math.abs((await main.evaluate(node=>node.scrollTop))-retainedScroll)<=2,"重复点击设置返回原插件滚动位置");
    await page.locator(".workspace-rail-settings").click();assert.equal(await settings.getByPlaceholder("Display name",{exact:true}).inputValue(),"Unsaved model label");
    await page.keyboard.press('Escape');await panel.waitFor({state:'visible'});assert.equal(await search.inputValue(),"mcp");
    await page.locator(".workspace-rail-settings").click();await page.locator('.workspace-rail [data-rail-item="home"]').click();await page.locator('.settings-workspace-page:visible').waitFor({state:'hidden'});
    await page.locator(".workspace-rail-settings").click();await page.locator(".workspace-rail-settings").click();await page.locator('.settings-workspace-page:visible').waitFor({state:'hidden'});
    await rail.locator(".workspace-rail-plugins").click();await page.locator(".workspace-rail-settings").click();
    await settings.getByRole("button",{name:"General",exact:true}).click();await settings.locator(".settings-theme-option").filter({hasText:/^Dark$/}).click();await rail.locator(".workspace-rail-plugins").click();await capture(page,"plugins-dark");
    const viewport=page.viewportSize();await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.sidebar-overlay-backdrop')).opacity==='0'&&document.querySelector('.plugins-workspace-page').getBoundingClientRect().left===0);
    await manager.getByRole("button",{name:"Installed (41)",exact:true}).click();assert.equal(await manager.locator(".config-detail").isVisible(),false);await manager.getByRole("button",{name:"Browse plugins →",exact:true}).click();await cards.first().waitFor();
    await capture(page,"plugins-mobile");const size=await panel.evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));assert.ok(size.scroll<=size.width+1);
    await panel.getByRole("button",{name:"Home",exact:true}).click();await panel.waitFor({state:"hidden"});await page.setViewportSize(viewport??{width:1440,height:1000});
    await page.locator(".workspace-rail-settings").click();await settings.locator(".settings-theme-option").filter({hasText:/^Light$/}).click();await settings.locator(".settings-language-option").filter({hasText:"简体中文"}).click();await rail.locator(".workspace-rail-plugins").click();await cards.first().waitFor();
    await cards.first().getByText("Search files with pi-demo",{exact:true}).waitFor();
    assert.equal(await manager.locator(".plugin-local-translation,.plugin-translation-control,.plugin-description>button").count(),0);
    await capture(page,"plugins-chinese");
    await page.locator(".workspace-rail-settings").click();await settings.locator(".settings-language-option").filter({hasText:"繁體中文"}).click();await rail.locator(".workspace-rail-plugins").click();
    await cards.first().getByText("Search files with pi-demo",{exact:true}).waitFor();
    await main.evaluate(node=>node.scrollTop=node.scrollHeight);await cards.last().getByText("Search files with second-page",{exact:true}).waitFor();
    assert.equal(translations.length,0,"切换应用语言仍只显示来源描述，不请求翻译");
    await page.locator(".workspace-rail-settings").click();await settings.locator(".settings-language-option").filter({hasText:"English"}).click();await rail.locator(".workspace-rail-plugins").click();await manager.locator(".config-sidebar-item").click();await manager.getByRole("button",{name:"Remove",exact:true}).click();await manager.locator(".plugins-remove-confirm").getByRole("button",{name:"Remove",exact:true}).click();
    await page.locator('.workspace-rail [data-rail-item="home"]').click();assert.equal(await page.locator("#session-sidebar").getAttribute("inert"),null);
    await rail.getByRole("button",{name:"搜索会话",exact:true}).click();await page.locator(".workspace-search-dialog").waitFor();
    const chrome=await page.evaluate(()=>({desktop:document.documentElement.dataset.desktop,bar:document.querySelector('.workspace-titlebar').getBoundingClientRect().bottom,backdrop:document.querySelector('.workspace-search-backdrop').getBoundingClientRect().top,overlay:navigator.windowControlsOverlay?.getTitlebarAreaRect().height}));
    if(chrome.desktop){assert.ok(Math.abs(chrome.bar-chrome.backdrop)<1);if(chrome.overlay)assert.ok(Math.abs(chrome.overlay-chrome.bar)<=2,JSON.stringify(chrome));}else assert.equal(chrome.backdrop,0);
    await capture(page,"search-chrome");await page.keyboard.press("Escape");
    console.log("PASS: 首页预热复用、滚动预取追加去重、失败保留和重试、搜索取消、详情位置恢复、安装管理、草稿、窄屏主题语言和标题栏");
  }finally{
    await page.unroute("**/api/plugins",handler);await page.unroute("**/api/plugins?*",handler);await page.unroute("**/api/plugins/search?*",catalogHandler);await page.unroute("**/api/plugins/detail?*",detailHandler);await page.unroute("**/api/plugins/translate",translationHandler);
    await page.unroute("**/api/plugins/logos?*",logoHandler);
  }
}
