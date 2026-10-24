import type { SkillInfo, SkillInstallScope } from "./api-types";

/** 相同名称不能证明是同一个技能；目录详情只映射相同来源标识；项目范围继承全局安装。 */
export function findInstalledCatalogSkill(skills: readonly SkillInfo[], pkg: string, scope: SkillInstallScope): SkillInfo | undefined {
  const exact = skills.find(skill => skill.install?.package === pkg && skill.install.scope === scope);
  return exact ?? (scope === "project" ? skills.find(skill => skill.install?.package === pkg && skill.install.scope === "global") : undefined);
}
