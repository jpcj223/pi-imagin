import assert from "node:assert/strict";
import test from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

test("外部入口保存不等待系统广播，查询合并且成功写入刷新缓存，失败恢复入口", {skip:process.platform!=="win32"},async t=>{
 const root=mkdtempSync(join(tmpdir(),"pi-command-fast-")),agent=join(root,"agent");mkdirSync(agent);
 const previous={local:process.env.LOCALAPPDATA,agent:process.env.PI_CODING_AGENT_DIR,exec:childProcess.execFile};
 process.env.LOCALAPPDATA=root;process.env.PI_CODING_AGENT_DIR=agent;
 const settings=join(agent,"settings.json");writeFileSync(settings,JSON.stringify({piImaginExternalPi:true}));
 let registered=true,resolveNotice,noticeCount=0,corrupt=false;const actions=[];
 const fake=()=>{throw Error("此测试不得执行真实系统命令");};
 fake[promisify.custom]=async(_file,args,options)=>{
  const script=Buffer.from(args.at(-1),"base64").toString("utf16le");
  if(script.includes("Add-Type")){
   noticeCount++;return new Promise(resolve=>{resolveNotice=()=>resolve({stdout:"",stderr:""});});
  }
  const data=JSON.parse(Buffer.from(options.env.PI_IMAGIN_PATH_DATA,"base64").toString());actions.push(data.action);
  if(data.action==="read"){await new Promise(r=>setTimeout(r,20));return{stdout:String(registered),stderr:""};}
  const changed=registered!==(data.action==="enable");registered=data.action==="enable";
  if(corrupt&&data.action==="disable")writeFileSync(settings,"{broken");
  return{stdout:changed?"changed":"",stderr:""};
 };
 childProcess.execFile=fake;syncBuiltinESMExports();
 t.after(()=>{
  resolveNotice?.();childProcess.execFile=previous.exec;syncBuiltinESMExports();
  if(previous.local===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previous.local;
  if(previous.agent===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous.agent;
  rmSync(root,{recursive:true,force:true});
 });
 const api=await createJiti(import.meta.url).import("./pi-command.ts");
 api.writePiLaunchers(join(root,"Pi Imagin","command-bin"),process.execPath,"test-cli.js");
 const first=await Promise.all([api.readPiCommandSettings(),api.readPiCommandSettings(),api.readPiCommandSettings()]);
 assert.ok(first.every(s=>s.enabled&&s.registered));assert.equal(actions.filter(a=>a==="read").length,1);
 const disabled=await api.changePiCommandSettings(false);assert.equal(disabled.enabled,false);assert.equal(registered,false);
 const enabled=await api.changePiCommandSettings(true);assert.equal(enabled.registered,true);assert.equal(registered,true);
 await new Promise(r=>setTimeout(r,140));assert.equal(noticeCount,1,"短时间更改合并广播");
 assert.equal((await api.readPiCommandSettings()).registered,true);
 assert.equal(actions.filter(a=>a==="read").length,1,"保存成功后复用已确认状态");
 assert.equal(JSON.parse(readFileSync(settings,"utf8")).piImaginExternalPi,true);
 // 广播仍未返回，上述保存和查询已经完成。
 assert.equal(typeof resolveNotice,"function");
 corrupt=true;
 await assert.rejects(api.changePiCommandSettings(false),/JSON|property|Unexpected|Expected/i);
 assert.equal(registered,true,"配置写入失败应撤回 PATH 修改");
 assert.deepEqual(actions.slice(-2),["disable","enable"]);
});
