import {
  CREDIT_PRODUCT_SHARED,
  CREDITS_PURCHASE_CLOSED,
  CREDITS_TOKEN_PATTERN,
  VISITOR_COOKIE,
  creditsApiUrl,
  creditsServiceSecret,
  creditsUseMock,
  type CreditProduct,
} from "@/lib/credits/config";
import { mockBalance, mockCheckout, mockPacks, mockRefund, mockSpend } from "@/lib/credits/mock-ledger";
import {
  readBalance,
  readPacks,
  readPaymentsEnabled,
  type CreditBalance,
  type CreditPack,
} from "@/lib/credits/normalize";
import { buildSpendRequest, checkoutRawBody, productRawBody, signedCreditHeaders } from "@/lib/credits/sign";

const REMOTE_TIMEOUT_MS = 4000;

type RemoteResult =
  | { kind: "http"; status: number; body: unknown }
  | { kind: "unreachable" };

export type ChargeResult =
  | { ok: true; balance: number | null; mocked: boolean }
  | { ok: false; code: "insufficient"; balance: number | null }
  | { ok: false; code: "rate_limited"; balance: number | null }
  | { ok: false; code: "unavailable" };

export type BalanceResult =
  | { unavailable: false; balance: number; freeCredits: boolean; mocked: boolean; product: CreditProduct }
  | { unavailable: true; balance: null; freeCredits: false; mocked: false; product: CreditProduct };

export type PackResult = {
  packs: CreditPack[];
  paymentsEnabled: boolean;
  mocked: boolean;
  product: CreditProduct;
};

function visitorCookieHeader(visitorId: string): Record<string, string> | undefined {
  if (!CREDITS_TOKEN_PATTERN.test(visitorId)) return undefined;
  return { cookie: `${VISITOR_COOKIE}=${visitorId}` };
}

function errorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" ? error : null;
}

