/**
 * Shared Verafy credits contract (www.verafy.ai/api/credits).
 *
 * Public routes, called server-side from this app (signed with CREDITS_SERVICE_SECRET):
 *   GET  /balance?product=shared|forecast
 *   GET  /packs?product=shared|forecast
 *   POST /checkout  { packId, returnUrl, product }
 *
 * Server-only spend (never called from the browser):
 *   POST /spend { amount, reason, idempotencyKey, source, product }
 *   Headers:
 *     x-verafy-visitor-id: visitor id read from the verafy_vid cookie
 *     x-verafy-credits-timestamp: unix seconds, within 5 minutes
 *     x-verafy-credits-signature: hex HMAC-SHA256 of
 *       `${timestamp}.${visitorId}.${rawBody}` using CREDITS_SERVICE_SECRET
 *   If the Cookie header is also sent, it must be verafy_vid=<same id>.
 *   402: { error: "insufficient_credits", balance }
 *   Same idempotencyKey: { balance, idempotent: true } and no second spend.
 *   429: more than 30 spends per visitor per minute.
 *
 * balance, packs, and spend take an optional product. Omitted means "shared".
 * Forecast on-demand forecasts use product "forecast".
 * GET balance and packs are signed the same way, with rawBody
 *   JSON.stringify({ product }).
 *
 * When CREDITS_SERVICE_SECRET is unset, the local mock ledger is used.
 * Purchases stay closed unless the packs payload sets paymentsEnabled.
 */

export const CREDITS_API_URL_DEFAULT = "https://www.verafy.ai/api/credits";

/** First-party visitor cookie. Scoped to .verafy.ai in production. */
export const VISITOR_COOKIE = "verafy_vid";

export const CREDITS_VISITOR_HEADER = "x-verafy-visitor-id";
export const CREDITS_TIMESTAMP_HEADER = "x-verafy-credits-timestamp";
export const CREDITS_SIGNATURE_HEADER = "x-verafy-credits-signature";

/** Visitor ids and spend idempotency keys. */
export const CREDITS_TOKEN_PATTERN = /^[A-Za-z0-9:_-]{8,200}$/;

export const SPEND_RATE_LIMIT_PER_MINUTE = 30;

export const NEW_VISITOR_FREE_CREDITS = 1000;

export const CREDIT_PACKS = [
  { id: "starter", name: "Starter", priceUsd: 5, credits: 1_000 },
  { id: "standard", name: "Standard", priceUsd: 20, credits: 5_000 },
  { id: "pro", name: "Pro", priceUsd: 50, credits: 15_000 },
] as const;

/** Forecast ledger. $10 = 1,000, $25 = 3,000, $50 = 7,000. */
export const FORECAST_CREDIT_PACKS = [
  { id: "forecast-10", name: "1,000", priceUsd: 10, credits: 1_000 },
  { id: "forecast-25", name: "3,000", priceUsd: 25, credits: 3_000 },
  { id: "forecast-50", name: "7,000", priceUsd: 50, credits: 7_000 },
] as const;

export type CreditPackId =
  | (typeof CREDIT_PACKS)[number]["id"]
  | (typeof FORECAST_CREDIT_PACKS)[number]["id"];

export const CREDIT_PRODUCT_SHARED = "shared";
export const CREDIT_PRODUCT_FORECAST = "forecast";

export const CREDIT_PRODUCTS = [CREDIT_PRODUCT_SHARED, CREDIT_PRODUCT_FORECAST] as const;

export type CreditProduct = (typeof CREDIT_PRODUCTS)[number];

/** Shown instead of a checkout when the packs payload keeps purchases closed. */
export const CREDITS_PURCHASE_CLOSED = "Credits purchase isn't open yet";

export type CreditSource =
  | "bias-detector"
  | "swarm-explorer"
  | "fact-check"
  | "forecast"
  | "mediation"
  | "fuzzy";

/** One-time packs. No subscription. */
export const CREDIT_PACKS_ARE_SUBSCRIPTION = false;

/**
 * Credits charged before a paid action runs.
 * Reads of cached results, leaderboards, and question banks stay free.
 */
