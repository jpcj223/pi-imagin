import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { getCompactionInfoKey } from '../lib/compaction-feedback.ts';

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

test('压缩按钮和斜杠命令将明确的无操作结果作为提示，真实失败仍保留错误', async () => {
  for (const error of ['Nothing to compact (session too small)', 'Already compacted', 'Network error']) {
    const state = { busy: false, error: null, result: null, notices: [] };
    const environment = {
      sessionIdRef: { current: 's' }, isCompacting: false, getCompactionInfoKey,
      sendAgentCommand: async () => { throw new Error(error); },
      setIsCompacting: value => { state.busy = value; },
      setCompactError: value => { state.error = typeof value === 'function' ? value(state.error) : value; },
      setCompactResult: value => { state.result = value; },
      addNotice: value => state.notices.push(value),
    };
    const result = await callback('handleBuiltinSlashCommand', environment)('/compact');
    assert.equal(state.busy, false);
    if (getCompactionInfoKey(error)) {
      assert.deepEqual(result, { handled: true });
      assert.equal(state.error, error);
      assert.deepEqual(state.notices, []);
    } else {
      assert.equal(result.error, error);
      assert.equal(state.notices[0].type, 'error');
    }
    await callback('handleCompact', environment)();
    assert.equal(state.error, error);
    assert.equal(state.busy, false);
  }
});

test('重复压缩的请求及实时事件不卸载已有中性提示，成功或取消后才清除', async () => {
  const info = 'Nothing to compact (session too small)';
  for (const entry of ['handleCompact', 'handleBuiltinSlashCommand']) {
    let error = info, busy = false, reject;
    const history = [];
    const environment = {
      sessionIdRef: { current: 's' }, isCompacting: false, getCompactionInfoKey,
      sendAgentCommand: () => new Promise((_resolve, fail) => { reject = fail; }),
      setIsCompacting: value => { busy = value; },
      setCompactError: value => { error = typeof value === 'function' ? value(error) : value; history.push(error); },
      setCompactResult() {}, addNotice() {}, readCompactResult: () => ({ tokensBefore: 100 }), loadSession() {},
    };
    const handle = callback(entry, environment);
    const event = callback('handleAgentEvent', environment);
    for (let attempt = 0; attempt < 3; attempt++) {
      const pending = handle('/compact');
      assert.equal(busy, true);
      assert.equal(error, info);
      event({ type: 'compaction_start' });
      assert.equal(error, info);
      event({ type: 'compaction_end', errorMessage: `Compaction failed: ${info}` });
      reject(new Error(info));
      await pending;
      assert.equal(busy, false);
      assert.equal(error, info);
    }
    assert.ok(history.every(value => getCompactionInfoKey(value)), '过程中没有清空提示');
    event({ type: 'compaction_end', aborted: true });
    assert.equal(error, null);
    error = info;
    event({ type: 'compaction_end', result: {} });
    assert.equal(error, null);
  }
});
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
