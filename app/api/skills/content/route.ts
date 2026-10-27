import { NextResponse } from "next/server";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { isExistingPathWithinRoots } from "@/lib/path-security";
import { readRegularFileText } from "@/lib/regular-file";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";

export const dynamic = "force-dynamic";

/** Skill instructions should stay small enough to inspect without a large API response. */
const SKILL_CONTENT_MAX_BYTES = 1024 * 1024;
const MARKDOWN_FILE = /\.(md|markdown)$/i;

// GET /api/skills/content：filePath 必须来自已加载技能；document 仅允许该技能文件夹内的 Markdown，避免成为通用文件读取接口。
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const filePath = searchParams.get("filePath");
  const document = searchParams.get("document");
  if (!filePath) return NextResponse.json({ error: "filePath required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (cwd && !isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { skills } = await loadSkillsWithInstallInfo(cwd);
    const skill = skills.find((item) => item.filePath === filePath);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    let target = skill.filePath;
    if (document !== null) {
      const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });
      // 拒绝包含 .. 的路径，避免链接后的文件系统解析与路径拼接结果不一致。
      if (path.isAbsolute(document) || /[\\:\0]/.test(document) || document.split("/").includes("..")) {
        return refuse(400, "Document path must stay inside the skill folder");
      }
      if (!MARKDOWN_FILE.test(document)) return refuse(415, "Only Markdown documents can be opened");
      target = path.join(skill.baseDir, document);
      if (!existsSync(target)) return refuse(404, "Skill document not found");
      if (!isExistingPathWithinRoots(target, new Set([skill.baseDir]))) return refuse(403, "Document is outside the skill folder");
      if (!MARKDOWN_FILE.test(realpathSync(target))) return refuse(415, "Only Markdown documents can be opened");
      const stats = statSync(target);
      if (!stats.isFile()) return refuse(400, "Skill document is not a regular file");
      if (stats.size > SKILL_CONTENT_MAX_BYTES) return refuse(413, "Skill document is larger than 1 MiB");
    }

    const content = readRegularFileText(target, SKILL_CONTENT_MAX_BYTES);
    if (content === undefined) {
      return NextResponse.json({ error: "Skill file not found" }, { status: 404 });
    }
    return NextResponse.json({ content });
  } catch (error) {
    // 文档错误不暴露文件系统路径。
    if (document !== null) return NextResponse.json({ error: "Skill document could not be read" }, { status: 500 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
