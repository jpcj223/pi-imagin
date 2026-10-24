import { NextResponse } from "next/server";
import { loadCatalogSkillDetail } from "@/lib/skill-catalog";
import { validSkillSource, validSkillSlug } from "@/lib/skill-catalog-types";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams, source = params.get("source"), slug = params.get("slug");
  if (!validSkillSource(source) || !validSkillSlug(slug)) return NextResponse.json({ error: "Invalid skill" }, { status: 400 });
  try { return NextResponse.json(await loadCatalogSkillDetail(source, slug, req.signal, params.get("refresh") === "1")); }
  catch { return NextResponse.json({ error: "Skill documentation unavailable" }, { status: 502 }); }
}
