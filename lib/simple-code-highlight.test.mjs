import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const { simpleCodeTokens } = await createJiti(import.meta.url).import("./simple-code-highlight.ts");
test("通用高亮保留 Vue、Java、Python 与混合内容原文，不执行 HTML",()=>{
  for(const text of ['<template><div>{{ name }}</div></template>\n<script setup>const x = "中文";</script>', 'public class Test { int x = 42; // note\n}', '# 注释\ndef main():\n  return "hello"', '<script>alert(1)</script> & <img onerror=x>']) {
    const tokens=simpleCodeTokens(text); assert.equal(tokens.map(token=>token.text).join(""),text);assert.ok(tokens.some(token=>token.kind!=="plain"));
  }
  assert.deepEqual(simpleCodeTokens('x'.repeat(100001)).map(token=>token.kind),['plain']);
});
