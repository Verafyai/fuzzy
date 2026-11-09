import { NextRequest, NextResponse } from "next/server";
import { CREDIT_PRODUCT_SHARED, type CreditProduct, type CreditSource } from "@/lib/credits/config";
import { chargeCredits, type ChargeResult } from "@/lib/credits/service";
import { applyVisitorCookie, resolveVisitor } from "@/lib/credits/visitor-cookie";

export async function chargeAction(
  request: NextRequest,
  input: {
    amount: number;
    reason: string;
    source: CreditSource;
    product?: CreditProduct;
    /** Pass one to refund this spend later (a released hold). Random otherwise. */
    idempotencyKey?: string;
  },
): Promise<
  | { charged: true; balance: number | null; visitorId: string; minted: boolean; idempotencyKey: string }
  | { charged: false; response: NextResponse }
> {
  const visitor = resolveVisitor(request);
  const product = input.product ?? CREDIT_PRODUCT_SHARED;
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const result: ChargeResult = await chargeCredits({
    visitorId: visitor.visitorId,
    amount: input.amount,
    reason: input.reason,
    source: input.source,
    product,
    idempotencyKey,
  });

  const stamp = (response: NextResponse) =>
    applyVisitorCookie(response, request, visitor.visitorId, visitor.minted);

  if (result.ok) {
    return {
      charged: true,
      balance: result.balance,
      visitorId: visitor.visitorId,
      minted: visitor.minted,
      idempotencyKey,
    };
  }

  if (result.code === "insufficient") {
    return {
      charged: false,
      response: stamp(
        NextResponse.json(
          {
            error: `You're out of credits. This takes ${input.amount.toLocaleString("en-US")} credits. Buy a pack to continue.`,
            code: "out_of_credits",
            balance: result.balance,
          },
          { status: 402 },
        ),
      ),
    };
  }

  if (result.code === "rate_limited") {
    return {
      charged: false,
      response: stamp(
        NextResponse.json(
          {
            error: "Too many credit charges in a short time. Wait a minute and try again.",
            code: "rate_limited",
          },
          { status: 429 },
        ),
      ),
    };
  }

  return {
    charged: false,
    response: stamp(
      NextResponse.json(
        {
          error: "Credits are temporarily unavailable, so this run did not start. Saved pages are still free to read.",
          code: "credits_unavailable",
        },
        { status: 503 },
      ),
    ),
  };
}
