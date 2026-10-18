import { unlinkSync } from "node:fs";
import { projectIdentityKey } from "./project-identity";
import { inheritProjectSession } from "./managed-projects";
import { invalidateSessionListCache } from "./session-reader";

/** 仅用于 SDK 刚创建的副本：目录快照保存失败时回滚副本，源会话始终保留。 */
export async function persistProjectFork(sourceId: string, targetId: string, sourceFile: string, targetFile: string, stateFile?: string): Promise<void> {
  if (projectIdentityKey(sourceFile) === projectIdentityKey(targetFile)) throw new Error("分支副本不能覆盖源会话。");
  try { await inheritProjectSession(sourceId, targetId, stateFile); }
  catch (error) {
    try { unlinkSync(targetFile); }
    catch (cleanup) { if ((cleanup as NodeJS.ErrnoException).code !== "ENOENT") console.error("[pi-imagin] 清理未完成的分支副本失败", cleanup); }
    invalidateSessionListCache();
    throw error;
  }
}
