import { NextRequest, NextResponse } from "next/server";
import { readCreditProduct } from "@/lib/credits/config";
import { loadBalance } from "@/lib/credits/service";
import { applyVisitorCookie, resolveVisitor } from "@/lib/credits/visitor-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const visitor = resolveVisitor(request);
  const product = readCreditProduct(request.nextUrl.searchParams.get("product"));
  const balance = await loadBalance(visitor.visitorId, product);
  const response = NextResponse.json(balance, {
    headers: { "Cache-Control": "no-store" },
  });
  return applyVisitorCookie(response, request, visitor.visitorId, visitor.minted);
}
