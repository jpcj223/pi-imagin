import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url,{tsconfigPaths:true});
const {createProjectWorkspaceExtension}=await jiti.import("./project-workspace-extension.ts");
const {createReadToolDefinition,createWriteToolDefinition,createEditToolDefinition}=await import("@earendil-works/pi-coding-agent");

test("同一会话跨前后端读写文档，并在指定目录运行命令，主目录保持不变",async t=>{
 const root=mkdtempSync(join(tmpdir(),"pi-project-tools-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const roots=["frontend","backend","docs","outside"].map(n=>{const p=join(root,n);mkdirSync(p);return realpathSync(p);});
 const scope={projectId:"p",projectName:"商城",cwd:roots[0],folders:roots.slice(0,3).map((path,i)=>({id:`f${i}`,name:["前端","后端","文档"][i],path}))};
 const events=new Map();let command;let activeTools=["read","write","edit",process.platform==="win32"?"powershell":"bash"];
 createProjectWorkspaceExtension(scope).factory({registerTool:t=>{command=t;},on:(name,fn)=>events.set(name,fn),getActiveTools:()=>activeTools});
 const entries=[];
 const context={cwd:roots[0],sessionManager:{getEntries:()=>entries,getSessionId:()=>"test-session",getSessionFile:()=>undefined},hasUI:false};
 const prompt=events.get("before_agent_start")({systemPrompt:"原提示词"});assert.ok(prompt.systemPrompt.startsWith("原提示词"));for(const r of roots.slice(0,3))assert.ok(prompt.systemPrompt.includes(JSON.stringify(r)));
 const block=prompt.systemPrompt.split("<pi_imagin_project_workspace>\n")[1].split("\n</pi_imagin_project_workspace>")[0];
 assert.deepEqual(JSON.parse(block.split("\n")[0]),{project:scope.projectName,folders:scope.folders,unavailable:[]});
 assert.ok(block.includes("不是默认操作位置"));
 assert.ok(block.includes("无需新建会话"));
 assert.ok(block.includes("不得通过 Shell 绕过文件工具的访问拒绝"));
 assert.ok(block.includes("关联目录不会自动加载其中的 .pi 资源"));
 const guidance=block.slice(block.indexOf("\n")+1);
 for(const folder of scope.folders){
  assert.ok(!guidance.includes(folder.path));
  assert.ok(!guidance.includes(JSON.stringify(folder.path).slice(1,-1)));
 }
 // 设置对象后续变化不能扩展已创建扩展的快照或工具边界。
 scope.folders.push({id:"late",name:"后来添加",path:roots[3]});
 scope.projectName="后来改名";
 assert.deepEqual(events.get("before_agent_start")({systemPrompt:"原提示词"}),prompt);
 const correction=events.get("tool_call")({toolName:"read",input:{path:"../backend/api.txt"}},context);
 assert.equal(correction.block,true);for(const r of roots.slice(0,3))assert.ok(correction.reason.includes(r));
 assert.ok(correction.reason.includes("不要改用 Shell 绕过"));
 const call=async(name,input)=>{
  const blocked=events.get("tool_call")({toolName:name,input},context);if(blocked?.block)throw new Error(blocked.reason);
  const definition={read:createReadToolDefinition,write:createWriteToolDefinition,edit:createEditToolDefinition}[name](scope.cwd);
  return definition.execute("call",input,undefined,undefined,context);
 };
 await call("write",{path:join(roots[1],"api.txt"),content:"old api"});
 await call("edit",{path:join(roots[1],"api.txt"),edits:[{oldText:"old api",newText:"new api"}]});
 const result=await call("read",{path:join(roots[1],"api.txt")});assert.ok(result.content.some(c=>c.text?.includes("new api")));
 await call("write",{path:join(roots[0],"client.txt"),content:"new api"});await call("write",{path:join(roots[2],"interface.md"),content:"new api"});
 for(const r of roots.slice(0,3)){const result=await command.execute("cmd",{cwd:r,command:process.platform==="win32"?"(Get-Location).Path":"pwd"},undefined,undefined,context);assert.ok(result.content.map(c=>c.text||"").join("\n").includes(r));}
 assert.equal(context.cwd,roots[0]);assert.equal(readFileSync(join(roots[2],"interface.md"),"utf8"),"new api");
 await assert.rejects(call("write",{path:join(roots[3],"secret.txt"),content:"no"}),/范围/);
 events.get("input")({source:"rpc"});
 await assert.rejects(command.execute("bad",{cwd:roots[3],command:"echo bad"},undefined,undefined,context),/范围/);
 events.get("input")({source:"rpc"});
 // 长输出仍可继续读取，但精确授权不能扩展到写入、同目录其他文件或第三方结果。
 const large=await command.execute("large",{cwd:roots[1],command:process.platform==="win32"?'1..3000 | ForEach-Object { "line-$_" }':"seq 1 3000"},undefined,undefined,context);
 const output=large.details.fullOutputPath;assert.equal(typeof output,"string");
 t.after(()=>rmSync(output,{force:true}));
 entries.push({type:"message",message:{role:"toolResult",toolName:"project_command",details:large.details}});
 const outputRead=await call("read",{path:output,offset:1,limit:2});assert.ok(outputRead.content.some(c=>c.text?.includes("line-1")||c.text?.includes("1")));
 await assert.rejects(call("write",{path:output,content:"overwrite"}),/范围/);
 const sibling=join(roots[3],"unrelated.txt");writeFileSync(sibling,"not command output");entries.push({type:"message",message:{role:"toolResult",toolName:"remote",details:{fullOutputPath:sibling}}});
 await assert.rejects(call("read",{path:sibling}),/范围/);
 events.get("input")({source:"rpc"});
 activeTools=["read"];await assert.rejects(command.execute("readonly",{cwd:roots[0],command:"echo bad"},undefined,undefined,context),/未允许/);
});

test("真正的范围拒绝在当前请求关闭命令入口，允许合法文件操作且不被自动续轮解除",async t=>{
 const root=mkdtempSync(join(tmpdir(),"pi-project-denial-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const allowed=join(root,"allowed"),outside=join(root,"outside");mkdirSync(allowed);mkdirSync(outside);
 const scope={projectId:"p",projectName:"拒绝",cwd:allowed,folders:[{id:"a",name:"允许",path:allowed}]};
 const events=new Map(),tools=new Map();
 createProjectWorkspaceExtension(scope).factory({registerTool:tool=>tools.set(tool.name,tool),on:(name,fn)=>events.set(name,fn),getActiveTools:()=>["read","write","bash"]});
 const context={cwd:allowed,sessionManager:{getEntries:()=>[]}};
 // 格式错误和文件缺失不属于授权拒绝，不应锁住命令。
 events.get("tool_call")({toolName:"read",input:{path:"relative.txt"}},context);
 assert.equal(events.get("tool_call")({toolName:"project_command",input:{cwd:allowed,command:"echo ok"}},context),undefined);
 events.get("tool_call")({toolName:"read",input:{path:join(allowed,"missing.txt")}},context);
 assert.equal(events.get("tool_call")({toolName:"project_command",input:{}},context),undefined);
 const denied=events.get("tool_call")({toolName:"read",input:{path:join(outside,"secret.txt")}},context);assert.equal(denied.block,true);
 for(const name of ["project_command","bash","powershell","Agent","steer_subagent"])assert.match(events.get("tool_call")({toolName:name,input:{}},context).reason,/命令执行已暂停/);
 await assert.rejects(tools.get("project_command").execute("nested",{cwd:allowed,command:"echo bypass"},undefined,undefined,context),/命令执行已暂停/);
 assert.equal(events.get("tool_call")({toolName:"write",input:{path:join(allowed,"valid.txt")}},context),undefined);
 events.get("agent_end")();events.get("before_agent_start")({systemPrompt:"original"});events.get("input")({source:"extension"});
 assert.equal(events.get("tool_call")({toolName:"project_command",input:{}},context).block,true);
 events.get("input")({source:"rpc"});
 assert.equal(events.get("tool_call")({toolName:"project_command",input:{}},context),undefined);
 await assert.rejects(tools.get("project_copy_file").execute("copy",{source:join(outside,"secret.txt"),destination:join(allowed,"copy.txt")},undefined,undefined,context),/范围/);
 assert.equal(events.get("tool_call")({toolName:"project_command",input:{}},context).block,true);
});

test("子代理重开可恢复拒绝记录，仅父会话新的用户请求解除",t=>{
 const root=mkdtempSync(join(tmpdir(),"pi-denial-restore-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const allowed=join(root,"allowed");mkdirSync(allowed);let parentRequest="parent-1";
 const scope={projectId:"p",projectName:"恢复",cwd:allowed,folders:[{id:"a",name:"a",path:allowed}]};
 const entries=[{id:"child-1",type:"message",message:{role:"user",content:"子任务"}}];
 const context={cwd:allowed,sessionManager:{getEntries:()=>entries}};
 const make=()=>{
  const events=new Map();createProjectWorkspaceExtension(scope,undefined,undefined,undefined,false,()=>parentRequest).factory({
   registerTool:()=>{},getActiveTools:()=>[],on:(name,fn)=>events.set(name,fn),
   appendEntry:(customType,data)=>entries.push({type:"custom",id:"denial",customType,data}),
  });return events;
 };
 let events=make();events.get("tool_call")({toolName:"read",input:{path:join(root,"outside.txt")}},context);
 assert.equal(entries.at(-1).customType,"pi-imagin:project-command-denial");
 entries.push({id:"child-2",type:"message",message:{role:"user",content:"自动续接"}});
 events=make();events.get("input")({source:"rpc"});
 assert.equal(events.get("tool_call")({toolName:"project_command",input:{}},context).block,true);
 parentRequest="parent-2";
 assert.equal(events.get("tool_call")({toolName:"project_command",input:{}},context),undefined);
});

test("模型上下文按读取调用 ID 标明来源，保留正文与图像，不改历史或扩展越界结果",t=>{
 const root=mkdtempSync(join(tmpdir(),"pi-project-source-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const roots=["front","back"].map(name=>{const path=join(root,name);mkdirSync(path);return realpathSync(path);});
 const scope={projectId:"p",projectName:"来源",cwd:roots[0],folders:roots.map((path,i)=>({id:String(i),name:String(i),path}))};
 const events=new Map();createProjectWorkspaceExtension(scope).factory({registerTool:()=>{},on:(name,fn)=>events.set(name,fn)});
 const image={type:"image",data:"AA==",mimeType:"image/png"};
 const message=(id,content,isError=false)=>({role:"toolResult",toolName:"read",toolCallId:id,content,isError,timestamp:1});
 const messages=[{role:"assistant",content:[
  {type:"toolCall",id:"front",name:"read",arguments:{path:join(roots[0],"same.txt")}},
  {type:"toolCall",id:"back",name:"read",arguments:{path:join(roots[1],"same.txt")}},
  {type:"toolCall",id:"outside",name:"read",arguments:{path:join(root,"outside.txt")}},
 ]},message("back",[{type:"text",text:"BACK_ONLY"},image]),message("front",[{type:"text",text:"FRONT_ONLY"}]),message("outside",[{type:"text",text:"denied"}],true),message("unknown",[{type:"text",text:"unmapped"}])];
 const before=structuredClone(messages);
 const result=events.get("context")({messages});
 assert.ok(result.messages[1].content[0].text.includes(JSON.stringify(join(roots[1],"same.txt"))));
 assert.ok(result.messages[2].content[0].text.includes(JSON.stringify(join(roots[0],"same.txt"))));
 assert.deepEqual(result.messages[1].content.slice(1),messages[1].content);
 assert.deepEqual(result.messages[2].content.slice(1),messages[2].content);
 assert.equal(result.messages[3],messages[3]);assert.equal(result.messages[4],messages[4]);
 assert.deepEqual(messages,before);
 // 重放同一段历史无需依赖上一轮执行时的内存，也不会向历史累加来源标记。
 assert.deepEqual(events.get("context")({messages}),result);
});
