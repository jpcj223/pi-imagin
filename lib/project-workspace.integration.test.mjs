import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getSystemMessageText } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url,{tsconfigPaths:true});
const {createProjectWorkspaceExtension}=await jiti.import("./project-workspace-extension.ts");
const {createConversationGuidanceExtension}=await jiti.import("./conversation-guidance.ts");
const {changeManagedProject,bindProjectSession}=await jiti.import("./managed-projects.ts");
const {AgentSessionWrapper}=await jiti.import("./rpc-manager.ts");
const {appendSessionToolSelection}=await jiti.import("./session-tool-selection.ts");

test("真实 SDK 会话通过模拟提供商完成跨目录任务，越界和只读预设在执行层被拒绝",async t=>{
 const root=mkdtempSync(join(tmpdir(),"pi-project-session-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const roots=["frontend","backend","docs","outside"].map(n=>{const p=join(root,n);mkdirSync(p);return realpathSync(p);});
 const file=join(root,"projects.json");
 const {projects:[p]}=await changeManagedProject({action:"save",name:"全栈项目",folders:roots.slice(0,3).map(path=>({path})),defaultPath:roots[0]},file);
 const sessionManager=SessionManager.inMemory(roots[0]);
 const snapshot=await bindProjectSession(sessionManager.getSessionId(),roots[0],p.id,file);
 const faux=fauxProvider({models:[{id:"project-test"}]});
 const modelRuntime=await ModelRuntime.create({authPath:join(root,"auth.json"),modelsPath:null,refreshOnCreate:false});
 modelRuntime.registerNativeProvider(faux.provider);
 const shell=process.platform==="win32"?"powershell":"bash";
 const settingsManager=SettingsManager.inMemory({defaultTools:["read","write","edit",shell]});
 const resourceLoader=new DefaultResourceLoader({cwd:roots[0],agentDir:root,settingsManager,extensionFactories:[createConversationGuidanceExtension(),createProjectWorkspaceExtension(snapshot,()=>settingsManager.getDefaultTools())],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
 await resourceLoader.reload();
 const {session}=await createAgentSession({cwd:roots[0],agentDir:root,sessionManager,settingsManager,modelRuntime,model:faux.getModel("project-test"),resourceLoader});
 const wrapper=new AgentSessionWrapper(session);t.after(()=>wrapper.destroy());wrapper.beginExtensionBinding();await wrapper.waitUntilReady();
 assert.ok(session.getActiveToolNames().includes("project_command"));
 let promptSeen=false;
 faux.setResponses([
  context=>{
   const prompt=context.messages.filter(m=>m.role==="system").map(getSystemMessageText).join("\n");
   promptSeen=prompt.includes("pi_imagin_project_workspace");
   assert.equal((prompt.match(/<pi_imagin_output_guidance>/g)||[]).length,1);
   const data=prompt.split("<pi_imagin_project_workspace>\n")[1].split("\n")[0];
   assert.deepEqual(JSON.parse(data),{project:snapshot.projectName,revision:snapshot.projectRevision,folders:snapshot.folders,unavailable:[]});
   return fauxAssistantMessage(roots.slice(0,3).map((r,i)=>fauxToolCall("write",{path:join(r,["client.txt","api.txt","interface.md"][i]),content:"接口 v2"},{id:`write-${i}`})),{stopReason:"toolUse"});
  },
  ()=>fauxAssistantMessage([
   fauxToolCall("read",{path:join(roots[1],"api.txt")},{id:"read-backend"}),
   fauxToolCall("project_copy_file",{source:join(roots[1],"api.txt"),destination:join(roots[0],"copied.txt")},{id:"copy-backend"}),
   fauxToolCall("project_command",{cwd:roots[1],command:process.platform==="win32"?"(Get-Location).Path":"pwd",shell},{id:"backend-command"}),
  ],{stopReason:"toolUse"}),
  context=>{
   const read=context.messages.find(m=>m.role==="toolResult"&&m.toolCallId==="read-backend");
   assert.ok(read.content[0].text.includes("pi_imagin_file_source"));
   assert.ok(read.content[0].text.includes(JSON.stringify(join(roots[1],"api.txt"))));
   assert.ok(read.content.some(c=>c.text==="接口 v2"));
   return fauxAssistantMessage([fauxToolCall("write",{path:join(roots[3],"secret.txt"),content:"blocked"},{id:"outside"})],{stopReason:"toolUse"});
  },
  ()=>fauxAssistantMessage([fauxText("完成")]),
 ]);
 await session.prompt("同步前后端接口并更新文档，在后端目录检查执行位置");
 assert.equal(promptSeen,true);
 for(const [i,name] of ["client.txt","api.txt","interface.md"].entries())assert.equal(readFileSync(join(roots[i],name),"utf8"),"接口 v2");
 const results=session.messages.filter(m=>m.role==="toolResult");
 assert.deepEqual(results.find(m=>m.toolCallId==="read-backend").content,[{type:"text",text:"接口 v2"}]);
 assert.equal(results.find(m=>m.toolCallId==="copy-backend").isError,false);assert.equal(readFileSync(join(roots[0],"copied.txt"),"utf8"),"接口 v2");
 for(const id of ["write-0","write-1","write-2","read-backend","backend-command"])assert.equal(results.find(r=>r.toolCallId===id)?.isError,false,id);
 assert.equal(results.find(r=>r.toolCallId==="outside").isError,true);
 assert.ok(results.find(r=>r.toolCallId==="backend-command").content.some(c=>c.text?.includes(roots[1])));
 appendSessionToolSelection(sessionManager,["read"]);wrapper.setActiveToolSelection(["read"]);
 faux.setResponses([
  ()=>fauxAssistantMessage([
   fauxToolCall("project_command",{cwd:roots[0],command:"echo forbidden",shell},{id:"readonly-command"}),
   fauxToolCall("project_copy_file",{source:join(roots[1],"api.txt"),destination:join(roots[0],"readonly-copy.txt")},{id:"readonly-copy"}),
  ],{stopReason:"toolUse"}),
  ()=>fauxAssistantMessage([fauxText("已拒绝")]),
 ]);
 await session.prompt("只读状态尝试执行命令");
 assert.equal(session.messages.find(m=>m.role==="toolResult"&&m.toolCallId==="readonly-command").isError,true);
 assert.equal(session.messages.find(m=>m.role==="toolResult"&&m.toolCallId==="readonly-copy").isError,true);assert.equal(existsSync(join(roots[0],"readonly-copy.txt")),false);
 assert.equal(faux.state.callCount,6);
});
