import { NextResponse } from "next/server";
import { loadPluginLogos } from "@/lib/plugin-catalog";
import { isCatalogPackageName } from "@/lib/plugin-detail";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const names = [...new Set(new URL(req.url).searchParams.getAll("name"))];
  if (!names.length || names.length > 50 || !names.every(isCatalogPackageName)) return NextResponse.json({ error: "Invalid plugin names" }, { status: 400 });
  try { return NextResponse.json(await loadPluginLogos(names, req.signal)); }
  catch { return NextResponse.json({ error: "Plugin logos unavailable" }, { status: 502 }); }
}
