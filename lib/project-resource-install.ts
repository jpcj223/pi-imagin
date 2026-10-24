import { getProjectTrustStatus, trustFreshFolderAndWrite } from "./project-trust";

/** 首次向空白项目安装资源沿用新目录的受检写入流程，安装后不会反过来被判为未授权。 */
export async function installProjectResource<T>(cwd: string, agentDir: string, install: () => Promise<T>): Promise<T> {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.trusted) throw new Error("Project resources must be trusted before installation");
  if (status.requiresTrust || status.defaultWorkspace || status.decision === true) return install();
  const result = await trustFreshFolderAndWrite(cwd, agentDir, install, { knownFolders: [cwd] });
  if (result.ok) return result.value;
  if (result.reason === "write-failed") throw result.writeError;
  throw new Error(result.error);
}
