import { stat } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { createTerminal, getTerminalShell, getTerminalProfile, getDefaultTerminalShellId, listTerminalShells } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ shells: listTerminalShells(), defaultShell: getDefaultTerminalShellId() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { id?: unknown; cwd?: unknown; cols?: unknown; rows?: unknown; shell?: unknown };
    if (body.shell !== undefined && (typeof body.shell !== "string" || !listTerminalShells().some(item => item.id === body.shell))) {
      return NextResponse.json({ error: "Shell is not available on this server" }, { status: 400 });
    }
    if (body.id !== undefined && (typeof body.id !== "string" || !/^[a-f0-9]{32}$/.test(body.id))) {
      return NextResponse.json({ error: "Invalid terminal id" }, { status: 400 });
    }
    if (typeof body.cwd !== "string" || !body.cwd.trim()) {
      return NextResponse.json({ error: "cwd required" }, { status: 400 });
    }
    const cwd = resolve(body.cwd);
    if (!(await stat(cwd)).isDirectory()) {
      return NextResponse.json({ error: "cwd must be a directory" }, { status: 400 });
    }
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, roots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const id = createTerminal(
      cwd,
      typeof body.cols === "number" ? body.cols : 80,
      typeof body.rows === "number" ? body.rows : 24,
      body.id as string | undefined,
      body.shell as string | undefined,
    );
    return NextResponse.json({ id, shell: getTerminalShell(id), ...getTerminalProfile(id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
