import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const store = await jiti.import("./file-edit-drafts.ts");
const a = "a".repeat(64), b = "b".repeat(64);
test("保存途中继续输入不会被迟到响应覆盖", async t => {
  const file = "/isolated/editing.txt"; let resolve;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (JSON.parse(options.body).action === "read") return Response.json({editable:true,text:"base",version:a});
    return new Promise(done => { resolve = () => done(Response.json({editable:true,text:"sent",version:b})); });
  });
  globalThis.window = { dispatchEvent() {} };
  await store.refreshFileDraft(file); store.changeFileDraft(file,"sent"); const save = store.saveFileDraft(file);
  store.changeFileDraft(file,"new typing"); resolve(); assert.equal(await save, false);
  const draft = store.getFileEditDraft(file); assert.equal(draft.text,"new typing"); assert.equal(draft.baseText,"sent"); assert.equal(draft.version,b); assert.equal(store.fileDraftDirty(draft),true);
  store.discardFileDraft(file);
});
test("外部变化保留本地草稿并提供磁盘比较；采用磁盘版本后解除脏状态", async t => {
  const file="/isolated/conflict.txt"; let external=false;
  t.mock.method(globalThis,"fetch",async()=>Response.json({editable:true,text:external?"external":"base",version:external?b:a}));
  await store.refreshFileDraft(file); store.changeFileDraft(file,"local"); external=true; await store.refreshFileDraft(file);
  assert.equal(store.getFileEditDraft(file).text,"local"); assert.equal(store.getFileEditDraft(file).conflict.text,"external");
  store.adoptDiskFileDraft(file); assert.equal(store.getFileEditDraft(file).text,"external"); assert.equal(store.fileDraftDirty(store.getFileEditDraft(file)),false);store.discardFileDraft(file);
});
test("保存失败保留修改，大小写路径复用 Windows 草稿身份", async t => {
  const file="C:\\project\\file.txt"; let failure=false;
  t.mock.method(globalThis,"fetch",async()=>failure?Response.json({error:"禁止写入"},{status:403}):Response.json({editable:true,text:"base",version:a}));
  await store.refreshFileDraft(file);store.changeFileDraft(file,"keep");failure=true;
  assert.equal(await store.saveFileDraft(file),false);assert.equal(store.getFileEditDraft("c:/PROJECT/file.txt").text,"keep");assert.equal(store.getFileEditDraft(file).saving,false);store.discardFileDraft(file);
});
test("目录操作保护所有子文件的未保存修改，但不影响同名前缀目录", async t => {
  const file="C:/project/src/file.txt";
  t.mock.method(globalThis,"fetch",async()=>Response.json({editable:true,text:"base",version:a}));
  await store.refreshFileDraft(file);store.changeFileDraft(file,"dirty");
  assert.equal(store.hasFileEditsWithin("c:\\PROJECT\\src"),true);
  assert.equal(store.hasFileEditsWithin("C:/project/src-old"),false);
  store.forgetCleanFileEditsWithin("C:/project");assert.equal(store.getFileEditDraft(file).text,"dirty");store.discardFileDraft(file);
});
test("保存前发出的迟到读取不能覆盖已保存的新内容", async t => {
  const file="/isolated/late-read.txt";let reads=0,resolve;
  t.mock.method(globalThis,"fetch",async(_url,options)=>{
    if(JSON.parse(options.body).action==='save') return Response.json({editable:true,text:'saved',version:b});
    if(reads++===0)return Response.json({editable:true,text:'old',version:a});
    return new Promise(done=>{resolve=()=>done(Response.json({editable:true,text:'old',version:a}));});
  });
  globalThis.window={dispatchEvent(){}};await store.refreshFileDraft(file);const pending=store.refreshFileDraft(file);store.changeFileDraft(file,'saved');assert.equal(await store.saveFileDraft(file),true);resolve();assert.equal(await pending,null);assert.equal(store.getFileEditDraft(file).text,'saved');assert.equal(store.getFileEditDraft(file).version,b);store.discardFileDraft(file);
});
test("编辑器行引用保留 Unicode 与行首结束边界",()=>{
  const text='中文\nsecond\nthird';assert.deepEqual(store.selectedFileLines(text,0,3),{startLine:1,endLine:1});assert.deepEqual(store.selectedFileLines(text,3,10),{startLine:2,endLine:2});assert.equal(store.selectedFileLines(text,0,0),null);
});

test("目录操作同步锁住编辑和保存，失败解锁后草稿可继续编辑", async t => {
  const file='C:/locking/src/a.txt';let reads=0,release;
  t.mock.method(globalThis,'fetch',async()=> ++reads===1?Response.json({editable:true,text:'base',version:a}):new Promise(done=>{release=()=>done(Response.json({editable:true,text:'late',version:b}));}));
  await store.refreshFileDraft(file);const late=store.refreshFileDraft(file);
  const unlock=store.lockFileEditsWithin('c:\\LOCKING\\src');
  assert.equal(store.isFileEditLocked(file),true);assert.equal(store.isFileEditLocked('C:/locking/src-other/a.txt'),false);
  store.changeFileDraft(file,'blocked');assert.equal(store.getFileEditDraft(file).text,'base');
  assert.equal(await store.saveFileDraft(file),false);assert.equal(await store.refreshFileDraft(file),null);
  assert.throws(()=>store.lockFileEditsWithin('C:/locking'),/其他操作/);
  unlock();release();assert.equal(await late,null);assert.equal(store.getFileEditDraft(file).text,'base');
  store.changeFileDraft(file,'after failure');assert.equal(store.getFileEditDraft(file).text,'after failure');
  assert.throws(()=>store.lockFileEditsWithin('C:/locking/src'),/未保存/);store.discardFileDraft(file);
});

test("成功重命名/删除释放旧草稿，首次读取的迟到响应不能复活旧路径",async t=>{
  const file='/locking-first/a.txt';let release;
  t.mock.method(globalThis,'fetch',()=>new Promise(done=>{release=()=>done(Response.json({editable:true,text:'late',version:a}));}));
  const late=store.refreshFileDraft(file);const unlock=store.lockFileEditsWithin('/locking-first');
  store.forgetCleanFileEditsWithin('/locking-first');unlock();release();
  assert.equal(await late,null);assert.equal(store.getFileEditDraft(file),null);
});
