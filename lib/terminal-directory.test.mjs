import test from "node:test";
import assert from "node:assert/strict";
import { readTerminalDirectory } from "./terminal-directory.ts";

test("目录通知跨数据块、支持 CMD 原始路径与 PowerShell URI", () => {
  const first = readTerminalDirectory("", "prompt\x1b]9;9;C:\\中文 %20\\项目");
  assert.equal(first.cwd, undefined);
  assert.equal(readTerminalDirectory(first.pending, "\x1b\\C:\\中文 %20\\项目>").cwd, "C:\\中文 %20\\项目");
  assert.equal(readTerminalDirectory("", "\x1b]7;file:///C:/%E4%B8%AD%E6%96%87%20%2520/project\x07").cwd, "C:\\中文 %20\\project");
});

test("忽略无效通知并限制未完成控制序列，不把普通输出识别为目录", () => {
  assert.equal(readTerminalDirectory("", "C:\\repo> echo text").cwd, undefined);
  assert.equal(readTerminalDirectory("", "\x1b]7;https://example.com/path\x07").cwd, undefined);
  assert.equal(readTerminalDirectory("", "\x1b]9;9;relative/path\x07").cwd, undefined);
  assert.equal(readTerminalDirectory("", "\x1b]9;9;" + "x".repeat(9000)).pending, "");
  assert.equal(readTerminalDirectory("", "\x1b]7;file:///one\x07\x1b]7;file:///two\x07").cwd, "/two");
});
