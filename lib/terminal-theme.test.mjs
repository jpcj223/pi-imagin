import test from "node:test";
import assert from "node:assert/strict";
import { terminalTheme, terminalSearchColors } from "./terminal-theme.ts";

function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return .2126 * r + .7152 * g + .0722 * b;
}
for (const theme of ["light", "mist", "rose", "dark", "pine"]) {
  test(`${theme} 终端正文和完整 ANSI 前景保持可读对比度`, () => {
    const palette = terminalTheme(theme);
    const bg = luminance(palette.background);
    for (const key of ["foreground", "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"]) {
      const fg = luminance(palette[key]);
      const contrast = (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05);
      assert.ok(contrast >= 4.5, `${theme}/${key}: ${contrast.toFixed(2)}`);
    }
    const search = terminalSearchColors(theme);
    assert.notEqual(search.matchBackground, search.activeMatchBackground);
    assert.notEqual(search.matchBorder, search.activeMatchBorder);
  });
}
