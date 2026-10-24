import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseNpmSource } from "./npm-source";
import { nodeCliInvocation } from "./node-cli";

/** 并行准备完整依赖缓存；准备阶段不执行插件安装脚本，也不写共享 npm 前缀。 */
export async function preparePluginInstall(source: string): Promise<boolean> {
  const parsed = parseNpmSource(source);
  if (!parsed) return false;
  const stage = mkdtempSync(join(tmpdir(), "pi-plugin-prepare-"));
  try {
    const spec = source.slice(4);
    const command = nodeCliInvocation("npm", ["install", spec, "--prefix", stage, "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund"]);
    await promisify(execFile)(command.command, command.args, { cwd: stage, timeout: 180_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    return true;
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
