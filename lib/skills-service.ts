import { DefaultResourceLoader, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";
import { additionalGlobalSkillPaths, globalSkillRoots } from "./skill-locations";
import { relative, isAbsolute, join, sep } from "node:path";
import { skillRemovalTarget } from "./skill-removal";
import { isAppDefaultWorkspace } from "./default-workspace";
import { appPluginSources } from "./plugin-install-origin";

export async function loadSkillsWithInstallInfo(projectCwd?: string | null): Promise<SkillsResponse> {
  const agentDir = getAgentDir();
  if (projectCwd && isAppDefaultWorkspace(projectCwd, agentDir)) projectCwd = null;
  // 无项目时仅加载全局配置，不能采用服务进程所在目录或信任 agentDir 下的项目资源。
  const cwd = projectCwd || agentDir;
  // 列表不触发 session_start 的技能发现事件，无需加载扩展工厂。
  const loader = new DefaultResourceLoader({ cwd, agentDir, noExtensions: true, additionalSkillPaths: additionalGlobalSkillPaths(agentDir), ...(!projectCwd ? { settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted: false }) } : {}) });
  await loader.reload(projectCwd ? projectTrustReloadOptions(cwd, agentDir) : undefined);
  const { skills, diagnostics } = loader.getSkills();
  const trusted = Boolean(projectCwd && getProjectTrustStatus(cwd, agentDir).trusted);
  const appSources = { global: appPluginSources(agentDir), project: trusted ? appPluginSources(agentDir, cwd) : new Set<string>() };
  return {
    skills: annotateSkillsWithInstallInfo((skills as SkillInfo[]).map(skill => {
      const global = globalSkillRoots(agentDir).some(root => { const rel = relative(root, skill.filePath); return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); });
      return global
        ? { ...skill, sourceInfo: { ...skill.sourceInfo, source: "user", scope: "user" } } : skill;
    }), { cwd, agentDir }).map(skill => ({ ...skill, installOrigin: skill.installOrigin === "app" || appSources[skill.sourceInfo?.scope === "project" ? "project" : "global"].has(skill.sourceInfo?.source ?? "") ? "app" as const : "external" as const, canRemove: Boolean(skillRemovalTarget(skill, agentDir, projectCwd)) })),
    diagnostics,
    projectResourcesLoaded: trusted,
    globalSkillsPath: join(agentDir, "skills"),
  };
}
