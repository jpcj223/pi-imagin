import { randomUUID, createHash } from "node:crypto";
import { link, mkdir, open, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { assertProjectScopeDirectories, resolveProjectToolPath } from "./managed-projects";
import type { ProjectSessionScope } from "./managed-projects-shared";
import { projectIdentityKey } from "./project-identity";
import { serializeByKey } from "./key-serializer";

export const MAX_PROJECT_COPY_BYTES = 16 * 1024 * 1024;
const COPY_QUEUE = Symbol.for("pi-imagin:project-file-copy");

/** 原样复制按字节执行；临时文件与目标同目录，失败或取消不破坏旧目标。 */
export async function copyProjectFile(scope: ProjectSessionScope, sourcePath: string, destinationPath: string, overwrite = false, signal?: AbortSignal) {
  signal?.throwIfAborted();
  assertProjectScopeDirectories(scope);
  const source = resolveProjectToolPath(scope, sourcePath);
  const destination = resolveProjectToolPath(scope, destinationPath);
  if (projectIdentityKey(source) === projectIdentityKey(destination)) throw new Error("源文件与目标文件不能相同。");
  return serializeByKey(COPY_QUEUE, projectIdentityKey(destination), async () => {
    signal?.throwIfAborted();
    assertProjectScopeDirectories(scope);
    if (resolveProjectToolPath(scope, source) !== source || resolveProjectToolPath(scope, destination) !== destination) throw new Error("文件路径已变化，请重新选择。");
    const existing = await stat(destination).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
    if (existing && (!existing.isFile() || !overwrite)) throw new Error("目标已存在；覆盖普通文件需显式设置 overwrite=true。");
    const sourceInfo = await stat(source);
    if (!sourceInfo.isFile()) throw new Error("源路径必须是普通文件。");
    if (sourceInfo.size > MAX_PROJECT_COPY_BYTES) throw new Error("文件超过 16 MiB 的复制上限。");
    const handle = await open(source, "r");
    let data: Buffer;
    let mode: number;
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw new Error("源路径必须是普通文件。");
      if (before.size > MAX_PROJECT_COPY_BYTES) throw new Error("文件超过 16 MiB 的复制上限。");
      // 有界读取，即使源文件在读取期间增长，也不会无界分配内存。
      const chunks: Buffer[] = []; let size = 0;
      while (true) {
        signal?.throwIfAborted();
        const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_PROJECT_COPY_BYTES + 1 - size));
        const { bytesRead } = await handle.read(chunk);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > MAX_PROJECT_COPY_BYTES) throw new Error("文件超过 16 MiB 的复制上限。");
        chunks.push(chunk.subarray(0, bytesRead));
      }
      const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("源文件在复制期间发生变化，请重新读取后再复制。");
      data = Buffer.concat(chunks, size);
      mode = (existing?.mode ?? before.mode) & 0o777;
    } finally { await handle.close(); }
    signal?.throwIfAborted();
    await mkdir(dirname(destination), { recursive: true });
    assertProjectScopeDirectories(scope);
    if (resolveProjectToolPath(scope, destination) !== destination) throw new Error("目标路径已变化，请重新选择。");
    const temporary = join(dirname(destination), `.${basename(destination)}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, data, { flag: "wx", mode, signal });
      signal?.throwIfAborted();
      if (overwrite) await rename(temporary, destination);
      // 原子创建硬链接，避免“先检查不存在再重命名”覆盖并发创建的文件。
      else await link(temporary, destination);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
    return { source, destination, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  });
}
