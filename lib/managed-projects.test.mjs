import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { changeManagedProject, readManagedProjects, prepareProjectWorkspace, bindProjectSession, resolveProjectToolPath, inheritProjectSession, forgetProjectSessions } = await jiti.import("./managed-projects.ts");
const { managedProjectSidebar } = await jiti.import("./managed-project-sidebar.ts");
const { emptySessionUiState } = await jiti.import("./session-ui-state-shared.ts");
const { buildSessionTree } = await jiti.import("./session-tree.ts");
const { persistProjectFork } = await jiti.import("./project-session-fork.ts");
const { createProjectSessionResolver } = await jiti.import("./managed-projects-shared.ts");

test("项目路径索引保留大小写、边界、工作树和已移除快照的分组含义", () => {
 const project=(id,path)=>({id,name:id,revision:1,defaultFolderId:id,folders:[{id,name:id,path}]});
 const a=project("a","C:\\团队\\前端"), b=project("b","D:\\团队\\后端"), p=project("posix","/srv/app");
 const state={version:1,revision:1,projects:[a,b,p],sessions:{old:{projectId:"removed"},bound:{projectId:"b"}}};
 const resolver=createProjectSessionResolver(state);
 assert.equal(resolver.byPath("c:/团队/前端/src"),a);
 assert.equal(resolver.byPath("C:/团队/前端-other"),undefined);
 assert.equal(resolver.byPath("/srv/App"),undefined);
 assert.equal(resolver.byPath("/srv/app/src"),p);
 assert.equal(resolver.forSession({id:"old",cwd:a.folders[0].path}),undefined);
 assert.equal(resolver.forSession({id:"bound",cwd:a.folders[0].path}),b);
 assert.equal(resolver.forSession({id:"linked",cwd:"D:/worktrees/task",isWorktree:true,projectRoot:a.folders[0].path}),a);
 assert.equal(resolver.forSession({id:"plain",cwd:"D:/worktrees/task",projectRoot:a.folders[0].path}),undefined);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-projects-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const roots = ["frontend", "backend", "docs", "outside"].map(name => { const p=join(root,name);mkdirSync(p);return realpathSync(p); });
  const file=join(root,"state.json");
  const request={ action:"save",name:"商城",folders:roots.slice(0,3).map(path=>({path})),defaultPath:roots[0] };
  return {root,roots,file,request};
}

test("空白项目及文件夹名称使用默认目录名，排序保留身份与默认目录", async t => {
  const f = fixture(t);
  let state = await changeManagedProject({ ...f.request, name: "  ", folders: [{ path: f.roots[0], name: "" }, { path: f.roots[1], name: "自定义" }] }, f.file);
  const project = state.projects[0];
  assert.equal(project.name, "frontend"); assert.equal(project.folders[0].name, "frontend");
  state = await changeManagedProject({ action: "save", id: project.id, revision: project.revision, name: project.name, folders: project.folders.toReversed(), defaultPath: f.roots[0] }, f.file);
  assert.equal(state.projects[0].folders[0].name, "自定义");
  assert.equal(state.projects[0].defaultFolderId, project.defaultFolderId);
  assert.equal(state.projects[0].folders[1].id, project.folders[0].id);
});

test("仅名称创建项目，独立工作区首次使用才创建，并发准备不串项目",async t=>{
 const f=fixture(t);const request={action:"save",name:"空项目",folders:[],defaultPath:""};
 let state=await changeManagedProject(request,f.file);const a=state.projects[0];
 state=await changeManagedProject({...request,name:"第二项目"},f.file);const b=state.projects[1];
 assert.equal(a.folders.length,0);assert.notEqual(a.workspace.path,b.workspace.path);
 assert.equal(existsSync(a.workspace.path),false);assert.equal(existsSync(b.workspace.path),false);
 assert.equal(readManagedProjects(f.file).projects[0].workspace.initialized,false);
 await Promise.all([prepareProjectWorkspace(a.id,a.workspace.path,f.file),prepareProjectWorkspace(a.id,a.workspace.path,f.file)]);
 assert.equal(existsSync(a.workspace.path),true);assert.equal(existsSync(b.workspace.path),false);
 assert.equal(readManagedProjects(f.file).projects[0].workspace.initialized,true);
 const snapshot=await bindProjectSession("empty-project",a.workspace.path,a.id,f.file);
 assert.equal(snapshot.folders.length,1);assert.equal(snapshot.projectId,a.id);
 assert.equal(resolveProjectToolPath(snapshot,join(a.workspace.path,"note.txt")),join(a.workspace.path,"note.txt"));
 assert.throws(()=>resolveProjectToolPath(snapshot,"note.txt"),/绝对路径/);
 assert.throws(()=>resolveProjectToolPath(snapshot,join(b.workspace.path,"note.txt")),/范围/);
 assert.throws(()=>resolveProjectToolPath(snapshot,join(f.root,"auth.json")),/范围/);
 const display=managedProjectSidebar(readManagedProjects(f.file),[{id:"empty-project",cwd:a.workspace.path}],emptySessionUiState(),null);
 assert.equal(display.sessions[0].projectKey,`managed:${a.id}`);
 assert.equal(display.uiState.projects[`managed:${b.id}`].root,b.workspace.path);
});

test("空项目后续关联目录和解除全部目录，不改已有会话快照或删除文件",async t=>{
 const f=fixture(t);const {projects:[p]}=await changeManagedProject({action:"save",name:"空项目",folders:[],defaultPath:""},f.file);
 const old=await bindProjectSession("before-adding",p.workspace.path,p.id,f.file);
 let state=await changeManagedProject({action:"save",id:p.id,revision:1,name:p.name,folders:[{path:f.roots[0]}],defaultPath:f.roots[0]},f.file);
 assert.deepEqual(readManagedProjects(f.file).sessions["before-adding"],old);
 const fresh=await bindProjectSession("after-adding",f.roots[0],p.id,f.file);
 assert.equal(fresh.folders.length,2);assert.equal(resolveProjectToolPath(fresh,join(p.workspace.path,"note.txt")),join(p.workspace.path,"note.txt"));
 state=await changeManagedProject({action:"save",id:p.id,revision:2,name:p.name,folders:[],defaultPath:""},f.file);
 assert.equal(state.projects[0].defaultFolderId,"workspace");assert.equal(existsSync(f.roots[0]),true);
 assert.deepEqual(state.sessions["after-adding"],fresh);
 const next=await bindProjectSession("after-removing",p.workspace.path,p.id,f.file);
 assert.equal(next.folders.length,1);assert.throws(()=>resolveProjectToolPath(next,join(f.roots[0],"new.txt")),/范围/);
 await changeManagedProject({action:"remove",id:p.id,revision:3},f.file);
 assert.equal(existsSync(p.workspace.path),true);assert.deepEqual(readManagedProjects(f.file).sessions["before-adding"],old);
});

test("原有单目录项目可解除最后一个文件夹并得到独立工作区",async t=>{
 const f=fixture(t);const {projects:[p]}=await changeManagedProject(f.request,f.file);
 const state=await changeManagedProject({action:"save",id:p.id,revision:1,name:p.name,folders:[],defaultPath:""},f.file);
 const next=state.projects[0];assert.equal(next.folders.length,0);assert.equal(existsSync(next.workspace.path),false);
 assert.equal((await bindProjectSession("new-workspace",next.workspace.path,next.id,f.file)).cwd,next.workspace.path);
 for(const root of f.roots)assert.equal(existsSync(root),true);
});

test("已使用的项目工作区被删除或替换后拒绝重建，篡改内部路径拒绝读取",async t=>{
 const f=fixture(t);const {projects:[p]}=await changeManagedProject({action:"save",name:"空项目",folders:[],defaultPath:""},f.file);
 await prepareProjectWorkspace(p.id,p.workspace.path,f.file);rmSync(p.workspace.path,{recursive:true});
 await assert.rejects(prepareProjectWorkspace(p.id,p.workspace.path,f.file),/不存在|无法访问/);
 assert.equal(existsSync(p.workspace.path),false);
 symlinkSync(f.roots[3],p.workspace.path,process.platform==="win32"?"junction":"dir");
 await assert.rejects(prepareProjectWorkspace(p.id,p.workspace.path,f.file),/已改变/);
 const state=readManagedProjects(f.file);state.projects[0].workspace.path=f.roots[3];writeFileSync(f.file,JSON.stringify(state));
 assert.throws(()=>readManagedProjects(f.file),/数据格式/);
});

test("内部工作区父目录链接不能将首次创建引向其他目录",async t=>{
 const f=fixture(t);const {projects:[p]}=await changeManagedProject({action:"save",name:"空项目",folders:[],defaultPath:""},f.file);
 const parent=join(f.root,"project-workspaces");symlinkSync(f.roots[3],parent,process.platform==="win32"?"junction":"dir");
 await assert.rejects(prepareProjectWorkspace(p.id,p.workspace.path,f.file),/父目录已改变/);
 assert.equal(existsSync(p.workspace.path),false);
});

test("项目多目录保存、重命名、默认目录和版本冲突保持原数据", async t=>{
 const f=fixture(t);let state=await changeManagedProject(f.request,f.file);const project=state.projects[0];
 assert.equal(project.folders.length,3);assert.equal(state.revision,1);
 state=await changeManagedProject({...f.request,id:project.id,revision:project.revision,name:"商城开发",defaultPath:f.roots[1]},f.file);
 assert.equal(state.projects[0].id,project.id);assert.deepEqual(state.projects[0].folders.map(f=>f.id),project.folders.map(f=>f.id));
 assert.equal(state.projects[0].defaultFolderId,project.folders[1].id);
 const before=readFileSync(f.file,"utf8");
 await assert.rejects(changeManagedProject({...f.request,id:project.id,revision:1},f.file),/另一个窗口/);
 assert.equal(readFileSync(f.file,"utf8"),before);
});

test("并发创建交叠目录只允许一个项目成功，不会部分保存",async t=>{
 const f=fixture(t);const results=await Promise.allSettled([changeManagedProject(f.request,f.file),changeManagedProject({...f.request,name:"冲突项目"},f.file)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(readManagedProjects(f.file).projects.length,1);
 await assert.rejects(changeManagedProject({...f.request,folders:[{path:f.roots[0]},{path:f.roots[0]}]},f.file),/重复/);
 await assert.rejects(changeManagedProject({...f.request,defaultPath:f.roots[3]},f.file),/默认目录|已属于项目/);
});

test("会话保存历史身份，继续执行时同步当前项目目录，分支不重新猜测项目",async t=>{
 const f=fixture(t);const state=await changeManagedProject(f.request,f.file);const p=state.projects[0];
 const scope=await bindProjectSession("session-one",f.roots[0],p.id,f.file);
 await assert.rejects(bindProjectSession("session-wrong",f.roots[3],p.id,f.file),/不属于/);
 await changeManagedProject({...f.request,id:p.id,revision:p.revision,folders:[{path:f.roots[0]}]},f.file);
 const updated=await bindProjectSession("session-one",f.roots[0],p.id,f.file);
 assert.equal(updated.folders.length,1);assert.equal(updated.projectId,scope.projectId);assert.equal(updated.cwd,scope.cwd);
 const fresh=await bindProjectSession("session-two",f.roots[0],p.id,f.file);assert.equal(fresh.folders.length,1);
 await inheritProjectSession("session-one","session-fork",f.file);assert.deepEqual(readManagedProjects(f.file).sessions["session-fork"],scope);
 await changeManagedProject({action:"remove",id:p.id,revision:2},f.file);
 assert.equal(readManagedProjects(f.file).projects.length,0);assert.deepEqual(readManagedProjects(f.file).sessions["session-one"],scope);
 await forgetProjectSessions(["session-one","session-fork"],f.file);assert.equal(readManagedProjects(f.file).sessions["session-one"],undefined);
});

test("真实路径与新文件父目录校验拒绝链接逃逸、上级段和 SDK 特殊路径",async t=>{
 const f=fixture(t);const {projects:[p]}=await changeManagedProject(f.request,f.file);const scope=await bindProjectSession("session",f.roots[0],p.id,f.file);
 assert.equal(resolveProjectToolPath(scope,join(f.roots[1],"new","api.ts")),join(f.roots[1],"new","api.ts"));
 for(const path of [join(f.roots[3],"secret"),"../outside/a","~/secret","@/etc/passwd","file:///etc/passwd"]) assert.throws(()=>resolveProjectToolPath(scope,path));
 const link=join(f.roots[0],"escape");symlinkSync(f.roots[3],link,process.platform==="win32"?"junction":"dir");
 assert.throws(()=>resolveProjectToolPath(scope,join(link,"new.txt")),/范围/);
});

test("关联根被替换为指向外部的目录链接时，旧快照不能跟随新目标",async t=>{
 const f=fixture(t);const {projects:[p]}=await changeManagedProject(f.request,f.file);
 const scope=await bindProjectSession("replaced-root",f.roots[0],p.id,f.file);
 renameSync(f.roots[1],join(f.root,"original-backend"));
 symlinkSync(f.roots[3],f.roots[1],process.platform==="win32"?"junction":"dir");
 assert.throws(()=>resolveProjectToolPath(scope,join(f.roots[1],"unexpected.txt")),/已改变/);
 assert.equal(existsSync(join(f.roots[3],"unexpected.txt")),false);
});

test("多目录列表合并保留原执行身份和归档规则，移除项目后历史回默认区",async t=>{
 const f=fixture(t);let state=await changeManagedProject(f.request,f.file);const p=state.projects[0];
 const sessions=f.roots.slice(0,3).map((cwd,i)=>({id:`s${i}`,cwd,projectKey:cwd,projectRoot:cwd,path:join(cwd,"s.jsonl"),modified:new Date().toISOString(),created:new Date().toISOString(),firstMessage:"任务",messageCount:1}));
 const original=structuredClone(sessions);
 const ui=emptySessionUiState();const displayed=managedProjectSidebar(state,sessions,ui,null);
 assert.equal(new Set(displayed.sessions.map(s=>s.projectKey)).size,1);assert.deepEqual(sessions,original);
 const input={...displayed,runningIds:new Set(),unreadIds:new Set(),selectedSessionId:null,currentProject:displayed.current,groupExpansion:{},moreShown:{},pinnedCollapsed:false,showPins:false};
 assert.equal(buildSessionTree(input).projects.length,1);
 state=await changeManagedProject({action:"remove",id:p.id,revision:p.revision},f.file);
 const removed=managedProjectSidebar(state,sessions,ui,{key:f.roots[0],root:f.roots[0]});
 assert.equal(removed.current,null);
 const model=buildSessionTree({...input,...removed});assert.equal(model.projects.length,0);assert.ok(model.defaultRows.some(r=>r.kind==="session"));
});

test("项目数据损坏时拒绝覆盖，不影响缺省单目录状态",async t=>{
 const f=fixture(t);assert.equal(readManagedProjects(f.file).projects.length,0);
 writeFileSync(f.file,"{broken");await assert.rejects(changeManagedProject(f.request,f.file));assert.equal(readFileSync(f.file,"utf8"),"{broken");
});

test("分支目录快照保存失败回滚新副本，不损坏源会话",async t=>{
 const f=fixture(t);const source=join(f.root,"source.jsonl"),target=join(f.root,"copy.jsonl");
 writeFileSync(source,"source");writeFileSync(target,"copy");writeFileSync(f.file,"{broken");
 await assert.rejects(persistProjectFork("source","copy",source,target,f.file));
 assert.equal(existsSync(target),false);assert.equal(readFileSync(source,"utf8"),"source");
 await assert.rejects(persistProjectFork("source","source",source,source,f.file),/不能覆盖/);
 assert.equal(readFileSync(source,"utf8"),"source");
});

test("linked worktree 延续主仓库项目，并且只加入当前工作树，不开放旁边目录",async t=>{
 const f=fixture(t);const repo=f.roots[0];const linked=join(f.root,"linked");
 const git=(args)=>execFileSync("git",["-C",repo,"-c","commit.gpgsign=false","-c",`core.hooksPath=${join(f.root,"no-hooks")}`,...args],{stdio:"pipe"});
 git(["init"]);writeFileSync(join(repo,"README.md"),"test\n");git(["add","README.md"]);
 git(["-c","user.name=Test","-c","user.email=test@example.invalid","commit","-m","fixture"]);
 git(["worktree","add","-b","fixture",linked]);
 const {projects:[p]}=await changeManagedProject(f.request,f.file);
 const scope=await bindProjectSession("linked-session",linked,p.id,f.file);
 assert.equal(scope.folders.length,4);assert.equal(resolveProjectToolPath(scope,join(linked,"new.txt")),join(realpathSync(linked),"new.txt"));
 assert.throws(()=>resolveProjectToolPath(scope,join(f.root,"other-worktree","new.txt")),/范围/);
 assert.equal(managedProjectSidebar(readManagedProjects(f.file),[{id:"legacy-linked",cwd:linked,projectRoot:repo,isWorktree:true}],emptySessionUiState(),{key:repo,root:repo},linked).sessions[0].projectKey,`managed:${p.id}`);
});
