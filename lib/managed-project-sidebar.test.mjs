import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { managedProjectSidebar } = await jiti.import("./managed-project-sidebar.ts");
const { buildSessionTree, buildArchiveRows } = await jiti.import("./session-tree.ts");
const { emptySessionUiState } = await jiti.import("./session-ui-state-shared.ts");
const { fileProjectChoices } = await jiti.import("./new-session-context.ts");

test("侧栏与文件菜单共用正式项目，历史目录会话保留在默认和归档区", () => {
  const project = { id:"p",name:"应用",revision:1,defaultFolderId:"front",folders:[{id:"front",name:"前端",path:"C:/app/front"},{id:"back",name:"后端",path:"C:/app/back"}] };
  const state={version:1,revision:1,projects:[project],sessions:{}};
  const sessions=["C:/app/front","C:/app/back","C:/fixtures/0/default","C:/fixtures/1/default","C:/fixtures/switch"].map((cwd,i)=>({id:`s${i}`,cwd,projectKey:cwd,projectRoot:cwd,path:`${cwd}/s.jsonl`,modified:new Date().toISOString(),created:new Date().toISOString(),firstMessage:"任务",messageCount:1}));
  const ui=emptySessionUiState();ui.projects["C:/fixtures/switch"]={root:"C:/fixtures/switch",pinnedAt:1};ui.sessions.s4={archivedAt:1};
  const original=structuredClone({state,sessions,ui});
  const display=managedProjectSidebar(state,sessions,ui,{key:"C:/fixtures/0/default",root:"C:/fixtures/0/default"});
  const input={...display,currentProject:display.current,runningIds:new Set(),unreadIds:new Set(),selectedSessionId:"s2",groupExpansion:{"managed:p":true},moreShown:{},pinnedCollapsed:false,showPins:false};
  const tree=buildSessionTree(input);
  assert.deepEqual(tree.projects.map(p=>p.key),["managed:p"]);
  assert.equal(display.current,null);
  assert.deepEqual(tree.projects.map(p=>p.name),fileProjectChoices({managedProjects:[project],projects:[],project:null,worktrees:null,currentWorktreePath:null}).map(p=>p.name));
  const ids=new Set([...tree.rows,...buildArchiveRows(input)].filter(row=>row.kind==="session").map(row=>row.family.root.id));
  for(const session of sessions) assert.ok(ids.has(session.id),`历史会话丢失：${session.id}`);
  assert.deepEqual({state,sessions,ui},original,"只转换展示副本，不写入会话和项目数据");
});

test("没有正式项目时也不根据临时目录自动生成项目", () => {
  const state={version:1,revision:0,projects:[],sessions:{}};
  const session={id:"legacy",cwd:"/tmp/task",projectKey:"/tmp/task",firstMessage:"旧会话",modified:new Date().toISOString()};
  const display=managedProjectSidebar(state,[session],emptySessionUiState(),{key:"/tmp/task",root:"/tmp/task"});
  assert.equal(display.sessions[0],session);
  assert.deepEqual(display.uiState.projects,{});
  assert.ok(display.uiState.removedProjects.includes("/tmp/task"));
  assert.equal(display.current,null);
});
