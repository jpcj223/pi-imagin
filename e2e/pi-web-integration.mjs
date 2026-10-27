// 使用隔离数据验收上游功能；同目录开发服务须先停止，避免争用 .next。
// 分段通过的页面流程汇总在此，启动的测试服务在结束时自动停止。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { SessionManager } from '@earendil-works/pi-coding-agent';

const root=process.cwd(),fixture=resolve('test-results/upstream-browser-'+Date.now()),agent=join(fixture,'agent'),project=join(fixture,'project'),home=join(fixture,'home'),out=resolve('output/playwright/upstream-integration');
for(const dir of [agent,project,home,out,join(project,'.git'),join(agent,'skills','port-check','references')])mkdirSync(dir,{recursive:true});
writeFileSync(join(agent,'settings.json'),JSON.stringify({defaultProvider:'fixture',defaultModel:'test',showCacheMissNotices:false}));
writeFileSync(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:'https://example.invalid/v1',api:'anthropic-messages',apiKey:'test',models:[{id:'test',name:'Port fixture',reasoning:true,input:['text'],contextWindow:128000,maxTokens:4096}]}}}));
writeFileSync(join(agent,'skills','port-check','SKILL.md'),'---\nname: port-check\ndescription: Integration check\n---\n# Main document\n\n[Open reference](references/guide.md#details)\n');
writeFileSync(join(agent,'skills','port-check','references','guide.md'),'# Guide\n\n## Details\n\nREFERENCE_DOCUMENT_OK\n');
const wav=Buffer.alloc(44+8000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(8000,40);wav.fill(128,44);writeFileSync(join(project,'tone.wav'),wav);
const create=(name,text,parent,initialize)=>{const sm=SessionManager.create(project,join(agent,'sessions','fixture'),parent?{parentSession:parent}:undefined);initialize?.(sm);sm.appendSessionInfo(name);sm.appendModelChange('fixture','test');sm.appendMessage({role:'user',content:'Integration fixture',timestamp:Date.now()-4000});sm.appendMessage({role:'assistant',provider:'fixture',model:'test',api:'anthropic-messages',content:[{type:'text',text}],timestamp:Date.now(),durationMs:1200,stopReason:'stop',usage:{input:1200,output:300,cacheRead:500,cacheWrite:0,totalTokens:2000,cost:{input:.01,output:.01,cacheRead:.001,cacheWrite:0,total:.021}}});return sm;};
const main=create('Upstream integration fixture','## Integration ready\n\n![Fixture sound](tone.wav)\n\nNo model request is sent.'),child=create('Child usage fixture','CHILD_RESULT_OK',main.getSessionFile(),sm=>sm.appendCustomEntry('pi-web:subagent',{version:1,parentSessionId:main.getSessionId(),parentSessionPath:main.getSessionFile(),parentToolCallId:'fixture-call',profile:'general-purpose',description:'Child usage fixture',task:'Check usage',runInBackground:false,createdAt:new Date().toISOString(),resourceSnapshot:{version:1,tools:['read'],extensions:[],skills:[]}}));

child.appendCustomEntry('pi-web:subagent-result',{version:1,status:'completed',result:'CHILD_RESULT_OK',completedAt:new Date().toISOString()});
// SDK 可能延后写入自定义条目，强制保存测试快照。
for(const sm of [main,child])writeFileSync(sm.getSessionFile(),[sm.getHeader(),...sm.getEntries()].map(e=>JSON.stringify(e)).join('\n')+'\n');
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));const origin=`http://127.0.0.1:${port}`;
const log=openSync(join(out,'server.log'),'w'),server=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'dev','-H','127.0.0.1','-p',String(port)],{cwd:root,env:{...process.env,PI_CODING_AGENT_DIR:agent,HOME:home,USERPROFILE:home,PI_OFFLINE:'1',PI_WEB_PASSWORD:'',PI_WEB_NO_OPEN:'1'},stdio:['ignore',log,log],windowsHide:true});
let browser;
const errors=[],checks=[];
try{
 for(let n=0;n<90;n++){if(server.exitCode!==null)throw Error('测试服务退出：'+readFileSync(join(out,'server.log'),'utf8').slice(-1000));try{const r=await fetch(origin+'/api/cache-miss-notices');if(r.ok)break;}catch{}if(n===89)throw Error('测试服务未就绪');await new Promise(r=>setTimeout(r,500));}
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 // 本次检查本地技能文档，不访问线上技能目录。
 await page.route('**/api/skills/catalog?*',route=>route.fulfill({status:502,json:{error:'本地集成验收不连接线上目录'}}));
 await page.addInitScript(()=>{localStorage.setItem('pi-locale','en');});
 await page.goto(origin+'/?session='+main.getSessionId(),{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Integration ready',exact:true}).waitFor();
 assert.equal(await page.locator('.chat-content audio[controls]').count(),1);checks.push('正文音频播放器');
 const stats=await page.request.post(origin+'/api/sessions/stats',{data:{ids:[main.getSessionId(),child.getSessionId()]}});
 assert.equal(stats.status(),200);const usage=await stats.json();assert.equal(usage.stats[child.getSessionId()].tokens.total,2000);checks.push('父子会话用量接口');
 const agents=page.locator('.workspace-aux-agents');await agents.waitFor();await agents.click();
 await page.getByRole('listbox',{name:'Agents'}).getByText('2k tokens',{exact:true}).first().waitFor();
 await page.screenshot({path:join(out,'agents-usage.png')});checks.push('代理用量数值展示');
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByText('Show cache and cost notices',{exact:true}).waitFor();
 assert.equal(await page.getByRole('switch',{name:'Show cache and cost notices'}).isChecked(),false);checks.push('缓存费用开关');
 await page.screenshot({path:join(out,'settings.png')});
 await page.getByRole('button',{name:'Models',exact:true}).click();await page.getByText('fixture',{exact:true}).first().click();
 await page.getByRole('region',{name:'Settings',exact:true}).getByText('test',{exact:true}).first().click();
 await page.getByRole('button',{name:/Advanced settings/}).click();
 await page.getByText('Base URL override',{exact:true}).waitFor();
 await page.getByText('Claude adaptive thinking (effort levels)',{exact:true}).waitFor();
 checks.push('逐模型地址与自适应思考控件');await page.screenshot({path:join(out,'model.png')});
 await page.locator('.workspace-rail-skills').click();await page.locator('.skills-installed-search input').fill('port-check');await page.locator('.config-sidebar').getByRole('button',{name:'port-check',exact:true}).click();await page.getByRole('link',{name:'Open reference',exact:true}).click();await page.getByText('REFERENCE_DOCUMENT_OK',{exact:true}).waitFor();checks.push('技能相对文档跳转');await page.screenshot({path:join(out,'skill-reference.png')});
 assert.deepEqual(errors,[]);writeFileSync(join(out,'results.json'),JSON.stringify({origin,fixture,checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){const page=browser?.contexts()[0]?.pages()[0];if(page)await page.screenshot({path:join(out,'failure.png')});const sessions=await fetch(origin+'/api/sessions').then(r=>r.json()).catch(()=>null);writeFileSync(join(out,'sessions.json'),JSON.stringify(sessions,null,2));writeFileSync(join(out,'failure.json'),JSON.stringify({message:error.message,checks,errors},null,2));throw error;}
finally{await browser?.close();if(process.platform==='win32')await new Promise(r=>{const p=spawn('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});p.on('close',r);});else server.kill();}
