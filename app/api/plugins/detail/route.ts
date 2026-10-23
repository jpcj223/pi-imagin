import { NextResponse } from "next/server";
import { isCatalogPackageName, loadPluginDetail } from "@/lib/plugin-detail";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name");
  if (!isCatalogPackageName(name)) return NextResponse.json({ error: "Invalid plugin name" }, { status: 400 });
  try { return NextResponse.json(await loadPluginDetail(name, request.signal)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 }); }
}
