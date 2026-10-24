import type { PluginPackageInfo } from "./api-types";
import { parseNpmSource } from "./npm-source";

/** 只匹配相同包身份；当前项目列表由服务端限定，项目范围继承全局。 */
export function findInstalledCatalogPlugin(packages: readonly PluginPackageInfo[], name: string, scope: "global" | "project"): PluginPackageInfo | undefined {
  const matches = (pkg: PluginPackageInfo) => pkg.status !== "missing" && (pkg.packageName === name || parseNpmSource(pkg.source)?.name === name);
  return packages.find(pkg => pkg.scope === scope && matches(pkg))
    ?? (scope === "project" ? packages.find(pkg => pkg.scope === "global" && matches(pkg)) : undefined);
}
