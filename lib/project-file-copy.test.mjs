import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";
const {copyProjectFile,MAX_PROJECT_COPY_BYTES}=await createJiti(import.meta.url,{tsconfigPaths:true}).import("./project-file-copy.ts");
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),"pi-project-copy-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const roots=["front","back","outside"].map(name=>{const path=join(root,name);mkdirSync(path);return realpathSync(path);});
 return {roots,scope:{projectId:"p",projectName:"复制",cwd:roots[0],folders:roots.slice(0,2).map((path,i)=>({id:String(i),name:String(i),path}))}};
}
test("跨目录复制按字节保留空文件、中文、CRLF、末尾换行和二进制；默认不覆盖",async t=>{
 const {roots,scope}=fixture(t);
 for(const [i,data] of [Buffer.alloc(0),Buffer.from("中文值\r\nid=7\n\n"),Buffer.from([0,1,128,255,10])].entries()){
  const source=join(roots[1],`source-${i}`),target=join(roots[0],"nested",`copy-${i}`);writeFileSync(source,data);
  const info=await copyProjectFile(scope,source,target);assert.deepEqual(readFileSync(target),data);assert.equal(info.bytes,data.length);assert.equal(info.sha256,createHash("sha256").update(data).digest("hex"));
  writeFileSync(source,"changed");await assert.rejects(copyProjectFile(scope,source,target),/已存在/);assert.deepEqual(readFileSync(target),data);
  await copyProjectFile(scope,source,target,true);assert.equal(readFileSync(target,"utf8"),"changed");
 }
 assert.ok(readdirSync(join(roots[0],"nested")).every(name=>!name.endsWith(".tmp")));
});
test("复制复用项目边界，拒绝越界、上级跳转、同文件和目录源",async t=>{
 const {roots,scope}=fixture(t);const source=join(roots[1],"source");writeFileSync(source,"ok");writeFileSync(join(roots[2],"outside"),"secret");
 await assert.rejects(copyProjectFile(scope,join(roots[2],"outside"),join(roots[0],"bad")),/范围/);
 await assert.rejects(copyProjectFile(scope,source,join(roots[2],"bad")),/范围/);
 await assert.rejects(copyProjectFile(scope,roots[1]+"/../back/source",join(roots[0],"bad")),/上级/);
 await assert.rejects(copyProjectFile(scope,source,source,true),/相同/);
 await assert.rejects(copyProjectFile(scope,roots[1],join(roots[0],"bad")),/普通文件/);
 assert.deepEqual(readdirSync(roots[0]),[]);assert.deepEqual(readdirSync(roots[2]),["outside"]);
});
test("两次默认复制竞争同一目标，只有一次成功，保留完整文件",async t=>{
 const {roots,scope}=fixture(t);const a=join(roots[1],"a"),b=join(roots[1],"b"),dest=join(roots[0],"result");writeFileSync(a,"AAAA");writeFileSync(b,"BBBB");
 const result=await Promise.allSettled([copyProjectFile(scope,a,dest),copyProjectFile(scope,b,dest)]);
 assert.equal(result.filter(r=>r.status==="fulfilled").length,1);assert.equal(result.filter(r=>r.status==="rejected").length,1);
 assert.ok(["AAAA","BBBB"].includes(readFileSync(dest,"utf8")));assert.deepEqual(readdirSync(roots[0]),["result"]);
});
test("取消、超限及关联根删除时不改旧目标，不遗留临时文件",async t=>{
 const {roots,scope}=fixture(t);const source=join(roots[1],"source"),dest=join(roots[0],"target");writeFileSync(source,"new");writeFileSync(dest,"old");
 const controller=new AbortController();controller.abort();await assert.rejects(copyProjectFile(scope,source,dest,true,controller.signal),/abort/i);
 writeFileSync(source,Buffer.alloc(MAX_PROJECT_COPY_BYTES+1));await assert.rejects(copyProjectFile(scope,source,dest,true),/上限/);
 rmSync(roots[1],{recursive:true});await assert.rejects(copyProjectFile(scope,source,dest,true),/目录/);
 assert.equal(readFileSync(dest,"utf8"),"old");assert.deepEqual(readdirSync(roots[0]),["target"]);
});
