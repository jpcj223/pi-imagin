import { NextResponse } from "next/server";
import { searchPluginCatalog } from "@/lib/plugin-catalog";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const query = (params.get("q") ?? "").trim(), page = Number(params.get("page") ?? "1");
  if (query.length > 150 || !Number.isSafeInteger(page) || page < 1 || page > 10000) return NextResponse.json({ error: "Invalid catalog query" }, { status: 400 });
  try { return NextResponse.json(await searchPluginCatalog(query, page, req.signal)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 }); }
}
