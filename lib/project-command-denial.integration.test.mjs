import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,mkdirSync,existsSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createJiti} from "jiti";
import {createAgentSession,createPowerShellToolDefinition,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager} from "@earendil-works/pi-coding-agent";
import {fauxProvider,fauxAssistantMessage,fauxToolCall,fauxText} from "@earendil-works/pi-ai";
const {createProjectWorkspaceExtension}=await createJiti(import.meta.url,{tsconfigPaths:true}).import("./project-workspace-extension.ts");

for(const subagent of [false,true])test(`真实 SDK ${subagent?"子代理":"主会话"}拒绝后阻断命令，自动续轮不能解除，用户新请求恢复`,async t=>{
 const root=mkdtempSync(join(tmpdir(),"pi-denial-sdk-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const allowed=join(root,"allowed"),outside=join(root,"outside");mkdirSync(allowed);mkdirSync(outside);writeFileSync(join(outside,"secret.txt"),"PRIVATE");
 const scope={projectId:"test",projectName:"边界",cwd:allowed,folders:[{id:"a",name:"允许",path:allowed}]};
 const faux=fauxProvider({models:[{id:"test"}]});
 const runtime=await ModelRuntime.create({authPath:join(root,"auth.json"),modelsPath:null,refreshOnCreate:false});runtime.registerNativeProvider(faux.provider);
 const settings=SettingsManager.inMemory({defaultTools:["read","write","bash"]});
 let parentRequest="parent-request-1";
 const loader=new DefaultResourceLoader({cwd:allowed,agentDir:root,settingsManager:settings,noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true,extensionFactories:[...(process.platform==="win32"?[{name:"test-powershell",factory:pi=>pi.registerTool(createPowerShellToolDefinition(allowed))}]:[]),createProjectWorkspaceExtension(scope,undefined,undefined,undefined,false,subagent?()=>parentRequest:undefined)]});await loader.reload();
 const {session}=await createAgentSession({cwd:allowed,agentDir:root,modelRuntime:runtime,model:faux.getModel("test"),settingsManager:settings,sessionManager:SessionManager.inMemory(allowed),resourceLoader:loader});t.after(()=>session.dispose());
 const call=(name,args,id)=>fauxAssistantMessage([fauxToolCall(name,args,{id})],{stopReason:"toolUse"});
 const marker=join(allowed,"should-not-run.txt"),valid=join(allowed,"valid.txt");
 const command=`node -e 'require("fs").writeFileSync(${JSON.stringify(marker)},"bypassed")'`;
 faux.setResponses([call("read",{path:join(outside,"secret.txt")},"denied"),call("project_command",{cwd:allowed,command},"bypass"),call("write",{path:valid,content:"allowed"},"valid"),fauxAssistantMessage([fauxText("stopped")])]);
 await session.prompt("读取被拒后尝试命令并继续合法文件操作",{source:"rpc"});
 assert.equal(existsSync(marker),false);assert.equal(readFileSync(valid,"utf8"),"allowed");
 const blocked=session.messages.find(m=>m.role==="toolResult"&&m.toolCallId==="bypass");assert.equal(blocked.isError,true);assert.match(blocked.content[0].text,/命令执行已暂停/);
 // 自动后台消息不是用户新输入，不能重新打开命令。
 faux.setResponses([call("project_command",{cwd:allowed,command},"background"),fauxAssistantMessage([fauxText("still stopped")])]);
 await session.sendCustomMessage({customType:"test-notice",content:"自动继续",display:false},{deliverAs:"followUp",triggerTurn:true});
 assert.equal(existsSync(marker),false);
 const automatic=session.messages.find(m=>m.role==="toolResult"&&m.toolCallId==="background");assert.equal(automatic.isError,true);
 if(subagent){
  faux.setResponses([call("project_command",{cwd:allowed,command},"auto-resume"),fauxAssistantMessage([fauxText("same parent request")])]);
  await session.prompt("父代理自动续接同一任务",{source:"rpc"});
  assert.equal(session.messages.find(m=>m.role==="toolResult"&&m.toolCallId==="auto-resume").isError,true);
  parentRequest="parent-request-2";
 }
 faux.setResponses([call("project_command",{cwd:allowed,command:"echo command-restored"},"restored"),fauxAssistantMessage([fauxText("done")])]);
 await session.prompt("新请求只在允许目录执行 echo",{source:"rpc"});
 const restored=session.messages.find(m=>m.role==="toolResult"&&m.toolCallId==="restored");assert.equal(restored.isError,false,JSON.stringify(restored));assert.ok(restored.content.some(c=>c.text?.includes("command-restored")));
});
