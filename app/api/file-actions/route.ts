import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { FileOperationError, performFileOperation } from "@/lib/file-operations";
import { hasParentDirectorySegment } from "@/lib/path-security";

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "需要 JSON 请求" }, { status: 415 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.cwd !== "string" || typeof body.path !== "string" || !["rename", "delete", "restore"].includes(body.action) || hasParentDirectorySegment(body.path)) return NextResponse.json({ error: "文件操作参数无效" }, { status: 400 });
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(body.cwd, roots) || !isFilePathAllowed(body.path, roots) || (body.action !== "restore" && !isExistingFilePathAllowed(body.path, roots))) return NextResponse.json({ error: "文件访问被拒绝" }, { status: 403 });
  try { return NextResponse.json(performFileOperation(body.cwd, body.path, body.action, body.name, body.token)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "文件操作失败" }, { status: error instanceof FileOperationError ? error.status : 500 }); }
}
