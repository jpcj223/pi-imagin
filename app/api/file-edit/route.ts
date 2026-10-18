import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots } from "@/lib/file-access";
import { FileEditError, FILE_EDIT_MAX_BYTES, readEditableFile, saveEditableFile } from "@/lib/file-edit";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "需要 JSON 请求" }, { status: 415 });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new FileEditError("请求内容为空。");
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.byteLength;
        if (length > FILE_EDIT_MAX_BYTES * 6 + 4096) { await reader.cancel(); throw new FileEditError("编辑请求过大。", 413); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body.path !== "string" || !["read", "save"].includes(body.action)) throw new FileEditError("文件编辑参数无效。");
    const roots = await getAllowedFileRoots();
    if (body.action === "read") return NextResponse.json(readEditableFile(body.path, roots), { headers: { "Cache-Control": "no-store" } });
    if (typeof body.text !== "string" || typeof body.version !== "string" || !/^[a-f0-9]{64}$/.test(body.version)) throw new FileEditError("缺少编辑内容或文件版本。");
    return NextResponse.json(await saveEditableFile(body.path, roots, body.text, body.version));
  } catch (error) {
    const status = error instanceof FileEditError ? error.status : (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : error instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: error instanceof FileEditError ? error.message : status === 404 ? "文件已移动或删除，编辑内容仍保留。" : status === 400 ? "请求格式无效。" : "文件操作失败，编辑内容仍保留，请检查权限后重试。" }, { status });
  }
}
