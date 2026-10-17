import { homedir } from "os";
import path from "path";

// "Use default directory" opens a fresh folder per day, ~/pi-cwd/<YYYYMMDD>.
// The date keeps a first-time user from landing in a folder that already holds
// their own data, and doubles as a daily scratch cwd.
const DEFAULT_CWD_PARENT = "pi-cwd";

/** Local calendar date as YYYYMMDD, so the folder matches the user's "today". */
export function localDateStamp(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function defaultCwdPath(now = new Date(), home = homedir()): string {
  return path.join(defaultCwdParent(home), localDateStamp(now));
}

export function defaultCwdParent(home = homedir()): string {
  // 桌面调试的默认草稿目录与正式版分离；普通 Web 和安装版保留原有路径。
  const development = process.env.PI_IMAGIN_DESKTOP_DEV === "1" && process.env.PI_IMAGIN_DESKTOP_DEV_WORKSPACE;
  if (development && path.isAbsolute(development)) return development;
  return path.join(home, DEFAULT_CWD_PARENT);
}
