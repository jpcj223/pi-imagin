import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { searchSessionContents } from "@/lib/session-search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  const options = { caseSensitive: params.get("caseSensitive") === "1", wholeWord: params.get("wholeWord") === "1", regex: params.get("regex") === "1" };
  const headers = { "Cache-Control": "no-store" };
  if (query.length > 200) {
    return NextResponse.json({ error: "Search query exceeds 200 characters" }, { status: 400, headers });
  }
  try {
    // Paths come only from the same catalog used by the sidebar. `allowStale`
    // keeps the request off the catalogue rebuild path: agent activity
    // invalidates the scan constantly, and rebuilding it costs hundreds of
    // milliseconds because loadAllSessions() re-reads every forked and subagent
    // session. The trade-off is that a session created in the last couple of
    // seconds is not searched yet; the stale read schedules the rebuild, so the
    // next search sees it.
    if (options.regex) new RegExp(query, options.caseSensitive ? "gu" : "giu");
    const sessions = query && !request.signal.aborted ? await listAllSessions({ allowStale: true }) : [];
    return NextResponse.json(await searchSessionContents(sessions, query, request.signal, options), { headers });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: error instanceof SyntaxError ? 400 : String(error).includes("Search timed out") ? 422 : 500, headers });
  }
}
