import assert from "node:assert/strict";
import test from "node:test";
import { registeredWorkspace, validateWorkspaceSelection } from "./workspace-selection.ts";

test("已登记的 Windows 项目按实际路径恢复同一个键，保留用户别名关联", () => {
  const projects = { "c:\\work\\repo": { root: "C:\\Work\\Repo", pinnedAt: 1 } };
  assert.deepEqual(registeredWorkspace("C:/Work/Repo/", projects), { key: "c:\\work\\repo", root: "C:\\Work\\Repo" });
  assert.equal(registeredWorkspace("C:/Work/Repo-copy", projects), null);
  assert.equal(registeredWorkspace("/work/REPO", { "/work/repo": { root: "/work/repo", pinnedAt: 1 } }), null);
});

test("目录切换必须调用原有校验并采用服务端身份，不登记项目或请求模型", async () => {
  const calls = [];
  const result = await validateWorkspaceSelection("C:/Work/Repo", async (url, options) => {
    calls.push([url, options.method, JSON.parse(options.body)]);
    return Response.json({ cwd: "C:\\Work\\Repo", projectRoot: "C:\\Work\\Repo", projectKey: "c:\\work\\repo" });
  });
  assert.deepEqual(calls, [["/api/cwd/validate", "POST", { cwd: "C:/Work/Repo" }]]);
  assert.deepEqual(result, { cwd: "C:\\Work\\Repo", root: "C:\\Work\\Repo", key: "c:\\work\\repo" });
});

test("无效及取消的目录校验不会被当作可切换目录", async () => {
  await assert.rejects(validateWorkspaceSelection("/missing", async () => Response.json({ error: "Directory does not exist" }, { status: 400 })), /Directory does not exist/);
  await assert.rejects(validateWorkspaceSelection("/incomplete", async () => Response.json({ cwd: "/incomplete" })), /HTTP 200/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(validateWorkspaceSelection("/cancelled", async (_, options) => { options.signal.throwIfAborted(); }, controller.signal), { name: "AbortError" });
});
