import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { getGlobalSettingsPath, readGlobalSettings, updateGlobalSettings } from "@/lib/global-settings-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

// 设置常规页控制全局 showCacheMissNotices，写入沿用 SDK 文件锁；关闭时移除键。项目 .pi/settings.json 继续优先覆盖。

const KEY = "showCacheMissNotices";

async function readEnabled(): Promise<boolean> {
  return readGlobalSettings(getGlobalSettingsPath(), (settings) => settings[KEY] === true);
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json({ enabled: await readEnabled() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  try {
    // 配置文件不存在且关闭时已是默认行为，无需创建文件。
    if (!enabled && !existsSync(getGlobalSettingsPath())) return NextResponse.json({ enabled: false });
    await updateGlobalSettings(getGlobalSettingsPath(), (settings) => {
      if (enabled) settings[KEY] = true;
      else delete settings[KEY];
    });
    return NextResponse.json({ enabled: await readEnabled() });
  } catch (error) {
    return errorResponse(error);
  }
}
