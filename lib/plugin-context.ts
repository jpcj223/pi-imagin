import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getProjectTrustStatus } from "./project-trust";

/** 未选择项目时只读取全局资源，不能偷偷采用服务进程所在项目。 */
export function pluginContext(projectCwd?: string | null) {
  const agentDir = getAgentDir();
  const cwd = projectCwd || agentDir;
  const trusted = Boolean(projectCwd && getProjectTrustStatus(cwd, agentDir).trusted);
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: trusted });
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  return { cwd, trusted, settingsManager, packageManager };
}
