import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createJiti} from 'jiti';
import {createAgentSession,ModelRuntime,SessionManager,SettingsManager} from '@earendil-works/pi-coding-agent';
import {fauxProvider,fauxAssistantMessage,fauxToolCall,fauxText} from '@earendil-works/pi-ai';
const {AgentSessionWrapper}=await createJiti(import.meta.url,{tsconfigPaths:true}).import('./rpc-manager.ts');

async function fixture(t,options={}){
  const dir=await mkdtemp(join(tmpdir(),'pi-session-controls-'));
  const faux=fauxProvider({models:[{id:'reasoner',reasoning:true}],...options});
  const modelRuntime=await ModelRuntime.create({authPath:join(dir,'auth.json'),modelsPath:null,refreshOnCreate:false});modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager=SettingsManager.inMemory({defaultThinkingLevel:'low'});
  const {session}=await createAgentSession({cwd:dir,agentDir:dir,modelRuntime,model:faux.getModel('reasoner'),thinkingLevel:'high',tools:['ls'],sessionManager:SessionManager.inMemory(dir),settingsManager});
  const wrapper=new AgentSessionWrapper(session);wrapper.start();
  t.after(async()=>{wrapper.destroy();await rm(dir,{recursive:true,force:true});});return {faux,session,wrapper,settingsManager};
}
test('真实 SDK 会话运行中 auto 恢复默认，从下一次请求生效且不修改全局设置',async t=>{
  const {faux,session,wrapper,settingsManager}=await fixture(t);const levels=[];let release,started;
  const ready=new Promise(done=>{started=done;});const held=new Promise(done=>{release=done;});
  faux.setResponses([async(_context,options)=>{levels.push(options.reasoning);started();await held;return fauxAssistantMessage([fauxToolCall('ls',{path:'.'})],{stopReason:'toolUse'});},
    (_context,options)=>{levels.push(options.reasoning);return fauxAssistantMessage('done');}]);
  const running=session.prompt('test');await ready;
  assert.deepEqual(await wrapper.send({type:'set_thinking_level',level:'auto'}),{thinkingLevel:'low'});
  release();await running;assert.deepEqual(levels,['high','low']);assert.equal(settingsManager.getDefaultThinkingLevel(),'low');
  await assert.rejects(wrapper.send({type:'set_thinking_level',level:'invalid'}),/Invalid thinking level/);
});
test('真实 SDK 流取消后正确结束且可再次对话',async t=>{
  const {faux,session,wrapper}=await fixture(t,{tokensPerSecond:30,tokenSize:{min:4,max:4}});
  let started;const ready=new Promise(done=>{started=done;});let aborted=false;
  const unsubscribe=session.subscribe(event=>{if(event.type==='message_update')started();if(event.type==='agent_settled')aborted=event.aborted===true;});
  t.after(unsubscribe);faux.setResponses([fauxAssistantMessage(fauxText('stream '.repeat(200))),fauxAssistantMessage('ok')]);
  const running=session.prompt('stream');await ready;const begin=performance.now();await wrapper.send({type:'abort'});await running;
  const elapsed=performance.now()-begin;t.diagnostic(`SDK 流取消耗时 ${elapsed.toFixed(0)} ms`);
  assert.ok(elapsed<3000);assert.equal(session.isIdle,true);assert.equal(aborted,true);
  await session.prompt('again');assert.equal(session.getLastAssistantText(),'ok');
});

test('auto 保留当前模型偏好及启用范围优先级，不能改成固定模型或固定档位',async t=>{
  const {session,wrapper,settingsManager}=await fixture(t);
  const {provider,id}=session.model;
  settingsManager.setModelThinkingLevel(provider,id,'medium');
  assert.equal((await wrapper.send({type:'set_thinking_level',level:'auto'})).thinkingLevel,'medium');
  settingsManager.setEnabledModels([`${provider}/${id}:high`]);
  assert.equal((await wrapper.send({type:'set_thinking_level',level:'auto'})).thinkingLevel,'high');
  assert.equal(settingsManager.getDefaultThinkingLevel(),'low');
});
test('MCP 收尾不能阻挡模型中止，重复停止共用同一次取消',async t=>{
  let finishWait,finishAbort,calls=0;const wait=new Promise(done=>{finishWait=done;});const abort=new Promise(done=>{finishAbort=done;});
  const inner={sessionId:'held',isStreaming:true,isCompacting:false,isBashRunning:false,agent:{state:{}},abort:()=>{calls++;return abort;},dispose(){}};
  const wrapper=new AgentSessionWrapper(inner);t.after(()=>wrapper.destroy());wrapper.mcpPromptWait={controller:new AbortController(),done:wait};
  const first=wrapper.send({type:'abort'}),second=wrapper.send({type:'abort'});
  assert.equal(calls,1);assert.equal(wrapper.mcpPromptWait.controller.signal.aborted,true);
  finishWait();inner.isStreaming=false;finishAbort();await Promise.all([first,second]);
});
