import { NextResponse } from "next/server";
import { loadSkillCatalog } from "@/lib/skill-catalog";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const query = (params.get("q") ?? "").trim(), page = Number(params.get("page") ?? "0");
  if (query.length > 150 || !Number.isSafeInteger(page) || page < 0 || page > 10000 || (query && page !== 0)) return NextResponse.json({ error: "Invalid skills query" }, { status: 400 });
  try { return NextResponse.json(await loadSkillCatalog(query, page, req.signal)); }
  catch { return NextResponse.json({ error: "Skills catalog unavailable" }, { status: 502 }); }
}
