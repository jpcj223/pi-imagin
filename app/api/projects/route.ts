import { NextResponse } from "next/server";
import { changeManagedProject, ProjectStateError, readManagedProjects } from "@/lib/managed-projects";
import { type ProjectChange } from "@/lib/managed-projects-shared";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { invalidateAllowedFileRoots } from "@/lib/file-access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  try { return NextResponse.json({ state: readManagedProjects() }, { headers }); }
  catch { return NextResponse.json({ error: "无法读取项目数据，原数据未被修改。" }, { status: 500, headers }); }
}
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  let change: ProjectChange;
  try { change = await req.json(); }
  catch { return NextResponse.json({ error: "无效的 JSON 请求。" }, { status: 400 }); }
  try {
    const state = await changeManagedProject(change);
    // 项目授权从最新定义读取，不把解除关联的根永久存入附加授权集合。
    invalidateAllowedFileRoots();
    return NextResponse.json({ state }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存项目失败。" }, { status: error instanceof ProjectStateError ? error.status : 500, headers });
  }
}
