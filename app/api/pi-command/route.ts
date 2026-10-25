import { NextResponse } from "next/server";
import { changePiCommandSettings, readPiCommandSettings } from "@/lib/pi-command";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try { return NextResponse.json(await readPiCommandSettings()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}

export async function PUT(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Expected application/json" }, { status: 415 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "Expected enabled boolean" }, { status: 400 });
  try { return NextResponse.json(await changePiCommandSettings(body.enabled)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
