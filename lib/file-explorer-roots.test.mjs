import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { explorerFolders, fileOwnerRoot, independentRoots } = await createJiti(import.meta.url).import("./file-paths.ts");

test("同名项目目录保留独立身份，Windows 大小写和分隔符不产生重复根", () => {
  const folders = explorerFolders([{name:"src",path:"C:\\front\\src"},{name:"src",path:"D:\\back\\src"},{name:"src",path:"c:/front/src/"}]);
  assert.equal(folders.length,2);
  assert.notEqual(folders[0].name,folders[1].name);
  assert.equal(fileOwnerRoot("C:/FRONT/src/index.js",folders,"fallback"),"c:/front/src/");
  assert.equal(fileOwnerRoot("D:/back/src/index.js",folders,"fallback"),"D:\\back\\src");
  assert.equal(fileOwnerRoot("D:/back/src-other/index.js",folders,"fallback"),"fallback");
});

test("嵌套根只统计一次 Git，文件操作仍优先使用最具体目录", () => {
  const folders=[{name:"all",path:"/work/app"},{name:"src",path:"/work/app/src"},{name:"back",path:"/work/backend"}];
  assert.deepEqual(independentRoots(folders),[folders[0],folders[2]]);
  assert.equal(fileOwnerRoot("/work/app/src/a.ts",folders,"fallback"),"/work/app/src");
  assert.equal(fileOwnerRoot("/Work/app/a.ts",folders,"fallback"),"fallback","POSIX 保持大小写敏感");
});
