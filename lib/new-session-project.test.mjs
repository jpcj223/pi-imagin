import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const { preferredNewSessionProject: pick, loadNewSessionProject, rememberNewSessionProject, newSessionProjectOptions } = await createJiti(import.meta.url).import("./new-session-project.ts");
const project=(id,paths)=>({id,name:id,revision:1,defaultFolderId:"0",folders:paths.map((path,index)=>({id:String(index),name:path,path}))});
const a=project("a",["C:/work/frontend","C:/work/backend"]),b=project("b",["C:/other"]);

test("零关联文件夹项目仍能选择、自动恢复并定位独立工作区",()=>{
 const p={id:"empty",name:"空项目",revision:1,folders:[],defaultFolderId:"workspace",workspace:{id:"workspace",name:"项目工作区",path:"C:/private/empty",initialized:false}};
 assert.deepEqual(pick([p],null,null,null),{cwd:p.workspace.path,managedProjectId:p.id});
 const options=newSessionProjectOptions({cwd:p.workspace.path,project:{key:p.workspace.path,root:p.workspace.path},managedProjectId:p.id,managedProjects:[p],projects:[{key:"raw",root:p.workspace.path}]});
 assert.equal(options.length,1);assert.equal(options[0].note,"未关联文件夹");assert.equal(options[0].name,p.name);
 assert.deepEqual(pick([p,b],null,null,{projectId:p.id,cwd:p.workspace.path}),options[0].target);
});

test("项目菜单按项目身份列一次，不把关联文件夹或其子目录重复列为项目",()=>{
 const options=newSessionProjectOptions({cwd:"C:/work/backend",project:{key:"raw",root:"C:/work/backend"},managedProjects:[{...a,name:"应用项目"}],managedProjectId:"a",projects:[
  {key:"front",root:"C:/work/frontend"},{key:"back",root:"C:/work/backend"},{key:"child",root:"C:/work/frontend/src"},
  {key:"legacy",root:"C:/legacy",alias:"旧项目"},{key:"legacy",root:"C:/legacy"},
 ]});
 assert.deepEqual(options.map(option=>[option.key,option.name]),[["managed:a","应用项目"],["legacy","旧项目"]]);
 assert.deepEqual(options[0].target,{cwd:"C:/work/frontend",managedProjectId:"a"});
 assert.equal(options[0].note,"2 个文件夹");
 assert.deepEqual(options[1].target,{cwd:"C:/legacy",projectKey:"legacy",projectRoot:"C:/legacy"});
});

test("未登记的旧工作区保留当前选项，默认目录不作为项目注入",()=>{
 const context={cwd:"/legacy/app",project:{key:"legacy",root:"/legacy/app",alias:"旧工作区"},projects:[],worktrees:null,currentWorktreePath:null};
 assert.equal(newSessionProjectOptions(context)[0].name,"旧工作区");
 assert.deepEqual(newSessionProjectOptions({...context,defaultWorkspace:true}),[]);
});

test("唯一项目自动使用默认目录，并携带真正的项目身份",()=>{
 assert.deepEqual(pick([a],null,null,null),{cwd:"C:/work/frontend",managedProjectId:"a"});
});
test("当前项目及其子目录优先于上次项目",()=>{
 assert.deepEqual(pick([a,b],"c:\\WORK\\backend\\src",null,{projectId:"b",cwd:"C:/other"}),{cwd:"c:\\WORK\\backend\\src",managedProjectId:"a"});
});
test("同路径项目使用显式身份，已有工作树目录保持不变",()=>{
 const shared=project("shared",["C:/work/frontend"]);
 assert.equal(pick([a,shared],"C:/work/frontend","shared",null).managedProjectId,"shared");
 assert.deepEqual(pick([a,b],"C:/worktrees/feature","a",null,"C:/work/frontend"),{cwd:"C:/worktrees/feature",managedProjectId:"a"});
 assert.deepEqual(pick([a,b],"C:/removed","a",null),{cwd:"C:/work/frontend",managedProjectId:"a"});
});
test("嵌套目录优先归属更精确的项目",()=>{
 const nested=project("nested",["C:/work/frontend/nested"]);
 assert.equal(pick([a,nested],"C:/work/frontend/nested/src",null,null).managedProjectId,"nested");
});
test("没有当前项目时恢复仍有效的上次项目和目录",()=>{
 assert.deepEqual(pick([a,b],"C:/scratch",null,{projectId:"a",cwd:"C:/work/backend"}),{cwd:"C:/work/backend",managedProjectId:"a"});
});
test("移除的关联目录不从历史恢复，改用项目当前默认目录",()=>{
 assert.deepEqual(pick([a,b],null,null,{projectId:"a",cwd:"C:/removed"}),{cwd:"C:/work/frontend",managedProjectId:"a"});
});
test("多项目没有有效记录不随意选择，无项目维持默认工作区",()=>{
 assert.equal(pick([a,b],null,null,null),null);
 assert.equal(pick([a,b],null,null,{projectId:"removed",cwd:"C:/other"}),null);
 assert.equal(pick([],null,null,{projectId:"a",cwd:"C:/work/frontend"}),null);
});
test("失效记录不阻止唯一项目选择，错误默认目录不被猜测",()=>{
 assert.equal(pick([b],null,null,{projectId:"removed",cwd:"C:/removed"}).managedProjectId,"b");
 assert.equal(pick([{...b,defaultFolderId:"missing"}],null,null,null),null);
});
test("选择记忆仅保存项目身份和工作目录，并容忍损坏或被禁用的存储",()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 assert.equal(loadNewSessionProject(storage),null);
 rememberNewSessionProject({projectId:"a",cwd:"C:/work/backend"},storage);
 assert.deepEqual(loadNewSessionProject(storage),{projectId:"a",cwd:"C:/work/backend"});
 storage.setItem([...values.keys()][0],"{");assert.equal(loadNewSessionProject(storage),null);
 const blocked={getItem(){throw Error("blocked");},setItem(){throw Error("blocked");}};
 assert.equal(loadNewSessionProject(blocked),null);assert.doesNotThrow(()=>rememberNewSessionProject({projectId:"a",cwd:"C:/work/backend"},blocked));
});
