import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { showSidebarSessions } from "./sidebar.mjs";
import { checkEmptyProject } from "./empty-projects.mjs";

/** 实际前后端的项目 CRUD 与新会话目录选择；只创建临时目录，不发起模型请求。 */
export async function checkProjects(page, projectRoot, api, viewportWidth, artifacts) {
  const originalUrl=page.url();
  const frontend=join(projectRoot,"managed-frontend");
  const backend=join(projectRoot,"managed-backend");
  mkdirSync(frontend,{recursive:true});mkdirSync(backend,{recursive:true});
  await page.locator(".chat-content").waitFor({state:"visible"});
  const sidebar=page.locator(".session-sidebar");
  const showSidebar=page.getByRole("button",{name:"Show sidebar",exact:true});
  await showSidebar.or(page.getByRole("button",{name:"Hide sidebar",exact:true})).waitFor({state:"visible"});
  if(await showSidebar.isVisible()) await showSidebar.click();
  await showSidebarSessions(page);
  const dialog=page.getByRole("dialog",{name:"创建项目",exact:true});
  await page.getByRole("button",{name:"添加项目",exact:true}).click();await dialog.waitFor();
  const name=`E2E 多目录 ${viewportWidth}`;
  await dialog.getByRole("textbox",{name:"项目名称",exact:true}).fill(name);
  // Esc 只关闭子选择器，不能丢弃父级项目草稿。
  await dialog.getByRole("button",{name:"添加文件夹",exact:true}).click();
  const picker=page.locator(".directory-picker-backdrop");await picker.waitFor();
  await picker.locator("input").first().dispatchEvent("keydown",{key:"Escape",isComposing:true});
  assert.equal(await picker.isVisible(),true);
  // 按钮获得焦点时也不能把取消键传成全局停止运行。
  await picker.getByRole("button",{name:"Cancel",exact:true}).focus();
  await page.evaluate(()=>{window.__projectEscBubbled=false;window.addEventListener("keydown",event=>{if(event.key==="Escape")window.__projectEscBubbled=true;},{once:true});});
  await page.keyboard.press("Escape");await picker.waitFor({state:"detached"});
  assert.equal(await page.evaluate(()=>window.__projectEscBubbled),false);
  assert.equal(await dialog.isVisible(),true);
  assert.equal(await dialog.getByRole("textbox",{name:"项目名称",exact:true}).inputValue(),name);
  await dialog.getByText("粘贴路径或使用最近目录",{exact:true}).click();
  const addPath=async path=>{
    await dialog.getByRole("textbox",{name:"文件夹路径",exact:true}).fill(path);
    await dialog.getByRole("button",{name:"添加",exact:true}).click();
    await dialog.getByText(path,{exact:true}).first().waitFor();
  };
  await addPath(frontend);await addPath(backend);
  await dialog.getByRole("button",{name:"设为默认",exact:true}).click();
  if(artifacts) await dialog.screenshot({path:join(artifacts,`project-create-${viewportWidth}.png`)});
  await dialog.getByRole("button",{name:"创建项目",exact:true}).click();await dialog.waitFor({state:"detached"});
  let state=(await api("/api/projects")).state;const project=state.projects.find(p=>p.name===name);
  assert.ok(project);assert.equal(project.folders.length,2);
  assert.equal(project.folders.find(f=>f.id===project.defaultFolderId).path.toLowerCase(),backend.toLowerCase());
  const row=sidebar.locator(`[data-row-key="group:managed:${project.id}"]`);
  await row.waitFor();
  const groupMenu=async()=>{
    await showSidebarSessions(page);
    await row.hover();
    await row.locator('.session-tree-group-actions [aria-haspopup="menu"]').click();
  };
  await groupMenu();await page.getByRole("menuitem",{name:"编辑项目",exact:true}).click();
  const edit=page.getByRole("dialog",{name:"编辑项目",exact:true});await edit.waitFor();
  await edit.getByRole("textbox",{name:"项目名称",exact:true}).fill(name+" 已修改");
  await edit.getByRole("button",{name:"保存",exact:true}).click();await edit.waitFor({state:"detached"});
  state=(await api("/api/projects")).state;assert.equal(state.projects.find(p=>p.id===project.id).name,name+" 已修改");
  await groupMenu();await page.getByRole("menuitem",{name:"在项目中新建会话",exact:true}).click();
  const start=page.getByRole("dialog",{name:"在项目中新建会话",exact:true});await start.waitFor();
  assert.equal((await start.getByRole("combobox").inputValue()).toLowerCase(),backend.toLowerCase());
  await start.getByRole("combobox").selectOption(project.folders.find(f=>f.path.toLowerCase()===frontend.toLowerCase()).path);
  // 在触发模型前停止，目录选择交由真实的新会话工作区处理。
  await start.getByRole("button",{name:"新建会话",exact:true}).click();await start.waitFor({state:"detached"});
  await page.waitForFunction(id=>Object.keys(sessionStorage).some(key=>{try{const value=JSON.parse(sessionStorage.getItem(key));return value?.kind==="new"&&value.projectId===id;}catch{return false;}}),project.id);
  await page.waitForURL(url=>url.searchParams.get("cwd")?.toLowerCase()===frontend.toLowerCase());
  // 全局新建沿用当前项目及其目录，刷新恢复同一个未发送草稿。
  const previousDraft=await page.evaluate(()=>JSON.parse(sessionStorage.getItem("pi-web:tab-open-session")??"null")?.draftId);
  await showSidebarSessions(page);
  await sidebar.locator(".sidebar-new-button").click();
  await page.waitForFunction(({id,draft})=>{
    const value=JSON.parse(sessionStorage.getItem("pi-web:tab-open-session")??"null");
    return value?.projectId===id&&value.draftId&&value.draftId!==draft;
  },{id:project.id,draft:previousDraft});
  await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  await page.locator(".chat-input-textarea").fill("项目草稿刷新应保留");
  await page.reload({waitUntil:"domcontentloaded"});
  await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  assert.equal(await page.locator(".chat-input-textarea").inputValue(),"项目草稿刷新应保留");
  // 项目身份与执行目录分开选择，取消添加不能把草稿变成另一个项目。
  const projectSelector=page.locator(".new-session-project-selector");
  const directorySelector=page.locator(".new-session-directory-selector");
  const projectMenu=page.getByRole("menu");
  await projectSelector.click();
  await projectMenu.getByText(name+" 已修改",{exact:true}).waitFor();
  assert.equal(await projectMenu.getByText("自定义路径…",{exact:true}).count(),0);
  await projectMenu.getByText(name+" 已修改",{exact:true}).click();
  assert.equal(new URL(page.url()).searchParams.get("cwd").toLowerCase(),frontend.toLowerCase());
  const revision=state.revision;
  for(const target of [backend,frontend]) {
    await directorySelector.click();
    await projectMenu.getByText(project.folders.find(folder=>folder.path===target).name,{exact:true}).click();
    await page.waitForFunction(({id,cwd})=>{
      const value=JSON.parse(sessionStorage.getItem("pi-web:tab-open-session")??"null");
      return value?.projectId===id&&value.cwd.toLowerCase()===cwd;
    },{id:project.id,cwd:target.toLowerCase()});
    assert.equal(await page.locator(".chat-input-textarea").inputValue(),"项目草稿刷新应保留");
  }
  assert.equal((await api("/api/projects")).state.revision,revision);
  await projectSelector.click();await projectMenu.getByText("添加项目",{exact:true}).click();
  await dialog.waitFor();assert.equal(await picker.count(),0);
  await dialog.getByRole("textbox",{name:"项目名称",exact:true}).fill("取消添加应保留原项目");
  await page.keyboard.press("Escape");await dialog.waitFor({state:"detached"});
  assert.equal(await page.locator(".chat-input-textarea").inputValue(),"项目草稿刷新应保留");
  assert.equal(await projectSelector.evaluate(element=>element===document.activeElement),true);
  // 预期失败使用独立页面，主流程仍严格检查没有浏览器错误。
  const verification=await page.context().newPage();
  const tabMemory=await page.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).map(key=>[key,sessionStorage.getItem(key)])));
  await verification.addInitScript(memory=>{for(const [key,value] of Object.entries(memory))sessionStorage.setItem(key,value);},tabMemory);
  const consoleErrors=[],pageErrors=[];
  verification.on("console",message=>{if(message.type()==="error")consoleErrors.push(message.text());});
  verification.on("pageerror",error=>pageErrors.push(error.message));
  const newRoute="**/api/agent/*";
  await verification.route(newRoute,route=>{
    if(route.request().method()==="POST")return route.fulfill({status:409,json:{error:"E2E project scope verification"}});
    return route.continue();
  });
  try {
    await verification.goto(page.url(),{waitUntil:"domcontentloaded"});
    const request=verification.waitForRequest(req=>req.method()==="POST"&&/^\/api\/agent\/[^/]+$/.test(new URL(req.url()).pathname));
    const textarea=verification.locator(".chat-input-textarea");await textarea.fill("E2E verify project identity");
    await verification.getByRole("button",{name:"Send",exact:true}).click();
    const sent=await request;assert.equal(new URL(sent.url()).pathname,"/api/agent/new");
    const body=sent.postDataJSON();assert.equal(body.projectId,project.id);assert.equal(body.cwd.toLowerCase(),frontend.toLowerCase());
    await verification.getByText(/E2E project scope verification/).first().waitFor();
    assert.deepEqual(pageErrors,[]);
    assert.ok(consoleErrors.some(error=>error.includes("E2E project scope verification")));
    assert.ok(consoleErrors.every(error=>error.includes("E2E project scope verification")||error==="Failed to load resource: the server responded with a status of 409 (Conflict)"),consoleErrors.join("\n"));
  } finally {await verification.close();}
  await groupMenu();await page.getByRole("menuitem",{name:"编辑项目",exact:true}).click();
  await edit.getByRole("button",{name:"移除项目",exact:true}).click();
  await page.getByRole("dialog",{name:"移除项目",exact:true}).getByRole("button",{name:"确认移除",exact:true}).click();
  await page.getByRole("dialog",{name:"移除项目",exact:true}).waitFor({state:"detached"});
  state=(await api("/api/projects")).state;assert.equal(state.projects.some(p=>p.id===project.id),false);
  await page.goto(originalUrl,{waitUntil:"domcontentloaded"});
  await page.locator(".chat-content").waitFor({state:"attached"});
  console.log(`PASS: ${viewportWidth}px projects create, edit, multi-folder default, new-session directory, and remove`);
  if(viewportWidth===1280){
    await checkEmptyProject(page,projectRoot,api,artifacts);
    await page.goto(originalUrl,{waitUntil:"domcontentloaded"});
    await page.locator(".chat-content").waitFor({state:"attached"});
  }
}
