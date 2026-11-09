import { createHmac } from "node:crypto";
import {
  CREDITS_SIGNATURE_HEADER,
  CREDITS_TIMESTAMP_HEADER,
  CREDITS_VISITOR_HEADER,
  VISITOR_COOKIE,
} from "@/lib/credits/config";

/** Stable JSON bytes that are signed and sent unchanged. */
export function spendRawBody(input: {
  amount: number;
  reason: string;
  idempotencyKey: string;
  source: string;
  product: string;
}): string {
  return JSON.stringify({
    amount: input.amount,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
    source: input.source,
    product: input.product,
  });
}

/** Canonical bytes signed for a product-scoped GET. */
export function productRawBody(product: string): string {
  return JSON.stringify({ product });
}

/** Hex HMAC-SHA256 of `${timestamp}.${visitorId}.${rawBody}`. */
export function creditsSignature(
  secret: string,
  timestamp: string,
  visitorId: string,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${visitorId}.${rawBody}`)
    .digest("hex");
}

export function signedCreditHeaders(input: {
  visitorId: string;
  secret: string;
  timestamp: string;
  rawBody: string;
}): Record<string, string> {
  const signature = creditsSignature(input.secret, input.timestamp, input.visitorId, input.rawBody);
  return {
    accept: "application/json",
    [CREDITS_VISITOR_HEADER]: input.visitorId,
    [CREDITS_TIMESTAMP_HEADER]: input.timestamp,
    [CREDITS_SIGNATURE_HEADER]: signature,
    cookie: `${VISITOR_COOKIE}=${input.visitorId}`,
  };
}

export function buildSpendRequest(input: {
  visitorId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  source: string;
  product: string;
  secret: string;
  timestamp: string;
}): { body: string; headers: Record<string, string> } {
  const body = spendRawBody(input);
  return {
    body,
    headers: {
      ...signedCreditHeaders({ ...input, rawBody: body }),
      "content-type": "application/json",
    },
  };
}

export function checkoutRawBody(input: {
  packId: string;
  returnUrl: string;
  product: string;
}): string {
  return JSON.stringify({
    packId: input.packId,
    returnUrl: input.returnUrl,
    product: input.product,
  });
}
