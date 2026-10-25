import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { renderHook } from "./__fixtures__/react-hook-shim.mjs";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url)) } });
const { useResourceInstallTarget } = await jiti.import("./useResourceInstallTarget.ts");
const project = (id, name, path) => ({ id, name, revision: 1, defaultFolderId: id, folders: [{ id, name, path }] });
const projects = [project("qwen", "Qwen", "C:/work/qwen"), project("deepseek", "DeepSeek", "C:/work/deepseek"), project("vue", "vue", "D:/vue")];
const context = {
  cwd: "C:/history/switch", project: { key: "switch", root: "C:/history/switch" }, worktrees: null, currentWorktreePath: null,
  managedProjects: projects,
  projects: [
    { key: "old", root: "C:/history/old", alias: "约束对照1019" },
    { key: "default-a", root: "C:/history/a/default" },
    { key: "default-b", root: "C:/history/b/default" },
    { key: "switch", root: "C:/history/switch" },
    { key: "front", root: "C:/work/qwen/frontend" },
  ],
};
const renderTarget = (state = context) => renderHook(state => useResourceInstallTarget(state?.cwd ?? null, { defaultWorkspace: false }, state, false), state);

test("插件技能安装选项只列主页三个正式项目，不补入历史、最近或当前目录", () => {
  const hook = renderTarget();
  assert.deepEqual(hook.result.projects, projects.map(p => ({ key: `managed:${p.id}`, name: p.name, cwd: p.folders[0].path, projectId: p.id })));
  assert.equal(hook.result.scope, "global");
  assert.equal(hook.result.value, "default");
  assert.equal(hook.result.cwd, null);
  hook.rerender({ ...context, managedProjects: [] });
  assert.deepEqual(hook.result.projects, [], "正式清单已加载且为空时不能用历史记录补项目");
  hook.unmount();
});

test("同名项目按身份保留，多关联目录只显示一个项目，空目录项目沿用私有工作区", () => {
  const first = { ...projects[0], name: "同名", folders: [...projects[0].folders, { id: "back", name: "后端", path: "C:/work/qwen/backend" }] };
  const second = { ...projects[1], name: "同名" };
  const empty = { ...projects[2], folders: [], workspace: { id: "private", name: "工作区", path: "C:/private/vue", initialized: false } };
  const hook = renderTarget({ ...context, managedProjects: [first, second, empty] });
  assert.deepEqual(hook.result.projects.map(p => [p.key, p.name, p.cwd]), [
    ["managed:qwen", "同名", "C:/work/qwen"], ["managed:deepseek", "同名", "C:/work/deepseek"], ["managed:vue", "vue", "C:/private/vue"],
  ]);
  hook.unmount();
});

test("选择真实项目携带身份校验，移除后回到全局且不从历史中复活", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body); calls.push([url, body]);
    return Response.json({ cwd: body.cwd, projectRoot: body.cwd, projectKey: `managed:${body.projectId}` });
  });
  const hook = renderTarget();
  await hook.result.select("managed:vue"); hook.flush();
  assert.deepEqual(calls, [["/api/cwd/validate", { cwd: "D:/vue", projectId: "vue" }]]);
  assert.equal(hook.result.scope, "project");
  assert.equal(hook.result.cwd, "D:/vue");
  hook.rerender({ ...context, managedProjects: projects.slice(0, 2), projects: [...context.projects, { key: "vue-old", root: "D:/vue" }] });
  assert.equal(hook.result.scope, "global");
  assert.equal(hook.result.cwd, null);
  assert.equal(hook.result.projects.length, 2);
  hook.unmount();
});

test("首次选择等概览就绪才同时提交项目，连续选择只提交最后一次", async t => {
  const pending = new Map();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/api/cwd/validate") {
      const body = JSON.parse(init.body);
      return Response.json({ cwd: body.cwd, projectRoot: body.cwd, projectKey: body.projectId });
    }
    return new Promise(resolve => pending.set(url, resolve));
  });
  const hook = renderHook(() => useResourceInstallTarget(null, null, context, false, "plugins"));
  const first = hook.result.select("managed:qwen");
  await new Promise(resolve => setImmediate(resolve)); hook.flush();
  assert.equal(hook.result.cwd, null, "准备期间仍展示原范围");
  assert.equal(hook.result.selecting, true, "准备期间立即阻止操作");
  const second = hook.result.select("managed:vue");
  await new Promise(resolve => setImmediate(resolve));
  pending.get("/api/plugins?cwd=D%3A%2Fvue")(Response.json({ packages: ["vue"] }));
  await second; hook.flush();
  assert.equal(hook.result.cwd, "D:/vue");
  pending.get("/api/plugins?cwd=C%3A%2Fwork%2Fqwen")(Response.json({ packages: ["late"] }));
  await first; hook.flush();
  assert.equal(hook.result.cwd, "D:/vue", "落后的响应不能切回旧项目");
  assert.equal(hook.result.selecting, false);
  hook.unmount();
});
