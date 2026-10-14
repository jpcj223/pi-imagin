import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class FileOperationError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function childPath(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new FileOperationError("只能操作当前工作目录内的条目", 403);
  if (relative.split(path.sep).some(part => [".git", ".pi", ".pi-imagin-trash"].includes(part.toLowerCase()))) throw new FileOperationError("不能操作项目配置或回收目录", 403);
  return target;
}

export function validateEntryName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name === "." || name === "..") throw new FileOperationError("名称无效，请填写文件名而非路径");
}

/** 删除采用同目录原子移动，恢复时不覆盖后来创建的文件。 */
export function performFileOperation(cwd: string, source: string, action: "rename" | "delete" | "restore", name?: unknown, token?: unknown) {
  const root = fs.realpathSync(cwd);
  const original = childPath(root, path.resolve(root, source));
  const parent = fs.realpathSync(path.dirname(original));
  childPath(root, path.join(parent, path.basename(original)));
  const trash = path.join(root, ".pi-imagin-trash");
  if (action === "restore") {
    if (typeof token !== "string" || !/^[0-9a-f-]{36}$/.test(token)) throw new FileOperationError("恢复标识无效");
    if (!fs.existsSync(trash) || fs.lstatSync(trash).isSymbolicLink()) throw new FileOperationError("回收目录不可用", 403);
    const recordPath = path.join(trash, `${token}.json`);
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as { original: string };
    if (record.original !== original) throw new FileOperationError("恢复条目不匹配", 403);
    if (fs.existsSync(original)) throw new FileOperationError("原位置已有同名条目，不能覆盖", 409);
    fs.renameSync(path.join(trash, token), original);
    fs.unlinkSync(recordPath);
    return { path: original };
  }
  const info = fs.lstatSync(original);
  if (info.isSymbolicLink()) throw new FileOperationError("请在链接的实际目录中操作", 403);
  childPath(root, fs.realpathSync(original));
  if (action === "rename") {
    validateEntryName(name);
    const destination = childPath(root, path.join(parent, name));
    if (fs.existsSync(destination)) throw new FileOperationError("已有同名条目", 409);
    fs.renameSync(original, destination);
    return { path: destination };
  }
  if (fs.existsSync(trash) && (!fs.lstatSync(trash).isDirectory() || fs.lstatSync(trash).isSymbolicLink())) throw new FileOperationError("回收目录不可用", 403);
  fs.mkdirSync(trash, { recursive: true });
  if (fs.realpathSync(trash) !== trash) throw new FileOperationError("回收目录指向异常", 403);
  const id = randomUUID();
  const recordPath = path.join(trash, `${id}.json`);
  fs.writeFileSync(recordPath, JSON.stringify({ original }), { flag: "wx" });
  try { fs.renameSync(original, path.join(trash, id)); }
  catch (error) { fs.unlinkSync(recordPath); throw error; }
  return { path: original, token: id };
}
