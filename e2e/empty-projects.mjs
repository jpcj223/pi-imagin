import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { showSidebarSessions } from "./sidebar.mjs";

/** 零关联目录使用实际项目 API；消息请求只核对契约，不调用付费模型。 */
export async function checkEmptyProject(page, root, api, artifacts) {
  const previousDraft=await page.evaluate(()=>JSON.parse(sessionStorage.getItem("pi-web:tab-open-session")??"null")?.draftId);
  await showSidebarSessions(page);await page.locator(".sidebar-new-button").click();
  await page.waitForFunction(previous=>{
    const next=JSON.parse(sessionStorage.getItem("pi-web:tab-open-session")??"null");
    return next?.draftId&&next.draftId!==previous;
  },previousDraft);
  await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  const draft="只填名称创建项目后保留草稿";
  const normalize=value=>value.replaceAll("\\","/").toLowerCase();
  const input=page.locator(".chat-input-textarea");
  const selector=page.locator(".new-session-project-selector");
  const menu=page.getByRole("menu");
  const settled=async(cwd,id)=>page.waitForFunction(({cwd,id})=>{
    const tab=JSON.parse(sessionStorage.getItem("pi-web:tab-open-session")??"null");
    return tab?.cwd?.replaceAll("\\","/").toLowerCase()===cwd&&tab.projectId===id
      &&new URL(location.href).searchParams.get("cwd")?.replaceAll("\\","/").toLowerCase()===cwd
      &&document.querySelector(".workspace-shell")?.dataset.startupReady==="true";
  },{cwd:normalize(cwd),id});
  await input.fill(draft);await selector.click();
  assert.equal(await menu.getByText("编辑项目",{exact:true}).count(),0);
  await menu.getByText("添加项目",{exact:true}).click();
  const create=page.getByRole("dialog",{name:/^(Create project|创建项目|建立專案)$/,exact:true});await create.waitFor();
  assert.equal(await create.getByRole("button",{name:/^(Create project|创建项目|建立專案)$/,exact:true}).isEnabled(),false);
  const name="仅名称项目";
  await create.getByRole("textbox",{name:/^(Project name|项目名称|專案名稱)$/,exact:true}).fill(name);
  assert.equal(await create.getByRole("button",{name:/^(Create project|创建项目|建立專案)$/,exact:true}).isEnabled(),true);
  await create.getByRole("button",{name:/^(Create project|创建项目|建立專案)$/,exact:true}).click();await create.waitFor({state:"detached"});
  let project=(await api("/api/projects")).state.projects.find(project=>project.name===name);
  assert.ok(project);assert.deepEqual(project.folders,[]);
  const privateCwd=project.workspace.path;
  await settled(privateCwd,project.id);assert.equal(existsSync(privateCwd),true);
  assert.equal(await input.inputValue(),draft);
  await page.reload();await page.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
  await page.waitForFunction(draft=>document.querySelector(".chat-input-textarea")?.value===draft,draft,{timeout:5000});
  await settled(privateCwd,project.id);assert.equal(await input.inputValue(),draft);
  assert.equal(await selector.innerText(),name);
  const verifyScope=async cwd=>{
    const verification=await page.context().newPage();
    const memory=await page.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).map(key=>[key,sessionStorage.getItem(key)])));
    await verification.addInitScript(memory=>{for(const [key,value]of Object.entries(memory))sessionStorage.setItem(key,value);},memory);
    let payload;
    await verification.route("**/api/agent/new",route=>{payload=route.request().postDataJSON();return route.fulfill({status:409,json:{error:"empty project request verification"}});});
    try{
      await verification.goto(page.url());await verification.locator('.workspace-shell[data-startup-ready="true"]').waitFor();
      await verification.locator(".chat-input-textarea").fill("核对发送目录");
      await verification.getByRole("button",{name:"Send",exact:true}).click();
      await verification.getByText("empty project request verification",{exact:false}).first().waitFor();
      assert.equal(payload.projectId,project.id);assert.equal(normalize(payload.cwd),normalize(cwd));
    }finally{await verification.close();}
  };
  await verifyScope(privateCwd);

  // 取消再次添加不改变项目身份；手机使用同一个共享菜单底部面板。
  await page.setViewportSize({width:390,height:844});await selector.click();
  await menu.getByText(name,{exact:true}).waitFor();
  assert.equal(await menu.getByText("编辑项目",{exact:true}).count(),0);
  const bounds=await menu.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391);
  await page.keyboard.press("Escape");
  if(artifacts)await page.screenshot({path:join(artifacts,"empty-project-mobile.png")});
  await page.setViewportSize({width:1280,height:900});

  // 后续关联目录只影响新会话范围；正在编辑的草稿仍在其原工作区。
  await showSidebarSessions(page);
  const row=page.locator(`[data-row-key="group:managed:${project.id}"]`);
  await row.hover();await row.locator('.session-tree-group-actions [aria-haspopup="menu"]').click();
  await page.getByRole("menuitem",{name:/^(Edit project|编辑项目|編輯專案)$/,exact:true}).click();
  const edit=page.getByRole("dialog",{name:/^(Edit project|编辑项目|編輯專案)$/,exact:true});await edit.waitFor();
  assert.equal(await edit.locator(".project-editor-folder").count(),0);
  const source=join(root,"later-source");mkdirSync(source,{recursive:true});
  await edit.getByText("粘贴路径或使用最近目录",{exact:true}).click();
  await edit.getByRole("textbox",{name:/^(Folder path|文件夹路径|資料夾路徑)$/,exact:true}).fill(source);
  await edit.getByRole("button",{name:/^(Add|添加|新增)$/,exact:true}).click();
  await edit.getByText(source,{exact:true}).waitFor();
  await edit.getByRole("button",{name:/^(Save|保存|儲存)$/,exact:true}).click();await edit.waitFor({state:"detached"});
  project=(await api("/api/projects")).state.projects.find(item=>item.id===project.id);
  assert.equal(project.folders.length,1);assert.equal(project.defaultFolderId,project.folders[0].id);
  await settled(privateCwd,project.id);assert.equal(await input.inputValue(),draft);
  await page.locator(".new-session-directory-selector").click();
  await menu.getByText(project.folders[0].name,{exact:true}).click();await settled(source,project.id);
  assert.equal(await input.inputValue(),draft);
  if(artifacts)await page.screenshot({path:join(artifacts,"empty-project-linked.png")});

  // 预期失败使用独立页面，避免给主流程制造错误提示和控制台错误。
  await verifyScope(source);
  await showSidebarSessions(page);await row.hover();
  await row.locator('.session-tree-group-actions [aria-haspopup="menu"]').click();
  await page.getByRole("menuitem",{name:/^(Edit project|编辑项目|編輯專案)$/,exact:true}).click();await edit.waitFor();
  await edit.getByRole("button",{name:new RegExp(`^(Unlink ${project.folders[0].name}|解除关联${project.folders[0].name}|解除關聯 ${project.folders[0].name})$`),exact:true}).click();
  await edit.getByRole("button",{name:/^(Save|保存|儲存)$/,exact:true}).click();await edit.waitFor({state:"detached"});
  await settled(privateCwd,project.id);assert.equal(await input.inputValue(),draft);assert.equal(existsSync(source),true);
  console.log("PASS: name-only project, lazy workspace, refresh draft, sidebar edit, later folder and message scope");
}
