/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { developmentConfig, watchDesktopSources, stopChild } = require("./dev.cjs");
const { prepareDevelopmentWorkspace, synchronizeDevelopmentFiles, watchApplication } = require("./dev-workspace.cjs");

test("桌面开发配置独立于正式配置，按仓库隔离且不改调用方环境", () => {
 const root=path.join(os.tmpdir(),"source"),home=path.join(os.tmpdir(),"home");
 const env={APPDATA:home,PI_CODING_AGENT_DIR:path.join(home,"real-agent"),PI_WEB_PASSWORD:"real-password",ELECTRON_RUN_AS_NODE:"1",PI_IMAGIN_DESKTOP_TEST_DIR:path.join(home,"real-desktop")};
 const before={...env};const config=developmentConfig(root,env,"win32",home);
 assert.deepEqual(env,before);assert.equal(config.port,30143);
 assert.notEqual(config.environment.PI_CODING_AGENT_DIR,env.PI_CODING_AGENT_DIR);
 assert.equal(config.environment.PI_WEB_PASSWORD,"");assert.equal(config.environment.ELECTRON_RUN_AS_NODE,undefined);
 assert.equal(config.environment.PI_IMAGIN_DESKTOP_TEST_DIR,undefined);
 assert.equal(config.environment.PI_IMAGIN_DESKTOP_DEV_PROFILE,config.electronProfile);
 assert.notEqual(config.profile,developmentConfig(root+"-other",env,"win32",home).profile);
 assert.equal(config.profile,developmentConfig(root,env,"win32",home).profile);
 assert.throws(()=>developmentConfig(root,{PI_IMAGIN_DESKTOP_DEV_PORT:"bad"}),/端口/);
 assert.throws(()=>developmentConfig(root,{PI_IMAGIN_DESKTOP_DEBUG_PORT:"bad"}),/端口/);
 assert.equal(developmentConfig(root,{PI_IMAGIN_DESKTOP_DEV_PORT:"32000",PI_IMAGIN_DESKTOP_DEV_DIR:home}).port,32000);
});

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"pi-desktop-dev-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const dir of ["app","lib","node_modules"])fs.mkdirSync(path.join(root,dir));
 for(const [name,body] of Object.entries({"package.json":"{}","tsconfig.json":'{"compilerOptions":{"strict":true}}',"next.config.ts":"export default {};","next-env.d.ts":"WEB_ENV_SENTINEL","proxy.ts":"export const marker=1;"}))fs.writeFileSync(path.join(root,name),body);
 return root;
}
test("派生工作区保留源码链接，框架类型和配置不改写原仓库", t=>{
 const root=fixture(t),original=fs.readFileSync(path.join(root,"tsconfig.json"),"utf8");
 const workspace=prepareDevelopmentWorkspace(root);
 fs.writeFileSync(path.join(root,"lib","value.ts"),"first");assert.equal(fs.readFileSync(path.join(workspace,"lib","value.ts"),"utf8"),"first");
 fs.writeFileSync(path.join(root,"lib","value.ts"),"changed");assert.equal(fs.readFileSync(path.join(workspace,"lib","value.ts"),"utf8"),"changed");
 fs.writeFileSync(path.join(workspace,"next-env.d.ts"),"DESKTOP_ENV");assert.equal(fs.readFileSync(path.join(root,"next-env.d.ts"),"utf8"),"WEB_ENV_SENTINEL");
 assert.equal(fs.readFileSync(path.join(root,"tsconfig.json"),"utf8"),original);
 fs.writeFileSync(path.join(root,"proxy.ts"),"export const marker=2;");synchronizeDevelopmentFiles(root,workspace);
 assert.equal(fs.readFileSync(path.join(workspace,"proxy.ts"),"utf8"),"export const marker=2;");
 assert.equal(prepareDevelopmentWorkspace(root),workspace);
 const config=JSON.parse(fs.readFileSync(path.join(workspace,"tsconfig.json"),"utf8"));assert.equal(config.compilerOptions.paths["@/*"][0],"./*");
});

test("页面新增、原子替换与删除同步，镜像写入不改真实源码", async t=>{
 const root=fixture(t), workspace=prepareDevelopmentWorkspace(root);let failure;
 const stop=watchApplication(root,workspace,error=>{failure=error;});t.after(stop);
 const source=path.join(root,"app","page.tsx"),target=path.join(workspace,"app","page.tsx");
 async function wait(check){const end=Date.now()+3000;while(Date.now()<end){if(failure)throw failure;if(check())return;await new Promise(r=>setTimeout(r,30));}assert.fail("页面镜像未同步");}
 fs.writeFileSync(source,"first");await wait(()=>fs.existsSync(target));
 fs.writeFileSync(target,"generated-only");assert.equal(fs.readFileSync(source,"utf8"),"first");
 fs.writeFileSync(source+".tmp","replacement");fs.renameSync(source+".tmp",source);await wait(()=>fs.readFileSync(target,"utf8")==="replacement");
 fs.unlinkSync(source);await wait(()=>!fs.existsSync(target));assert.equal(failure,undefined);
 const nested=path.join(root,"app","nested"),nestedTarget=path.join(workspace,"app","nested","page.tsx");
 fs.mkdirSync(nested);fs.writeFileSync(path.join(nested,"page.tsx"),"nested");await wait(()=>fs.existsSync(nestedTarget));
 fs.writeFileSync(path.join(nested,"page.tsx.tmp"),"changed");fs.renameSync(path.join(nested,"page.tsx.tmp"),path.join(nested,"page.tsx"));await wait(()=>fs.readFileSync(nestedTarget,"utf8")==="changed");
 fs.unlinkSync(path.join(nested,"page.tsx"));await wait(()=>!fs.existsSync(nestedTarget));
 fs.rmdirSync(nested);await wait(()=>!fs.existsSync(path.dirname(nestedTarget)));assert.equal(failure,undefined);
});
test("派生目录冲突时拒绝覆盖已有内容", t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,".desktop-dev"));fs.writeFileSync(path.join(root,".desktop-dev","keep"),"user");
 assert.throws(()=>prepareDevelopmentWorkspace(root),/已有/);assert.equal(fs.readFileSync(path.join(root,".desktop-dev","keep"),"utf8"),"user");
});
test("只监听桌面运行源码，并合并一次保存的多次通知", async t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,"main.cjs"),"old");let count=0;
 const stop=watchDesktopSources(root,()=>{count++;});t.after(stop);
 fs.writeFileSync(path.join(root,"unrelated.test.cjs"),"test");fs.writeFileSync(path.join(root,"main.cjs"),"new");fs.writeFileSync(path.join(root,"main.cjs"),"newer");
 await new Promise(resolve=>setTimeout(resolve,400));assert.equal(count,1);stop();
});
test("开发进程树回收同时结束其子进程，不按名称清理其他 Node", async t=>{
 const child=spawn(process.execPath,["-e",`const {spawn}=require('child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});process.send({pid:child.pid});setInterval(()=>{},1000);`],{windowsHide:true,detached:true,stdio:["ignore","ignore","ignore","ipc"]});
 t.after(()=>stopChild(child));const [{pid}]=await once(child,"message");await stopChild(child);
 assert.ok(child.exitCode!==null||child.signalCode!==null);
 const deadline=Date.now()+3000;while(Date.now()<deadline){try{process.kill(pid,0);}catch{return;}await new Promise(resolve=>setTimeout(resolve,30));}
 assert.fail("本次服务的子进程仍存活");
});
