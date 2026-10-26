import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
const jiti=createJiti(import.meta.url,{tsconfigPaths:true});
const {changeManagedProject,bindProjectSession}=await jiti.import("./managed-projects.ts");
const {createProjectWorkspaceExtension}=await jiti.import("./project-workspace-extension.ts");

test("零关联文件夹的真实 SDK 对话可在独立工作区写入，不能写入另一项目",async t=>{
 const root=mkdtempSync(join(tmpdir(),"pi-empty-session-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const file=join(root,"projects.json"),request={action:"save",name:"零文件夹",folders:[],defaultPath:""};
 const {projects:[p]}=await changeManagedProject(request,file);
 const {projects:[,other]}=await changeManagedProject({...request,name:"其他项目"},file);
 const scope=await bindProjectSession("isolated-session",p.workspace.path,p.id,file);
 const faux=fauxProvider({models:[{id:"empty-project-test"}]});
 const runtime=await ModelRuntime.create({authPath:join(root,"auth.json"),modelsPath:null,refreshOnCreate:false});runtime.registerNativeProvider(faux.provider);
 const settings=SettingsManager.inMemory({defaultTools:["read","write"]});
 const loader=new DefaultResourceLoader({cwd:scope.cwd,agentDir:root,settingsManager:settings,extensionFactories:[createProjectWorkspaceExtension(scope)],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
 await loader.reload();
 const {session}=await createAgentSession({cwd:scope.cwd,agentDir:root,sessionManager:SessionManager.inMemory(scope.cwd),settingsManager:settings,modelRuntime:runtime,model:faux.getModel("empty-project-test"),resourceLoader:loader});
 t.after(()=>session.dispose());
 faux.setResponses([
  ()=>fauxAssistantMessage([
   fauxToolCall("write",{path:join(scope.cwd,"note.txt"),content:"独立项目内容"},{id:"own-write"}),
   fauxToolCall("write",{path:join(other.workspace.path,"blocked.txt"),content:"越界"},{id:"other-write"}),
  ],{stopReason:"toolUse"}),
  ()=>fauxAssistantMessage([fauxText("已保存到本项目")]),
 ]);
 await session.prompt("写一份项目笔记");
 assert.equal(readFileSync(join(scope.cwd,"note.txt"),"utf8"),"独立项目内容");
 assert.equal(session.messages.find(message=>message.role==="toolResult"&&message.toolCallId==="own-write").isError,false);
 assert.equal(session.messages.find(message=>message.role==="toolResult"&&message.toolCallId==="other-write").isError,true);
 assert.equal(existsSync(other.workspace.path),false);assert.equal(faux.state.callCount,2);
});
