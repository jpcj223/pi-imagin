import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const jiti=createJiti(import.meta.url);
const {getDraft,setDraft,clearDraft}=await jiti.import("./draft-store.ts");
const {saveNewSessionDraft,restoreNewSessionDraft}=await jiti.import("./new-session-draft.ts");
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
test("刷新快照恢复同一个新会话的文字与附件，且不覆盖其他目录",()=>{
 const store=storage(),key="new:draft-a:/work/a";const draft={value:"未发送的内容",images:[{data:"aGk=",mimeType:"image/png"}]};
 setDraft(key,draft);assert.equal(saveNewSessionDraft(key,store),true);clearDraft(key);
 assert.equal(restoreNewSessionDraft("new:draft-b:/work/b",store),false);
 assert.equal(restoreNewSessionDraft(key,store),true);assert.deepEqual(getDraft(key),draft);assert.equal(store.values.size,0);clearDraft(key);
});
test("已经存在的内存草稿比页面快照优先",()=>{
 const store=storage(),key="new:current:/work/a";setDraft(key,{value:"旧内容",images:[]});saveNewSessionDraft(key,store);
 setDraft(key,{value:"当前编辑",images:[]});assert.equal(restoreNewSessionDraft(key,store),false);assert.equal(getDraft(key).value,"当前编辑");clearDraft(key);
});
test("空白草稿和已有会话清理过期快照，不保存会话正文",()=>{
 const store=storage();store.setItem("pi-imagin:active-new-session-draft","old");
 assert.equal(saveNewSessionDraft("session-id",store),true);assert.equal(store.values.size,0);
 store.setItem("pi-imagin:active-new-session-draft","old");assert.equal(saveNewSessionDraft(null,store),true);assert.equal(store.values.size,0);
});
test("不同标签的快照彼此独立",()=>{
 const a=storage(),b=storage(),key="new:tab:/work/a";setDraft(key,{value:"标签 A",images:[]});saveNewSessionDraft(key,a);clearDraft(key);
 assert.equal(restoreNewSessionDraft(key,b),false);assert.equal(restoreNewSessionDraft(key,a),true);clearDraft(key);
});
test("损坏、非法图片和过大记录不恢复，预算或配额失败不影响内存草稿",()=>{
 const store=storage(),key="new:bounds:/work/a",name="pi-imagin:active-new-session-draft";
 for(const value of ["{",JSON.stringify({version:1,key,draft:{value:"bad",images:[{data:"invalid",mimeType:"image/png"}]}}),"x".repeat(2*1024*1024+1)]){
  store.setItem(name,value);assert.equal(restoreNewSessionDraft(key,store),false);
 }
 setDraft(key,{value:"x".repeat(2*1024*1024),images:[]});assert.equal(saveNewSessionDraft(key,store),false);assert.ok(getDraft(key));assert.equal(store.values.size,0);
 const blocked={getItem(){throw Error("blocked");},setItem(){throw Error("blocked");},removeItem(){throw Error("blocked");}};
 assert.equal(saveNewSessionDraft(key,blocked),false);assert.equal(restoreNewSessionDraft(key,blocked),false);clearDraft(key);
});
