import { NextResponse } from "next/server";
import { isMcpEntryRefusal, readConnectableMcpEntry } from "@/lib/mcp-entry-request";
import { readMcpOverview } from "@/lib/mcp-config-read";
import { readBuiltinExtensionSwitches } from "@/lib/builtin-extensions";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { requestMcpServerRefresh } from "@/lib/mcp-runtime-sessions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const entry = await readConnectableMcpEntry(req);
  if (isMcpEntryRefusal(entry)) return NextResponse.json(entry.body, { status: entry.status });
  if (entry.config.enabled === false) return NextResponse.json({ error: "Enable this server before connecting", reason: "invalid-request" }, { status: 409 });
  const { scope, name, sourcePath, configKey, project, agentDir } = entry;
  const switches = await readBuiltinExtensionSwitches({ agentDir, cwd: entry.cwd,
    projectTrusted: project ? getProjectTrustStatus(project.cwd, agentDir).decision === true : false });
  if (!switches.mcp.enabled) return NextResponse.json({ error: "Enable MCP before connecting", reason: "mcp-off" }, { status: 409 });
  const accepted = requestMcpServerRefresh({ ...(scope === "project" ? { cwd: project!.cwd } : {}), target: { scope, name, sourcePath, configKey } });
  if (!accepted) return NextResponse.json({ error: "No active MCP session. Enable MCP and open a session first.", reason: "internal" }, { status: 409 });
  return NextResponse.json(await readMcpOverview({ agentDir, project }));
}
