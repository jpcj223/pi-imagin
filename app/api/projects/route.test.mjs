import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url,{tsconfigPaths:true});
const {GET,POST}=await jiti.import("./route.ts");

test("项目接口完成保存、冲突拒绝、权限校验与移除，不启动模型或改写会话",async t=>{
 const root=mkdtempSync(join(tmpdir(),"pi-project-api-"));const previous=process.env.PI_CODING_AGENT_DIR;
 process.env.PI_CODING_AGENT_DIR=root;
 t.after(()=>{if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous;rmSync(root,{recursive:true,force:true});});
 const folder=join(root,"project");mkdirSync(folder);
 const send=(body,origin="http://localhost:30141",contentType="application/json")=>POST(new Request("http://localhost:30141/api/projects",{method:"POST",headers:{host:"localhost:30141",origin,"content-type":contentType},body:JSON.stringify(body)}));
 const request={action:"save",name:"项目",folders:[{path:folder}],defaultPath:folder};
 assert.equal((await send(request,"https://untrusted.example")).status,403);
 assert.equal((await send(request,"http://localhost:30141","text/plain")).status,415);
 assert.equal((await send({...request,folders:[]})).status,400);
 const saved=await send(request);assert.equal(saved.status,200);const state=(await saved.json()).state;
 assert.equal(state.projects[0].folders.length,1);assert.deepEqual(state.sessions,{});
 const before=readFileSync(join(root,"pi-imagin-projects.json"),"utf8");
 assert.equal((await send({...request,id:state.projects[0].id,revision:0})).status,409);
 assert.equal(readFileSync(join(root,"pi-imagin-projects.json"),"utf8"),before);
 assert.equal((await GET()).headers.get("cache-control"),"no-store");
 assert.equal((await send({action:"remove",id:state.projects[0].id,revision:1})).status,200);
 assert.equal((await (await GET()).json()).state.projects.length,0);
});
