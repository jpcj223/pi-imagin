import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { performFileOperation, validateEntryName } from "./file-operations.ts";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-imagin-file-actions-"));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir());assert.ok(path.basename(root).startsWith("pi-imagin-file-actions-"));fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
test("名称拒绝路径与 Windows 保留名", () => {
  for (const name of ["../x", "a/b", "a\\b", "CON", "NUL.txt", "file.", "", ".git"]) {
    if (name === ".git") continue;
    assert.throws(() => validateEntryName(name));
  }
  assert.doesNotThrow(() => validateEntryName("项目说明.md"));
});
test("重命名不覆盖文件，不能移到工作区外或操作项目根", t => {
  const root = fixture(t), file = path.join(root, "a.md");fs.writeFileSync(file, "内容");
  fs.writeFileSync(path.join(root, "b.md"), "保留");
  assert.throws(() => performFileOperation(root, file, "rename", "b.md"));
  assert.throws(() => performFileOperation(root, root, "delete"));
  assert.throws(() => performFileOperation(root, path.dirname(root), "delete"));
  assert.throws(() => performFileOperation(root, file, "rename", ".git"));
  const renamed = performFileOperation(root, file, "rename", "c.md");assert.equal(fs.readFileSync(renamed.path, "utf8"), "内容");
});
test("删除可恢复，恢复拒绝覆盖新文件", t => {
  const root = fixture(t), file = path.join(root, "a.txt");fs.writeFileSync(file, "原文件");
  const removed = performFileOperation(root, file, "delete");assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, "新文件");assert.throws(() => performFileOperation(root, file, "restore", undefined, removed.token));
  fs.unlinkSync(file);performFileOperation(root, file, "restore", undefined, removed.token);assert.equal(fs.readFileSync(file, "utf8"), "原文件");
});
