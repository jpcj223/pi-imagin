// 复用运行中的本地服务，仅在 test-results 下自建测试目录操作文件。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const base = process.env.PI_WEB_TEST_BASE || "http://127.0.0.1:30141";
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname));
const artifacts = path.resolve("test-results");fs.mkdirSync(artifacts, { recursive: true });
const cwd = fs.mkdtempSync(path.join(artifacts, "workspace-api-"));
async function request(endpoint, body) {
  const response = await fetch(`${base}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
try {
  assert.equal((await request("/api/cwd/validate", { cwd })).status, 200);
  const original = path.join(cwd, "original.txt"), renamed = path.join(cwd, "renamed.txt");
  fs.writeFileSync(original, "测试内容");
  assert.equal((await request("/api/file-actions", { cwd, path: original, action: "rename", name: "renamed.txt" })).status, 200);
  assert.equal(fs.readFileSync(renamed, "utf8"), "测试内容");
  const deleted = await request("/api/file-actions", { cwd, path: renamed, action: "delete" });assert.equal(deleted.status, 200);assert.equal(fs.existsSync(renamed), false);
  assert.equal((await request("/api/file-actions", { cwd, path: renamed, action: "restore", token: deleted.data.token })).status, 200);
  assert.equal(fs.readFileSync(renamed, "utf8"), "测试内容");
  assert.equal((await request("/api/file-actions", { cwd, path: cwd, action: "delete" })).status, 403);
  assert.equal((await request("/api/file-actions", { cwd, path: renamed, action: "rename", name: "../escape.txt" })).status, 400);
  console.log("真实文件接口验证通过：重命名、回收、恢复、项目根保护与路径拒绝。");
} finally {
  assert.equal(path.dirname(cwd), artifacts);assert.ok(path.basename(cwd).startsWith("workspace-api-"));
  fs.rmSync(cwd, { recursive: true, force: true });
}