export const CREDIT_COSTS = {
  /** One Fuzzy Sniff run. Deep Fuzz and Kitchen Sink are priced when they ship. */
  fuzzySniff: 100,
  biasDetectorRun: 100,
  swarmExplorerRun: 200,
  factCheck: 50,
  /** One on-demand Forecast race. Published daily races stay free to read. */
  onDemandForecast: 200,
  /**
   * One Mediation brief. Rex set this cost. Reads of a saved brief stay free.
   * Do not change the other rows in this table from a Mediation change.
   */
  mediationRun: 200,
  /**
   * One claim dispute. Defined for Mediation: the council re-checks that claim
   * with the submitted evidence. Worst-pack revenue is about $0.17. The
   * estimated model spend is under $0.05. See docs/mediation/COST.md.
   */
  mediationDispute: 50,
  /**
   * A reader-proposed position. Defined for Mediation: fairness check, one
   * regenerate if it is under 8, and a jury score. Same revenue margin as a
   * dispute. The position is stored only when fairness reaches 8.
   */
  mediationPosition: 50,
} as const;

export type PaidAction = keyof typeof CREDIT_COSTS;

export function creditsApiUrl(): string {
  const configured =
    process.env.CREDITS_API_URL || process.env.NEXT_PUBLIC_CREDITS_API_URL;
  return (configured || CREDITS_API_URL_DEFAULT).replace(/\/$/, "");
}

export function creditsServiceSecret(): string {
  return (process.env.CREDITS_SERVICE_SECRET || "").trim();
}

export function creditsMockForced(): boolean {
  const flag = process.env.CREDITS_MOCK || process.env.NEXT_PUBLIC_CREDITS_MOCK;
  return flag === "1" || flag === "true";
}

/** Local ledger when the secret is unset, or when the mock flag is on. */
export function creditsUseMock(): boolean {
  return creditsMockForced() || creditsServiceSecret().length === 0;
}

export function readCreditProduct(value: unknown): CreditProduct {
  return value === CREDIT_PRODUCT_FORECAST ? CREDIT_PRODUCT_FORECAST : CREDIT_PRODUCT_SHARED;
}

/** Header product ids. Forecast is its own ledger. Every other surface shares one. */
export function creditProductForHeader(product: string): CreditProduct {
  return product === "predict" ? CREDIT_PRODUCT_FORECAST : CREDIT_PRODUCT_SHARED;
}

export function packsForProduct(product: CreditProduct) {
  return product === CREDIT_PRODUCT_FORECAST ? FORECAST_CREDIT_PACKS : CREDIT_PACKS;
}

export function priceForBroadcast(
  queryMode: string | undefined,
  product: string | undefined,
): {
  amount: number;
  reason: string;
  action: PaidAction;
  source: CreditSource;
  product: CreditProduct;
} {
  if (product === "fact-check" || queryMode === "batch-fact-check") {
    return {
      amount: CREDIT_COSTS.factCheck,
      reason: "fact-check",
      action: "factCheck",
      source: "fact-check",
      product: CREDIT_PRODUCT_SHARED,
    };
  }
  if (product === "swarm") {
    return {
      amount: CREDIT_COSTS.swarmExplorerRun,
      reason: "swarm-explorer-run",
      action: "swarmExplorerRun",
      source: "swarm-explorer",
      product: CREDIT_PRODUCT_SHARED,
    };
  }
  if (queryMode === "fact-check") {
    return {
      amount: CREDIT_COSTS.factCheck,
      reason: "fact-check",
      action: "factCheck",
      source: "fact-check",
      product: CREDIT_PRODUCT_SHARED,
    };
  }
  return {
    amount: CREDIT_COSTS.swarmExplorerRun,
    reason: "swarm-explorer-run",
    action: "swarmExplorerRun",
    source: "swarm-explorer",
    product: CREDIT_PRODUCT_SHARED,
  };
}

/** Mediation spends on the shared ledger. Existing broadcast prices stay put. */
export function mediationCreditPrice(
  action: "mediationRun" | "mediationDispute" | "mediationPosition",
): {
  amount: number;
  reason: string;
  action: PaidAction;
  source: CreditSource;
  product: CreditProduct;
} {
  const reason =
    action === "mediationRun"
      ? "mediation-run"
      : action === "mediationDispute"
        ? "mediation-dispute"
        : "mediation-position";
  return {
    amount: CREDIT_COSTS[action],
    reason,
    action,
    source: "mediation",
    product: CREDIT_PRODUCT_SHARED,
  };
}
