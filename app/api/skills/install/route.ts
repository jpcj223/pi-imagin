import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { installSkillPackage } from "@/lib/skill-install";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { installProjectResource } from "@/lib/project-resource-install";
import { validSkillSource, validSkillSlug } from "@/lib/skill-catalog-types";
import { realpathSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const ANSI_RE = /\x1B\[[0-9;]*m/g;

// POST /api/skills/install  body: { package: string; scope: "global" | "project"; cwd?: string }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const { package: pkg, scope, cwd } = await req.json() as { package?: string; scope?: string; cwd?: string };
    if (typeof pkg !== "string") return NextResponse.json({ error: "package required" }, { status: 400 });
    const [source, slug, extra] = pkg.trim().split("@");
    if (!validSkillSource(source) || !source.includes("/") || !validSkillSlug(slug) || extra !== undefined) return NextResponse.json({ error: "Invalid skill package" }, { status: 400 });
    if (cwd != null && (typeof cwd !== "string" || !isExistingFilePathAllowed(cwd, await getAllowedFileRoots()))) return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const isGlobal = scope !== "project";
    if (!isGlobal) {
      if (!cwd) return NextResponse.json({ error: "cwd required for project install" }, { status: 400 });
      const allowedRoots = await getAllowedFileRoots();
      if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }
      if (!getProjectTrustStatus(cwd, getAgentDir()).trusted) {
        return NextResponse.json(
          { error: "Project resources must be trusted before installing project skills" },
          { status: 403 },
        );
      }
    }
    const install = () => installSkillPackage(pkg.trim(), isGlobal ? "global" : "project", cwd);
    const { stdout, stderr, names } = isGlobal ? await install() : await installProjectResource(cwd!, getAgentDir(), install);
    const output = (stdout + stderr).replace(ANSI_RE, "");
    // 全局安装验证全局发现结果，项目同名技能不能使安装被误报为失败。
    const refreshed = await loadSkillsWithInstallInfo(isGlobal ? null : cwd);
    const loadedPaths = new Set(refreshed.skills.map(skill => realpathSync(skill.filePath)));
    const targetRoot = isGlobal ? getAgentDir() : join(cwd!, ".pi");
    if (!names.every(name => loadedPaths.has(realpathSync(join(targetRoot, "skills", name, "SKILL.md"))))) {
      return NextResponse.json({ error: "Files were installed, but some skills could not be loaded. Refresh the installed list to inspect them." }, { status: 500 });
    }
    return NextResponse.json({ success: true, output, ...refreshed });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = ((err.stdout ?? "") + (err.stderr ?? "")).replace(ANSI_RE, "");
    return NextResponse.json({ error: output || (err.message ?? String(e)) }, { status: 500 });
  }
}
