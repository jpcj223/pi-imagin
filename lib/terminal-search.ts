import type { IBuffer } from "@xterm/xterm";

export interface TerminalSearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  incremental?: boolean;
  decorations?: {
    matchBackground: string; matchBorder: string; matchForeground?: string;
    activeMatchBackground: string; activeMatchBorder: string; activeMatchForeground?: string;
  };
}
export interface TerminalSearchMatch { row: number; col: number; size: number }

/** 使用 Unicode 单词边界，不依赖旧版 Safari 不支持的后行断言。 */
export function searchTextRanges(text: string, query: string, options: TerminalSearchOptions, limit = 10000): { index: number; length: number }[] {
  if (!query) return [];
  const pattern = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(pattern, options.caseSensitive ? "gu" : "giu");
  const word = /[\p{L}\p{N}\p{M}_]/u;
  const ranges = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) && ranges.length < limit) {
    if (!match[0].length) {
      regex.lastIndex += (text.codePointAt(regex.lastIndex) ?? 0) > 0xffff ? 2 : 1;
      continue;
    }
    const index = match.index, end = index + match[0].length;
    const beforeStart = index > 1 && /[\udc00-\udfff]/.test(text[index - 1]) ? index - 2 : index - 1;
    const before = index ? text.slice(beforeStart, index) : "";
    const after = end < text.length ? String.fromCodePoint(text.codePointAt(end)!) : "";
    if (!options.wholeWord || (!word.test(before) && !word.test(after))) ranges.push({ index, length: match[0].length });
  }
  return ranges;
}

/** 合并软换行后匹配，再将 UTF-16 字符偏移还原为终端单元格。 */
export function searchTerminalBuffer(buffer: IBuffer, cols: number, query: string, options: TerminalSearchOptions, limit = 10000): TerminalSearchMatch[] {
  const matches: TerminalSearchMatch[] = [];
  for (let row = 0; row < buffer.length && matches.length < limit;) {
    const fragments: { row: number; start: number; text: string }[] = [];
    let text = "";
    do {
      const line = buffer.getLine(row);
      if (!line) break;
      const next = buffer.getLine(row + 1);
      let part = line.translateToString(!next?.isWrapped, 0, cols);
      // 宽字符放不进最后一列时，xterm 会留下一个空单元格再换行。
      if (next?.isWrapped && line.getCell(cols - 1)?.getCode() === 0 && next.getCell(0)?.getWidth() === 2) part = part.slice(0, -1);
      fragments.push({ row, start: text.length, text: part });
      text += part; row++;
    } while (buffer.getLine(row)?.isWrapped);
    if (!fragments.length) { row++; continue; }
    const position = (index: number) => {
      const fragment = fragments.find((part, i) => index < part.start + part.text.length || i === fragments.length - 1)!;
      const line = buffer.getLine(fragment.row)!;
      const offset = index - fragment.start;
      let chars = 0, col = 0;
      for (; col < cols; col++) {
        const cell = line.getCell(col);
        if (!cell || cell.getWidth() === 0) continue;
        if (chars >= offset) break;
        chars += (cell.getChars() || " ").length;
      }
      return { row: fragment.row, col };
    };
    for (const range of searchTextRanges(text, query, options, limit - matches.length)) {
      const start = position(range.index), end = position(range.index + range.length);
      const size = (end.row - start.row) * cols + end.col - start.col;
      if (size > 0) matches.push({ ...start, size });
    }
  }
  return matches;
}
