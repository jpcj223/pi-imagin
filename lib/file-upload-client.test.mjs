import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { dropMentionText, splitDroppedItems, readDroppedItems } = await jiti.import("./file-upload-client.ts");

const file = (name, type = "") => new File(["x"], name, { type });

test("拖放读取保留文件并识别系统文件夹，不将目录伪装成零字节文件", () => {
  const text=file("资料.txt");
  assert.deepEqual(readDroppedItems({items:[{kind:"file",webkitGetAsEntry:()=>({isDirectory:true,name:"folder"}),getAsFile:()=>null},{kind:"file",getAsFile:()=>text}],files:[]}),[{kind:"folder",name:"folder"},{kind:"file",file:text}]);
  assert.deepEqual(readDroppedItems({items:[],files:[text]}),[{kind:"file",file:text}]);
});

test("a chat drop attaches images, uploads other files, and leaves folders out", () => {
  const photo = file("photo.png", "image/png");
  const notes = file("notes.md", "text/markdown");
  const data = file("data.bin");
  const result = splitDroppedItems([
    { kind: "file", file: photo },
    { kind: "file", file: notes },
    { kind: "folder", name: "src" },
    { kind: "file", file: data },
  ]);
  assert.deepEqual(result.images, [photo]);
  assert.deepEqual(result.files, [notes, data]);
  assert.deepEqual(result.folders, ["src"]);
});

test("mentions follow the drop order and only name files now in the working directory", () => {
  const files = [file("b.txt"), file("my notes.md"), file("failed.log"), file("a.txt")];
  assert.equal(
    dropMentionText(files, ["a.txt", "my notes.md", "b.txt"]),
    '@b.txt @"my notes.md" @a.txt ',
  );
  assert.equal(dropMentionText(files, []), "");
});
