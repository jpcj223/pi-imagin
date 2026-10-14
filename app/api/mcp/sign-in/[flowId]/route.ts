import { NextResponse } from "next/server";
import type { McpErrorResponse, McpRefusalReason, McpSignInFlowInfo } from "@/lib/api-types";
import { cancelMcpSignIn, pasteMcpSignInRedirect, readMcpSignIn } from "@/lib/mcp-sign-in";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// 按 ID 管理单次 MCP 登录：GET 查询进度，POST 接收远程浏览器粘贴的 redirectUrl，DELETE 取消。
// 不匹配本次授权的回调返回 400，流程继续等待。ID 为开始响应中的随机 UUID。
// 条目已在开始阶段验证，此路由不重新连接或读取配置。

function refusal(status: number, reason: McpRefusalReason, error: string) {
  return NextResponse.json({ error, reason } satisfies McpErrorResponse, { status });
}

const UNKNOWN = "No sign-in has that id: it ended over a minute ago, or Pi Imagin restarted";

type Context = { params: Promise<{ flowId: string }> };

export async function GET(req: Request, { params }: Context) {
  if (!isApiRequestAllowed(req)) return refusal(403, "request-denied", "Untrusted API request");
  const { flowId } = await params;
  const flow = readMcpSignIn(flowId);
  if (!flow) return refusal(404, "sign-in-unknown", UNKNOWN);
  return NextResponse.json(flow satisfies McpSignInFlowInfo);
}

export async function POST(req: Request, { params }: Context) {
  if (!isApiRequestAllowed(req)) return refusal(403, "request-denied", "Untrusted API request");
  if (!hasJsonContentType(req)) return refusal(415, "content-type", "Content-Type must be application/json");
  const { flowId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(400, "invalid-request", "Invalid JSON body");
  }
  const redirectUrl = typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).redirectUrl
    : undefined;
  const result = pasteMcpSignInRedirect(flowId, redirectUrl);
  if (result.ok) return NextResponse.json(result.flow satisfies McpSignInFlowInfo);
  return refusal(result.status, result.reason, result.error);
}

export async function DELETE(req: Request, { params }: Context) {
  if (!isApiRequestAllowed(req)) return refusal(403, "request-denied", "Untrusted API request");
  const { flowId } = await params;
  const flow = cancelMcpSignIn(flowId);
  if (!flow) return refusal(404, "sign-in-unknown", UNKNOWN);
  return NextResponse.json(flow satisfies McpSignInFlowInfo);
}
