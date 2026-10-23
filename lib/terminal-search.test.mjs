import test from "node:test";
import assert from "node:assert/strict";
import { searchTextRanges, searchTerminalBuffer } from "./terminal-search.ts";

test("同一行先出现部分匹配，不应漏掉后面的全字结果", () => {
  const text = "Needle needle needless NEEDLE";
  assert.equal(searchTextRanges(text, "Needle", {}).length, 4);
  assert.equal(searchTextRanges(text, "Needle", { caseSensitive: true }).length, 1);
  assert.equal(searchTextRanges(text, "Needle", { wholeWord: true }).length, 3);
  assert.equal(searchTextRanges(text, "Needle", { wholeWord: true, caseSensitive: true }).length, 1);
});

test("中文全字边界、正则组合、字面量和空匹配处理", () => {
  assert.equal(searchTextRanges("中文测试 中文测试 另中文测试", "中文测试", { wholeWord: true }).length, 2);
  assert.equal(searchTextRanges("Needle 中文测试 NEEDLE", "Needle|中文测试", { regex: true, wholeWord: true }).length, 3);
  assert.equal(searchTextRanges("a.b aXb", "a.b", {}).length, 1);
  assert.equal(searchTextRanges("bbb", "a*", { regex: true }).length, 0);
  assert.equal(searchTextRanges("😀😀", "(?=.)", { regex: true }).length, 0);
  assert.throws(() => searchTextRanges("text", "[", { regex: true }), SyntaxError);
  assert.equal(searchTextRanges("a a a a", "a", {}, 2).length, 2);
});

function line(characters, wrapped = false) {
  const cells = characters.map(([chars, width = 1]) => ({ getChars: () => chars, getWidth: () => width, getCode: () => chars.codePointAt(0) ?? 0 }));
  return { isWrapped: wrapped, length: cells.length, getCell: col => cells[col], translateToString: trim => {
    const text = cells.map(cell => cell.getWidth() === 0 ? "" : cell.getChars() || " ").join("");
    return trim ? text.trimEnd() : text;
  } };
}

test("中文和 emoji 的 UTF-16 偏移还原为宽字符单元格，跨软换行命中", () => {
  const rows = [line([["A"], ["中", 2], ["", 0], ["😀", 2], ["", 0]]), line([["B"], ["中", 2], ["", 0], ["文", 2], ["", 0]], true)];
  const buffer = { length: rows.length, getLine: row => rows[row] };
  assert.deepEqual(searchTerminalBuffer(buffer, 5, "中😀B", {}), [{ row: 0, col: 1, size: 5 }]);
  assert.deepEqual(searchTerminalBuffer(buffer, 5, "中文", {}), [{ row: 1, col: 1, size: 4 }]);
});

test("宽字符换行前留下的空单元格不成为搜索文本", () => {
  const rows = [line([["A"], ["B"], [""]]), line([["中", 2], ["", 0], ["C"]], true)];
  const buffer = { length: rows.length, getLine: row => rows[row] };
  assert.deepEqual(searchTerminalBuffer(buffer, 3, "B中C", {}), [{ row: 0, col: 1, size: 5 }]);
});
