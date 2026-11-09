import { NextRequest, NextResponse } from "next/server";
import { CREDITS_TOKEN_PATTERN, VISITOR_COOKIE } from "@/lib/credits/config";

/** Accepts the credits service visitor id, not only UUIDs we minted. */
export const VISITOR_ID_PATTERN = CREDITS_TOKEN_PATTERN;

export function visitorCookieOptions(host: string): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
  domain?: string;
} {
  const onVerafy = host === "verafy.ai" || host.endsWith(".verafy.ai");
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: onVerafy,
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
    ...(onVerafy ? { domain: ".verafy.ai" } : {}),
  };
}

export function stampVisitorCookie(request: NextRequest, response: NextResponse): NextResponse {
  const host = request.headers.get("host")?.split(":")[0] ?? "";
  const existing = request.cookies.get(VISITOR_COOKIE)?.value ?? "";
  if (VISITOR_ID_PATTERN.test(existing)) return response;
  response.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), visitorCookieOptions(host));
  return response;
}

export function resolveVisitor(request: NextRequest): { visitorId: string; minted: boolean } {
  const existing = request.cookies.get(VISITOR_COOKIE)?.value ?? "";
  if (VISITOR_ID_PATTERN.test(existing)) return { visitorId: existing, minted: false };
  return { visitorId: crypto.randomUUID(), minted: true };
}

export function applyVisitorCookie(
  response: NextResponse,
  request: NextRequest,
  visitorId: string,
  minted: boolean,
): NextResponse {
  if (!minted) return response;
  const host = request.headers.get("host")?.split(":")[0] ?? "";
  response.cookies.set(VISITOR_COOKIE, visitorId, visitorCookieOptions(host));
  return response;
}
