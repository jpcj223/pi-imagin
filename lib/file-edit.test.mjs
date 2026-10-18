import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { readEditableFile, saveEditableFile, FILE_EDIT_MAX_BYTES } = await jiti.import("./file-edit.ts");
function fixture(t, bytes) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-editor-")));
  const file = path.join(root, "source.txt"); fs.writeFileSync(file, bytes);
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return { root, file, roots: new Set([root]) };
}
test("保存保留 UTF-8 BOM、UTF-16 两种字节序及原换行", async t => {
  for (const format of ["utf8", "bom", "utf16le", "utf16be"]) await t.test(format, async t => {
    let bytes = Buffer.from("原文\r\n下一行\r\n", format.startsWith("utf16") ? "utf16le" : "utf8");
    if (format === "utf16be") bytes = bytes.swap16();
    const bom = format === "bom" ? Buffer.from([239,187,191]) : format === "utf16le" ? Buffer.from([255,254]) : format === "utf16be" ? Buffer.from([254,255]) : Buffer.alloc(0);
    const { file, roots, root } = fixture(t, Buffer.concat([bom, bytes]));
    const initial = readEditableFile(file, roots); assert.equal(initial.text, "原文\n下一行\n"); assert.equal(initial.editable, true);
    const result = await saveEditableFile(file, roots, "修改\n末行\n", initial.version);
    assert.equal(result.text, "修改\n末行\n"); assert.equal(result.newline, "CRLF");
    let expected = Buffer.from("修改\r\n末行\r\n", format.startsWith("utf16") ? "utf16le" : "utf8"); if (format === "utf16be") expected = expected.swap16();
    assert.deepEqual(fs.readFileSync(file), Buffer.concat([bom, expected])); assert.deepEqual(fs.readdirSync(root), ["source.txt"]);
  });
});
test("外部更新、同内容替换和并发保存不能被旧版本覆盖", async t => {
  const { file, roots, root } = fixture(t, "initial"); const first = readEditableFile(file, roots);
  fs.writeFileSync(file, "external"); await assert.rejects(saveEditableFile(file, roots, "mine", first.version), e => e.status === 409);
  assert.equal(fs.readFileSync(file, "utf8"), "external");
  const current = readEditableFile(file, roots);
  const outcomes = await Promise.allSettled([saveEditableFile(file, roots, "one", current.version), saveEditableFile(file, roots, "two", current.version)]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(result => result.status === "rejected").reason.status, 409);
  const previous = readEditableFile(file, roots), replacement = path.join(root, "replacement");
  fs.writeFileSync(replacement, previous.text); fs.renameSync(replacement, file);
  await assert.rejects(saveEditableFile(file, roots, "stale", previous.version), e => e.status === 409);
});
test("只读、二进制、混合换行、旧编码和大文件保留原件", async t => {
  for (const bytes of [Buffer.from([0,1,2]),Buffer.from([0xff,0x80]),Buffer.from("a\r\nb\nc"),Buffer.alloc(FILE_EDIT_MAX_BYTES + 1,65)]) {
    const { file, roots } = fixture(t, bytes); assert.equal(readEditableFile(file, roots).editable, false); assert.deepEqual(fs.readFileSync(file), bytes);
  }
  const { file, roots } = fixture(t, "readonly"); fs.chmodSync(file, 0o444); t.after(() => { if (fs.existsSync(file)) fs.chmodSync(file, 0o644); });
  assert.equal(readEditableFile(file, roots).editable, false);
});
test("保存前拒绝超行数、超尺寸及非文本字符，失败不改原件", async t => {
  const { file, roots }=fixture(t,"original");const initial=readEditableFile(file,roots);
  for(const value of ['a\n'.repeat(10001),'a'.repeat(FILE_EDIT_MAX_BYTES+1),'a\0b','\ud800'])
    await assert.rejects(saveEditableFile(file,roots,value,initial.version));
  assert.equal(fs.readFileSync(file,'utf8'),'original');
  fs.linkSync(file,file+'.hardlink');assert.equal(readEditableFile(file,roots).editable,false);
});
test("外部链接、父目录、内部配置和非普通文件不扩大写入权限", async t => {
  const { root, file, roots } = fixture(t, "safe"), outside = fixture(t, "outside");
  assert.throws(() => readEditableFile(outside.file, roots), e => e.status === 403);
  assert.throws(() => readEditableFile(`${root}/missing/../source.txt`, roots));
  fs.mkdirSync(path.join(root, ".git")); fs.writeFileSync(path.join(root, ".git/config"), "protected");
  assert.throws(() => readEditableFile(path.join(root, ".git/config"), roots), e => e.status === 403);
  assert.throws(() => readEditableFile(root, roots));
  const link = path.join(root, "outside-link"); fs.symlinkSync(outside.root, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => readEditableFile(path.join(link, "source.txt"), roots), e => e.status === 403);
  assert.equal(fs.readFileSync(outside.file,"utf8"),"outside"); assert.equal(fs.readFileSync(file,"utf8"),"safe");
});
