import { NextResponse, type NextRequest } from "next/server";
import {
  getAuthRetryAfterMs,
  recordAuthFailure,
  retryAfterSeconds,
} from "@/lib/auth-throttle";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidWebSessionToken,
  isValidBasicAuthorization,
  isWebPasswordEnabled,
  PI_WEB_SESSION_COOKIE,
} from "@/lib/web-auth";

function tooManyAttempts(retryAfterMs: number): NextResponse {
  return new NextResponse("Too many failed attempts", {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfterSeconds(retryAfterMs)),
    },
  });
}

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(password)) {
    if (request.nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  let authenticated = isValidWebSessionToken(request.cookies.get(PI_WEB_SESSION_COOKIE)?.value, password);
  const authorization = isApiRequest ? request.headers.get("authorization") : null;
  if (!authenticated && authorization && /^Basic\s/i.test(authorization)) {
    // 每个 Basic Auth 请求都属于一次密码尝试，必须与网页登录共用
    // 节流计数，避免任意 API 或认证状态接口成为高速探测入口。
    // 阻塞期间也拒绝正确密码，
    // 否则响应会泄漏密码是否匹配；Basic 成功不重置计数，
    // 因为它在每次请求中认证，频繁重置会让穿插的密码猜测
    // 不断重新获得最短的阻塞时间。
    const retryAfterMs = getAuthRetryAfterMs();
    if (retryAfterMs > 0) return tooManyAttempts(retryAfterMs);
    authenticated = isValidBasicAuthorization(authorization, password);
    if (!authenticated) recordAuthFailure();
  }
  if (request.nextUrl.pathname === "/login") {
    return authenticated
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }
  if (request.nextUrl.pathname === "/api/web-auth") return NextResponse.next();

  if (!authenticated) {
    if (!isApiRequest) {
      const loginUrl = new URL("/login", request.url);
      if (request.nextUrl.search) {
        loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      }
      return NextResponse.redirect(loginUrl);
    }
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Imagin", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/login", "/api/:path*"] };
