/** Shell 提示符目录通知可能跨 PTY 数据块；只保留尚未完成的有界控制序列。 */
export function readTerminalDirectory(pending: string, output: string): { pending: string; cwd?: string } {
  const text = pending + output;
  const pattern = /\x1b\](7|9;9);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  let match: RegExpExecArray | null, cwd: string | undefined;
  let end = 0;
  while ((match = pattern.exec(text))) {
    end = pattern.lastIndex;
    try {
      let path = match[2];
      if (match[1] === "7") {
        const url = new URL(path);
        if (url.protocol !== "file:") continue;
        path = decodeURIComponent(url.pathname);
        if (/^\/[a-z]:\//i.test(path)) path = path.slice(1).replaceAll("/", "\\");
        else if (url.hostname && url.hostname !== "localhost") path = `//${url.hostname}${path}`;
      }
      if (path.length <= 4096 && !/[\x00-\x1f]/.test(path) && (/^[a-z]:[\\/]/i.test(path) || path.startsWith("/"))) cwd = path;
    } catch { /* 无效目录通知不影响终端输出。 */ }
  }
  const start = text.lastIndexOf("\x1b]");
  return { pending: start >= end && text.length - start <= 8192 ? text.slice(start) : "", cwd };
}