async function callRemote(
  path: string,
  init: {
    method: "GET" | "POST";
    body?: string;
    headers?: Record<string, string>;
  },
): Promise<RemoteResult> {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("Accept", "application/json");
  if (init.body && !headers.has("content-type")) headers.set("Content-Type", "application/json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetch(`${creditsApiUrl()}${path}`, {
      method: init.method,
      headers,
      body: init.body,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (response.status >= 500) return { kind: "unreachable" };
    return { kind: "http", status: response.status, body };
  } catch {
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function productPath(path: string, product: CreditProduct): string {
  return `${path}?product=${encodeURIComponent(product)}`;
}

function signedGetHeaders(visitorId: string, product: CreditProduct): Record<string, string> {
  const secret = creditsServiceSecret();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    ...signedCreditHeaders({
      visitorId,
      secret,
      timestamp,
      rawBody: productRawBody(product),
    }),
    ...visitorCookieHeader(visitorId),
  };
}

export async function loadBalance(
  visitorId: string,
  product: CreditProduct = CREDIT_PRODUCT_SHARED,
): Promise<BalanceResult> {
  if (creditsUseMock()) {
    const balance = mockBalance(visitorId, product);
    return { unavailable: false, ...balance, mocked: true, product };
  }

  const remote = await callRemote(productPath("/balance", product), {
    method: "GET",
    headers: signedGetHeaders(visitorId, product),
  });
  if (remote.kind === "http" && remote.status === 200) {
    const parsed = readBalance(remote.body);
    if (parsed) return { unavailable: false, ...parsed, mocked: false, product };
  }
  return { unavailable: true, balance: null, freeCredits: false, mocked: false, product };
}

export async function loadPacks(product: CreditProduct = CREDIT_PRODUCT_SHARED): Promise<PackResult> {
  if (creditsUseMock()) {
    return { packs: mockPacks(product), paymentsEnabled: false, mocked: true, product };
  }
  const remote = await callRemote(productPath("/packs", product), {
    method: "GET",
    headers: signedGetHeaders("credits-service", product),
  });
  if (remote.kind === "http" && remote.status === 200) {
    return {
      packs: readPacks(remote.body, product),
      paymentsEnabled: readPaymentsEnabled(remote.body),
      mocked: false,
      product,
    };
  }
  return { packs: readPacks(null, product), paymentsEnabled: false, mocked: false, product };
}

export async function startCheckout(input: {
  visitorId: string;
  packId: string;
  returnUrl: string;
  product?: CreditProduct;
}): Promise<{ url?: string; error?: string; status: number }> {
  const product = input.product ?? CREDIT_PRODUCT_SHARED;
  const packs = await loadPacks(product);
  if (!packs.paymentsEnabled) {
    return { error: CREDITS_PURCHASE_CLOSED, status: 403 };
  }

  const rawBody = checkoutRawBody({ packId: input.packId, returnUrl: input.returnUrl, product });
  if (!creditsUseMock()) {
    const secret = creditsServiceSecret();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const remote = await callRemote("/checkout", {
      method: "POST",
      headers: {
        ...signedCreditHeaders({ visitorId: input.visitorId, secret, timestamp, rawBody }),
        "content-type": "application/json",
      },
      body: rawBody,
    });
    if (remote.kind === "http" && remote.status === 200) {
      const url =
        remote.body && typeof remote.body === "object"
          ? (remote.body as { url?: unknown }).url
          : null;
      if (typeof url === "string" && url.startsWith("https://")) {
        return { url, status: 200 };
      }
      return { error: "Checkout did not return a card payment link.", status: 502 };
    }
    return { error: "Card checkout is unavailable right now.", status: 503 };
  }

  const checkout = mockCheckout({ ...input, product });
  if ("error" in checkout) return { error: checkout.error, status: 400 };
  return { url: checkout.url, status: 200 };
}

function chargeFromMock(input: {
  visitorId: string;
  amount: number;
  idempotencyKey: string;
  product: CreditProduct;
}): ChargeResult {
  const spent = mockSpend(input);
  if (!spent.ok) {
    if (spent.code === "rate_limited") {
      return { ok: false, code: "rate_limited", balance: spent.balance };
    }
    if (spent.code === "insufficient") {
      return { ok: false, code: "insufficient", balance: spent.balance };
    }
    return { ok: false, code: "unavailable" };
  }
  return { ok: true, balance: spent.balance, mocked: true };
}

export async function chargeCredits(input: {
  visitorId: string;
  amount: number;
  reason: string;
  source: string;
  idempotencyKey: string;
  product?: CreditProduct;
}): Promise<ChargeResult> {
  const product = input.product ?? CREDIT_PRODUCT_SHARED;
  if (!CREDITS_TOKEN_PATTERN.test(input.idempotencyKey)) {
    return { ok: false, code: "unavailable" };
  }
  if (creditsUseMock()) return chargeFromMock({ ...input, product });

  const secret = creditsServiceSecret();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signed = buildSpendRequest({ ...input, product, secret, timestamp });
  const remote = await callRemote("/spend", {
    method: "POST",
    body: signed.body,
    headers: signed.headers,
  });
  if (remote.kind !== "http") return { ok: false, code: "unavailable" };

  const parsed: CreditBalance | null = readBalance(remote.body);
  const code = errorCode(remote.body);
  if (remote.status === 200) {
    return { ok: true, balance: parsed?.balance ?? null, mocked: false };
  }
  if (remote.status === 402 || code === "insufficient_credits") {
    return { ok: false, code: "insufficient", balance: parsed?.balance ?? null };
  }
  if (remote.status === 429) {
    return { ok: false, code: "rate_limited", balance: parsed?.balance ?? null };
  }
  return { ok: false, code: "unavailable" };
}

/** Return a spend after a failed mediation run. Idempotent for the same key. */
export async function refundCredits(input: {
  visitorId: string;
  amount: number;
  reason: string;
  source: string;
  idempotencyKey: string;
  product?: CreditProduct;
}): Promise<{ ok: boolean; balance: number | null }> {
  const product = input.product ?? CREDIT_PRODUCT_SHARED;
  if (!CREDITS_TOKEN_PATTERN.test(input.idempotencyKey) || !CREDITS_TOKEN_PATTERN.test(input.visitorId)) {
    return { ok: false, balance: null };
  }
  if (creditsUseMock()) {
    const refunded = mockRefund({ ...input, product });
    return { ok: refunded.ok, balance: refunded.balance };
  }
  const refundKey = `refund_${input.idempotencyKey}`.slice(0, 180);
  if (!CREDITS_TOKEN_PATTERN.test(refundKey)) return { ok: false, balance: null };
  const secret = creditsServiceSecret();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signed = buildSpendRequest({
    ...input,
    idempotencyKey: refundKey,
    product,
    secret,
    timestamp,
  });
  const remote = await callRemote("/refund", {
    method: "POST",
    body: signed.body,
    headers: signed.headers,
  });
  if (remote.kind === "http" && remote.status === 200) {
    return { ok: true, balance: readBalance(remote.body)?.balance ?? null };
  }
  console.warn("[credits] refund failed");
  return { ok: false, balance: null };
}
