import { NextRequest, NextResponse } from "next/server";
import { readCreditProduct } from "@/lib/credits/config";
import { safeReturnUrl } from "@/lib/credits/normalize";
import { startCheckout } from "@/lib/credits/service";
import { applyVisitorCookie, resolveVisitor } from "@/lib/credits/visitor-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const visitor = resolveVisitor(request);
  const body = (await request.json().catch(() => null)) as {
    packId?: unknown;
    returnUrl?: unknown;
    product?: unknown;
  } | null;
  const packId = typeof body?.packId === "string" ? body.packId : "";
  const product = readCreditProduct(body?.product);
  const returnUrl = safeReturnUrl(body?.returnUrl, request.url);
  if (!packId || !returnUrl) {
    const response = NextResponse.json(
      { error: "Choose a credit pack and a return page on verafy.ai." },
      { status: 400 },
    );
    return applyVisitorCookie(response, request, visitor.visitorId, visitor.minted);
  }

  const checkout = await startCheckout({
    visitorId: visitor.visitorId,
    packId,
    returnUrl,
    product,
  });
  const response = NextResponse.json(
    checkout.url ? { url: checkout.url } : { error: checkout.error || "Card checkout is unavailable right now." },
    { status: checkout.status },
  );
  return applyVisitorCookie(response, request, visitor.visitorId, visitor.minted);
}
