import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// 提取实际回调，受控网络用于检查点击后的状态与失败路径，不调用付费模型。
const source=readFileSync(new URL('./useAgentSession.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('hook.ts',source,ts.ScriptTarget.Latest,true);
function callback(name,environment){
  let found;
  const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)found=node.initializer.arguments[0];ts.forEachChild(node,visit);};visit(ast);
  assert.ok(found,name);
  const js=ts.transpileModule(`const fn=${found.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(environment),`${js};return fn;`)(...Object.values(environment));
}
function setup(sendAgentCommand,isNew=false){
  const state={busy:false,auto:false,live:'high',override:null,newLevel:'high',stop:null,notices:[]};
  const environment={isNew,sendAgentCommand,sessionIdRef:{current:'s'},sessionHookMountedRef:{current:true},ensuringNewSessionRef:{current:null},
    thinkingRequestRef:{current:false},thinkingLevelOverrideRef:{current:'high'},stopRequestRef:{current:null},bashRunningRef:{current:false},agentRunningRef:{current:true},
    asConcreteThinkingLevel:value=>['off','low','medium','high'].includes(value)?value:null,
    setNewSessionThinkingLevel:value=>{state.newLevel=value;},setCurrentThinkingOverride:value=>{state.override=value;},setThinkingSwitching:value=>{state.busy=value;},
    setLiveThinkingLevel:value=>{state.live=value;},setCurrentThinkingAuto:value=>{state.auto=value;},setNewSessionDefaultThinkingLevel:value=>{state.default=value;},
    setStopStatus:value=>{state.stop=value;},addNotice:value=>state.notices.push(value)};
  return {state,environment};
}
test('已有运行会话选择 auto 发出更新，反馈实际强度并避免并发覆盖',async()=>{
  const calls=[];let release;const {state,environment}=setup((_sid,body)=>{calls.push(body);return new Promise(done=>{release=done;});});
  const change=callback('handleThinkingLevelChange',environment);const pending=change('auto');
  assert.equal(state.busy,true);assert.deepEqual(calls,[{type:'set_thinking_level',level:'auto'}]);
  await change('low');assert.equal(calls.length,1);release({thinkingLevel:'medium'});await pending;
  assert.equal(state.live,'medium');assert.equal(state.auto,true);assert.equal(state.busy,false);assert.match(state.notices[0].message,/下一次模型请求/);
});
test('切换失败恢复原选择并显示错误，新会话初始化失败也解除等待',async()=>{
  const {state,environment}=setup(async()=>{throw Error('offline');},true);
  await callback('handleThinkingLevelChange',environment)('low');assert.equal(state.newLevel,'high');assert.equal(state.busy,false);assert.equal(state.live,'high');assert.match(state.notices[0].message,/offline/);
  environment.sessionIdRef.current=null;environment.ensuringNewSessionRef.current=Promise.reject(Error('startup'));
  await callback('handleThinkingLevelChange',environment)('auto');assert.equal(state.busy,false);assert.equal(state.newLevel,'high');
});
test('停止立即反馈，重复点击不重复请求；失败允许重试且不伪造任务已结束',async()=>{
  let calls=0,reject;const {state,environment}=setup(()=>{calls++;return new Promise((_done,fail)=>{reject=fail;});});
  const stop=callback('handleAbort',environment);const pending=stop();assert.equal(state.stop,'stopping');await stop();assert.equal(calls,1);
  reject(Error('connection lost'));await pending;assert.equal(state.stop,null);assert.equal(environment.agentRunningRef.current,true);assert.match(state.notices[0].message,/停止失败/);
});
test('迟到停止响应不能清除另一会话的停止状态',async()=>{
  let release;const {state,environment}=setup(()=>new Promise(done=>{release=done;}));
  const pending=callback('handleAbort',environment)();environment.sessionIdRef.current='other';environment.stopRequestRef.current={sid:'other'};state.stop='delayed';
  release();await pending;assert.equal(state.stop,'delayed');
});
