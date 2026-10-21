import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { isExistingFilePathAllowed, isFilePathAllowed } from "./file-access";
import { hasParentDirectorySegment } from "./path-security";
import { serializeByKey } from "./key-serializer";

export const FILE_EDIT_MAX_BYTES = 1024 * 1024;
export class FileEditError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Encoding = "utf8" | "utf16le" | "utf16be";
export interface EditableFile {
  editable: boolean;
  reason?: string;
  text?: string;
  version?: string;
  encoding?: Encoding;
  newline?: "LF" | "CRLF" | "CR";
}

function authorizedFile(target: string, roots: Set<string>) {
  if (!path.isAbsolute(target) || hasParentDirectorySegment(target) || !isFilePathAllowed(target, roots)
    || !isExistingFilePathAllowed(target, roots)) throw new FileEditError("该文件不在允许编辑的项目范围内。", 403);
  const real = fs.realpathSync(target);
  if (!isFilePathAllowed(real, new Set([...roots].flatMap(root => {
    try { return [fs.realpathSync(root)]; } catch { return []; }
  })))) throw new FileEditError("文件实际位置不在项目范围内。", 403);
  if (real.split(/[\\/]/).some(part => [".git", ".pi", ".pi-imagin-trash"].includes(part.toLowerCase())))
    throw new FileEditError("此配置或内部文件仅支持查看。", 403);
  return real;
}

function snapshot(target: string, roots: Set<string>) {
  const real = authorizedFile(target, roots);
  const fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new FileEditError("只能编辑普通文本文件。");
    if (stat.size > FILE_EDIT_MAX_BYTES) return { real, stat, bytes: null, version: "" };
    const bytes = Buffer.alloc(FILE_EDIT_MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!read) break;
      length += read;
    }
    if (length > FILE_EDIT_MAX_BYTES) return { real, stat, bytes: null, version: "" };
    if (authorizedFile(target, roots) !== real) throw new FileEditError("文件位置已变化，请重新打开。", 409);
    const data = bytes.subarray(0, length);
    const version = createHash("sha256").update(`${real}\0${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}\0`).update(data).digest("hex");
    return { real, stat, bytes: data, version };
  } finally { fs.closeSync(fd); }
}

function decode(bytes: Buffer) {
  let encoding: Encoding = "utf8", bom = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "utf16le"; bom = 2; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "utf16be"; bom = 2; }
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bom = 3;
  // 文件 BOM 已单独处理，正文开头的 U+FEFF 必须作为用户内容保留。
  const original = new TextDecoder(encoding === "utf8" ? "utf-8" : encoding === "utf16le" ? "utf-16le" : "utf-16be", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(bom));
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(original)) throw new Error("binary");
  const crlf = original.includes("\r\n"), remaining = original.replace(/\r\n/g, "");
  if ((crlf && /[\r\n]/.test(remaining)) || (remaining.includes("\r") && remaining.includes("\n"))) throw new Error("mixed-newlines");
  const newline = crlf ? "CRLF" as const : original.includes("\r") ? "CR" as const : "LF" as const;
  return { text: original.replace(/\r\n|\r/g, "\n"), encoding, newline, bom };
}

function editability(snap: ReturnType<typeof snapshot>): EditableFile {
  if (!snap.bytes) return { editable: false, reason: "文件超过 1 MiB，使用只读查看以保持流畅。" };
  let decoded;
  try { decoded = decode(snap.bytes); }
  catch { return { editable: false, reason: "二进制、非受支持编码或混合换行文件暂时仅支持查看，以免保存损坏内容。" }; }
  if (decoded.text.split("\n", 10002).length > 10000) return { editable: false, reason: "文件超过 10,000 行，使用只读查看以保持流畅。" };
  const result = { ...decoded, version: snap.version };
  // 原子替换会断开硬链接，不能默默改变另一处文件的关联关系。
  if (snap.stat.nlink > 1 || !(snap.stat.mode & 0o222)) return { ...result, editable: false, reason: "只读或具有硬链接的文件仅支持查看。" };
  try { fs.accessSync(snap.real, fs.constants.W_OK); }
  catch { return { ...result, editable: false, reason: "当前账户没有该文件的写入权限。" }; }
  return { ...result, editable: true };
}

export function readEditableFile(target: string, roots: Set<string>): EditableFile {
  return editability(snapshot(target, roots));
}

/** 锁内比对磁盘版本，临时文件写完再替换；失败保留原文件，绝不截断原件。 */
export async function saveEditableFile(target: string, roots: Set<string>, text: string, expected: string) {
  const real = authorizedFile(target, roots);
  return serializeByKey(Symbol.for("pi-imagin:file-editor-writes"), process.platform === "win32" ? real.toLowerCase() : real, async () => {
    let release;
    try { release = await lockfile.lock(real, { realpath: false, retries: { retries: 2, minTimeout: 30, maxTimeout: 80 } }); }
    catch { throw new FileEditError("文件正被其他操作占用，请稍后保存。", 409); }
    const temp = path.join(path.dirname(real), `.${path.basename(real)}-${randomUUID()}.tmp`);
    try {
      const current = snapshot(target, roots), info = editability(current);
      if (!info.editable || !current.bytes) throw new FileEditError(info.reason ?? "该文件不能编辑。", 403);
      if (current.real !== real || current.version !== expected) throw new FileEditError("文件已被外部修改，请比较磁盘版本后再保存。", 409);
      const format = decode(current.bytes);
      const normalized = text.replace(/\r\n|\r/g, "\n");
      if (normalized.split("\n", 10002).length > 10000) throw new FileEditError("编辑内容超过 10,000 行，未保存。", 413);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(normalized)
        || new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(normalized, "utf8")) !== normalized)
        throw new FileEditError("编辑内容包含非文本或不完整字符，未保存。");
      const restored = normalized.replace(/\n/g, format.newline === "CRLF" ? "\r\n" : format.newline === "CR" ? "\r" : "\n");
      let bytes = Buffer.from(restored, format.encoding === "utf8" ? "utf8" : "utf16le");
      if (format.encoding === "utf16be") bytes = bytes.swap16();
      if (format.bom) bytes = Buffer.concat([current.bytes.subarray(0, format.bom), bytes]);
      if (bytes.length > FILE_EDIT_MAX_BYTES) throw new FileEditError("编辑内容超过 1 MiB，未保存。", 413);
      fs.writeFileSync(temp, bytes, { flag: "wx", mode: current.stat.mode & 0o777, flush: true });
      fs.chmodSync(temp, current.stat.mode & 0o777);
      // 等待锁或准备临时文件后，重新核对链接和版本，拒绝覆盖期间发生的替换。
      if (snapshot(target, roots).version !== expected || authorizedFile(target, roots) !== real)
        throw new FileEditError("保存期间文件已变化，原文件未覆盖。", 409);
      fs.renameSync(temp, real);
      return readEditableFile(target, roots);
    } finally {
      try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("编辑临时文件清理失败", error); }
      await release();
    }
  });
}
