import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, fauxText, getSystemMessageText } from "@earendil-works/pi-ai";
const jiti=createJiti(import.meta.url,{tsconfigPaths:true});
const projects=await jiti.import("./managed-projects.ts");
const {createProjectWorkspaceExtension}=await jiti.import("./project-workspace-extension.ts");
const {AgentSessionWrapper,startRpcSession}=await jiti.import("./rpc-manager.ts");
const {createSubagentController}=await jiti.import("./subagent-runtime.ts");

test("真实 SDK 在模型请求期间解除目录，旧调用被拦截，后续请求收到最新目录",async t=>{
 const root=mkdtempSync(join(tmpdir(),"pi-live-sdk-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const folders=["front","back","docs"].map(name=>{const path=join(root,name);mkdirSync(path);return {name,path};});
 const file=join(root,"projects.json");let p=(await projects.changeManagedProject({action:"save",name:"动态",folders:folders.slice(0,2)},file)).projects[0];
 const manager=SessionManager.inMemory(folders[0].path);
 const binding=await projects.bindProjectSession(manager.getSessionId(),folders[0].path,p.id,file);
 const faux=fauxProvider({models:[{id:"live"}]});
 const runtime=await ModelRuntime.create({authPath:join(root,"auth.json"),modelsPath:null,refreshOnCreate:false});runtime.registerNativeProvider(faux.provider);
 const settings=SettingsManager.inMemory({defaultTools:["read","write"]});
 const loader=new DefaultResourceLoader({cwd:folders[0].path,agentDir:root,settingsManager:settings,noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true,extensionFactories:[createProjectWorkspaceExtension(binding,undefined,undefined,()=>projects.resolveCurrentProjectScope(binding,file))]});await loader.reload();
 const {session}=await createAgentSession({cwd:folders[0].path,agentDir:root,sessionManager:manager,settingsManager:settings,modelRuntime:runtime,model:faux.getModel("live"),resourceLoader:loader});t.after(()=>session.dispose());
 const stale=join(folders[1].path,"stale.txt"),fresh=join(folders[2].path,"fresh.txt");
 faux.setResponses([
  async()=>{p=(await projects.changeManagedProject({action:"save",id:p.id,revision:p.revision,name:p.name,folders:[folders[0],folders[2]]},file)).projects[0];return fauxAssistantMessage([fauxToolCall("write",{path:stale,content:"禁止"},{id:"stale"})],{stopReason:"toolUse"});},
  context=>{const text=JSON.stringify(context.messages);assert.ok(text.includes("pi_imagin_project_workspace_update"));assert.ok(text.includes("docs"));return fauxAssistantMessage([fauxToolCall("write",{path:fresh,content:"已更新"},{id:"fresh"})],{stopReason:"toolUse"});},
  ()=>fauxAssistantMessage([fauxText("完成")]),
 ]);
 await session.prompt("运行期间目录变化");
 assert.equal(existsSync(stale),false);assert.equal(readFileSync(fresh,"utf8"),"已更新");
 assert.equal(session.messages.find(m=>m.role==="toolResult"&&m.toolCallId==="stale").isError,true);
 assert.ok(session.messages.find(m=>m.role==="toolResult"&&m.toolCallId==="fresh").details.path===fresh);
 assert.equal(session.messages.filter(m=>m.role==="user").length,1);
});

test("项目子代理无扩展权限也能按原工具权限跨目录，续接和 RPC 恢复跟随项目更新",async t=>{
 const root=mkdtempSync(join(tmpdir(),"pi-live-child-"));
 const previous=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=root;
 const wrappers=new Map();t.after(async()=>{for(const w of wrappers.values())if(w.isAlive())await w.shutdown();if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous;rmSync(root,{recursive:true,force:true});});
 const folders=["front","back","docs"].map(name=>{const path=join(root,name);mkdirSync(path);return {name,path};});
 mkdirSync(join(root,"agents"));writeFileSync(join(root,"agents","fixture.md"),"---\ndescription: live\ntools: read, write, bash\nload_skills: false\nload_extensions: false\nprompt_mode: replace\n---\nEXACT_CHILD");
 const faux=fauxProvider({models:[{id:"live"}]});
 const runtime=await ModelRuntime.create({authPath:join(root,"auth.json"),modelsPath:null,refreshOnCreate:false});runtime.registerNativeProvider(faux.provider);
 const manager=SessionManager.create(folders[0].path,join(root,"sessions"));
 let p=(await projects.changeManagedProject({action:"save",name:"子代理动态",folders:folders.slice(0,2)})).projects[0];
 const binding=await projects.bindProjectSession(manager.getSessionId(),folders[0].path,p.id);
 const settings=SettingsManager.inMemory({defaultTools:["read","write"]});
 const loader=new DefaultResourceLoader({cwd:folders[0].path,agentDir:root,settingsManager:settings,noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true});await loader.reload();
 const {session}=await createAgentSession({cwd:folders[0].path,agentDir:root,sessionManager:manager,settingsManager:settings,modelRuntime:runtime,model:faux.getModel("live"),resourceLoader:loader});
 manager.appendSessionInfo("父会话");manager.appendMessage({role:"user",content:"准备",timestamp:Date.now()});
 const parent=new AgentSessionWrapper(session,{projectScope:binding});wrappers.set(session.sessionId,parent);
 await assert.rejects(parent.send({type:"bash",command:"echo should-not-run"}),/无法确定命令执行位置/);
 let child;
 const controller=createSubagentController({getSession:id=>wrappers.get(id),registerSession(inner,options){child=new AgentSessionWrapper(inner,options);child.start();child.beginExtensionBinding();wrappers.set(inner.sessionId,child);return child;},resolveSessionPath:async id=>wrappers.get(id)?.sessionFile??null,reopenSession:async()=>{throw Error("not expected");},invalidateSessionList(){},isBuiltInSubagentsEnabled:()=>true});
 const request={parentContext:session,parentToolCallId:"start",profile:"fixture",task:"写入后端",description:"动态测试"};
 await assert.rejects(controller.extensionRuntime.start({...request,cwd:folders[1].path}),/only applies to worktree isolation/);
 const target=join(folders[1].path,"child.txt");
 faux.setResponses([context=>{assert.equal(context.messages.filter(m=>m.role==="system").map(getSystemMessageText).join("\n"),"EXACT_CHILD");assert.ok(JSON.stringify(context.messages).includes("pi_imagin_project_workspace_update"));return fauxAssistantMessage([fauxToolCall("write",{path:target,content:"子代理"})],{stopReason:"toolUse"});},()=>fauxAssistantMessage([fauxText("完成")])]);
 assert.equal((await (await controller.extensionRuntime.start(request)).completion).status,"completed");
 assert.equal(readFileSync(target,"utf8"),"子代理");
 assert.ok(child.inner.getActiveToolNames().includes("project_command"));
 p=(await projects.changeManagedProject({action:"save",id:p.id,revision:p.revision,name:p.name,folders})).projects[0];
 const added=join(folders[2].path,"resumed.txt");
 faux.setResponses([()=>fauxAssistantMessage([fauxToolCall("write",{path:added,content:"新目录"})],{stopReason:"toolUse"}),()=>fauxAssistantMessage([fauxText("完成")])]);
 assert.equal((await (await controller.extensionRuntime.resume({parentContext:session,parentToolCallId:"resume",sessionId:child.sessionId,task:"写入文档",description:"续接"})).completion).status,"completed");
 assert.equal(readFileSync(added,"utf8"),"新目录");
 const id=child.sessionId,path=child.sessionFile;await child.shutdown();
 const create=ModelRuntime.create;ModelRuntime.create=async(...args)=>{const runtime=await create.apply(ModelRuntime,args);runtime.registerNativeProvider(faux.provider);return runtime;};t.after(()=>{ModelRuntime.create=create;});
 child=(await startRpcSession(id,path)).session;wrappers.set(id,child);
 const reopened=join(folders[2].path,"reopened.txt");
 faux.setResponses([()=>fauxAssistantMessage([fauxToolCall("write",{path:reopened,content:"恢复"})],{stopReason:"toolUse"}),()=>fauxAssistantMessage([fauxText("完成")])]);
 await child.waitUntilReady();await child.inner.prompt("恢复后写入文档");
 assert.equal(readFileSync(reopened,"utf8"),"恢复");assert.equal(child.getProjectScope().folders.length,3);
});
