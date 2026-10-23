import type { Terminal, IDisposable, ITerminalAddon } from "@xterm/xterm";
import { searchTerminalBuffer, type TerminalSearchMatch, type TerminalSearchOptions } from "./terminal-search";

export type { TerminalSearchOptions } from "./terminal-search";

/** 使用 xterm 公开的缓冲区、标记和装饰接口，匹配与高亮保持同一份结果。 */
export class TerminalSearchAddon implements ITerminalAddon {
  private terminal?: Terminal;
  private subscriptions: IDisposable[] = [];
  private decorations: IDisposable[] = [];
  private listeners = new Set<(event: { resultIndex: number; resultCount: number }) => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private matches: TerminalSearchMatch[] = [];
  private index = -1;
  private query = "";
  private key = "";
  private options: TerminalSearchOptions = {};
  private limit: number;

  constructor(options: { highlightLimit?: number } = {}) { this.limit = options.highlightLimit ?? 10000; }
  activate(terminal: Terminal) {
    this.terminal = terminal;
    const update = () => {
      if (this.timer) return;
      if (!this.query) return;
      this.timer = setTimeout(() => { this.timer = undefined; this.rebuild(); }, 100);
    };
    this.subscriptions.push(terminal.onWriteParsed(update), terminal.onResize(update));
  }
  onDidChangeResults(listener: (event: { resultIndex: number; resultCount: number }) => void): IDisposable {
    this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) };
  }
  private fire() { for (const listener of this.listeners) listener({ resultIndex: this.index, resultCount: this.matches.length }); }
  private clearPainting() { for (const decoration of this.decorations.splice(0)) decoration.dispose(); }
  clearDecorations() {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.clearPainting(); this.matches = []; this.index = -1; this.query = ""; this.key = "";
    this.terminal?.clearSelection();
  }
  private rebuild(render = true) {
    if (!this.terminal || !this.query) return;
    this.matches = searchTerminalBuffer(this.terminal.buffer.active, this.terminal.cols, this.query, this.options, this.limit);
    this.index = this.matches.length ? Math.min(Math.max(0, this.index), this.matches.length - 1) : -1;
    if (render) { this.paint(); this.fire(); }
  }
  private paint() {
    this.clearPainting();
    const terminal = this.terminal, colors = this.options.decorations;
    if (!terminal || !colors) return;
    const cursor = terminal.buffer.active.baseY + terminal.buffer.active.cursorY;
    this.matches.forEach((match, index) => {
      let row = match.row, col = match.col, remaining = match.size;
      const active = index === this.index;
      while (remaining > 0) {
        const width = Math.min(remaining, terminal.cols - col);
        if (width <= 0) break;
        const marker = terminal.registerMarker(row - cursor);
        if (marker) {
          this.decorations.push(marker);
          const decoration = terminal.registerDecoration({ marker, x: col, width,
            backgroundColor: active ? colors.activeMatchBackground : colors.matchBackground,
            foregroundColor: active ? colors.activeMatchForeground : colors.matchForeground,
            layer: "top",
          });
          if (decoration) {
            this.decorations.push(decoration, decoration.onRender(element => {
              element.classList.add("xterm-find-result-decoration");
              element.classList.toggle("xterm-find-active-result-decoration", active);
              element.style.outline = `1px solid ${active ? colors.activeMatchBorder : colors.matchBorder}`;
            }));
          }
        }
        remaining -= width; row++; col = 0;
      }
    });
  }
  private find(query: string, options: TerminalSearchOptions = {}, backward = false): boolean {
    const terminal = this.terminal;
    if (!terminal || !query) { this.clearDecorations(); this.fire(); return false; }
    const key = JSON.stringify([query, options.caseSensitive, options.wholeWord, options.regex, options.decorations, terminal.cols]);
    const changed = key !== this.key;
    this.query = query; this.options = options; this.key = key;
    if (changed) { this.index = 0; this.rebuild(false); }
    else if (!options.incremental && this.matches.length) this.index = (this.index + (backward ? -1 : 1) + this.matches.length) % this.matches.length;
    this.paint();
    const current = this.matches[this.index];
    if (current) { terminal.scrollToLine(Math.max(0, current.row - 2)); }
    else terminal.clearSelection();
    this.fire(); return Boolean(current);
  }
  findNext(query: string, options?: TerminalSearchOptions) { return this.find(query, options); }
  findPrevious(query: string, options?: TerminalSearchOptions) { return this.find(query, options, true); }
  dispose() {
    this.clearDecorations();
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    this.listeners.clear(); this.terminal = undefined;
  }
}
