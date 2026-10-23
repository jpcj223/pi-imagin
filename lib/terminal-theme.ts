import type { ITheme } from "@xterm/xterm";
import type { ResolvedTheme } from "./theme";

const lightAnsi = {
  black: "#303945", red: "#9e344a", green: "#267046", yellow: "#805914",
  blue: "#275f9b", magenta: "#855094", cyan: "#176d78", white: "#465363",
  brightBlack: "#596777", brightRed: "#a02e42", brightGreen: "#226b46", brightYellow: "#805512",
  brightBlue: "#2b5c97", brightMagenta: "#884778", brightCyan: "#146b76", brightWhite: "#263440",
};
const darkAnsi = {
  black: "#acb5c3", red: "#f1a2ad", green: "#a6d4ac", yellow: "#e4c589",
  blue: "#a3c6ee", magenta: "#d2afe0", cyan: "#9fd3d7", white: "#dce5e8",
  brightBlack: "#aab6bf", brightRed: "#f3b1b8", brightGreen: "#b5ddb8", brightYellow: "#ebd09d",
  brightBlue: "#b4d2f2", brightMagenta: "#ddbee8", brightCyan: "#b0dfe2", brightWhite: "#f1f5f4",
};
const surfaces = {
  light: { background: "#fbfcfd", foreground: "#283743", accent: "#165e82", selection: "#d6e5f0" },
  mist: { background: "#e9f0ee", foreground: "#263f37", accent: "#1e6559", selection: "#c4dcd2" },
  rose: { background: "#f3edef", foreground: "#412d38", accent: "#914360", selection: "#e3cbd6" },
  dark: { background: "#242424", foreground: "#e5eaf0", accent: "#a3c6ee", selection: "#40546c" },
  pine: { background: "#212b28", foreground: "#e0ece4", accent: "#acccb7", selection: "#3a5547" },
} satisfies Record<ResolvedTheme, { background: string; foreground: string; accent: string; selection: string }>;

/** 终端独立调节 ANSI 前景色，防止浅色主题继承荧光黄、白色而看不清。 */
export function terminalTheme(theme: string | undefined): ITheme {
  const resolved = theme && Object.hasOwn(surfaces, theme) ? theme as ResolvedTheme : "light";
  const palette = surfaces[resolved];
  return {
    ...(resolved === "dark" || resolved === "pine" ? darkAnsi : lightAnsi),
    background: palette.background, foreground: palette.foreground,
    cursor: palette.accent, cursorAccent: palette.background,
    selectionBackground: palette.selection, selectionInactiveBackground: palette.selection,
    selectionForeground: palette.foreground,
  };
}

export function terminalSearchColors(theme: string | undefined) {
  const dark = theme === "dark" || theme === "pine";
  return {
    matchBackground: dark ? "#45432f" : "#f2e7bd",
    matchBorder: dark ? "#9c8d51" : "#bca15b",
    matchForeground: dark ? "#e5eaf0" : "#283743",
    activeMatchBackground: dark ? "#555035" : "#e8ce8b",
    activeMatchBorder: dark ? "#e5c681" : "#845a10",
    activeMatchForeground: dark ? "#e5eaf0" : "#283743",
    matchOverviewRuler: dark ? "#ab995c" : "#aa8738",
    activeMatchColorOverviewRuler: dark ? "#e5c681" : "#845a10",
  };
}
