/**
 * GA4 custom events for the Verafy product sites.
 *
 * Page views stay in app/layout.tsx (one gtag.js load, one config per
 * measurement ID, production only). This module only sends events. It does
 * not load a second tag, does not name a measurement ID, and does not send
 * a page-view configuration. One gtag('event') call is the whole send.
 * gtag delivers that call to every ID configured on the page.
 * In development and on the server it does nothing.
 * If gtag is not on the page yet, events wait briefly and are dropped
 * if the tag never arrives. An explicit window.__VERAFY_ANALYTICS_DISABLED
 * flag, for a future consent layer, also suppresses events.
 *
 * Params are an allow-list. Question wording, emails, and other free text
 * are dropped. Callers pass question_text_length, never the question.
 */

export type AnalyticsSite = "swarm" | "bias" | "forecast" | "mediation" | "judiciary" | "fuzzy";

export type RunType = "free" | "paid";

export interface AnalyticsItem {
  item_id: string;
  item_name: string;
  price?: number;
  quantity: number;
}

export type AnalyticsValue =
  | string
  | number
  | boolean
  | AnalyticsItem[]
  | undefined;

export type AnalyticsParams = Record<string, AnalyticsValue>;

export interface PendingCheckout {
  pack_id: string;
  value: number;
  credits: number;
  item_name: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const EVENTS = new Set([
  "credits_purchase_click",
  "purchase",
  "credits_purchase_success",
  "run_started",
  "run_completed",
  "run_failed",
  "question_click",
  "paywall_shown",
  "out_of_credits",
  "share_click",
  "mediation_started",
  "mediation_updated",
  "vote_cast",
  "share_x",
  "wallet_linked",
]);

const PURCHASE_PREFIX = "verafy_ga_purchase:";
const PENDING_KEY = "verafy_ga_pending_checkout";
const LOOSE_KEY = "verafy_ga_purchase:no-session";
const LOOSE_WINDOW_MS = 4000;
const QUEUE_LIMIT = 20;
const QUEUE_WAIT_MS = 10_000;

const claimed = new Set<string>();
const queue: { event: string; params: Record<string, unknown> }[] = [];
let freeGrant: boolean | null = null;
let flushing = false;
let looseClaimedAt = 0;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    __VERAFY_ANALYTICS_DISABLED?: boolean;
  }
}

export function resetAnalyticsForTests(): void {
  claimed.clear();
  queue.length = 0;
  freeGrant = null;
  flushing = false;
  looseClaimedAt = 0;
}

export function rememberCreditGrant(freeCredits: boolean): void {
  freeGrant = freeCredits;
}

export function creditGrantIsFree(): boolean | null {
  return freeGrant;
}

/**
 * Complimentary grant (freeCredits true, or not loaded yet) is a free run.
 * A purchased balance (freeCredits false) is a paid run.
 * The Solana wallet path, when that flag is on, is paid only when free
 * wallet credits do not cover the cost.
 */
export function runTypeForSpend(input: {
  solanaPayments: boolean;
  freeCredits: number;
  cost: number;
}): RunType {
  if (input.solanaPayments) {
    return input.freeCredits >= input.cost ? "free" : "paid";
  }
  return freeGrant === false ? "paid" : "free";
}

export function featureForAsk(pathname: string, queryMode?: string): string {
  if (
    pathname.includes("batch-fact-check") ||
    queryMode === "batch-fact-check"
  ) {
    return "batch_fact_check";
  }
  if (pathname.includes("fact-check") || queryMode === "fact-check")
    return "fact_check";
  if (queryMode === "predict") return "predict";
  if (queryMode === "create") return "create";
  if (queryMode === "shop") return "shop";
  return "ask";
}

export function siteFromLocation(
  hostname: string,
  pathname: string,
): AnalyticsSite {
  if (hostname.toLowerCase().startsWith("fuzzy.")) return "fuzzy";
  const host = hostname.toLowerCase().split(":")[0] ?? "";
  const path = pathname || "/";
  if (host.startsWith("bias.")) return "bias";
  if (host.startsWith("forecast.") || host.startsWith("predict."))
    return "forecast";
  if (host.startsWith("judiciary.")) return "judiciary";
  if (host.startsWith("mediation.")) return "mediation";
  if (path === "/bias" || path.startsWith("/bias/")) return "bias";
  if (path === "/mediation" || path.startsWith("/mediation/")) return "mediation";
  if (
    path === "/predict" ||
    path.startsWith("/predict/") ||
    path.startsWith("/r/")
  )
    return "forecast";
  const preview =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".vercel.app");
  if (
    path === "/method" &&
    (preview || host.startsWith("forecast.") || host.startsWith("predict."))
  ) {
    return "forecast";
  }
  return "swarm";
}

function browserWindow(): Window | null {
  const candidate = (globalThis as { window?: Window }).window;
  if (candidate && typeof candidate === "object") return candidate;
  return null;
}

function currentSite(): AnalyticsSite {
  const view = browserWindow();
  if (!view?.location) return "fuzzy";
  return siteFromLocation(view.location.hostname, view.location.pathname);
}

function token(
  value: unknown,
  max: number,
  pattern: RegExp,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!pattern.test(trimmed) || trimmed.length > max) return undefined;
  return trimmed;
}

function whole(value: unknown, max: number): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(number)) return undefined;
  const rounded = Math.round(number);
  if (rounded < 0 || rounded > max) return undefined;
  return rounded;
}

function money(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(number) || number < 0 || number > 100_000)
    return undefined;
  return Math.round(number * 100) / 100;
}

function cleanItems(value: unknown): AnalyticsItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: AnalyticsItem[] = [];
  for (const entry of value.slice(0, 3)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const itemId = token(record.item_id, 40, /^[A-Za-z0-9_-]+$/);
    if (!itemId) continue;
    const rawName =
      typeof record.item_name === "string" ? record.item_name.trim() : itemId;
    const itemName = rawName.includes("@")
      ? itemId
      : rawName.replace(/[^\w\s,.-]/g, "").slice(0, 40) || itemId;
    const price = money(record.price);
    const quantity = whole(record.quantity, 100) ?? 1;
    const item: AnalyticsItem = {
      item_id: itemId,
      item_name: itemName,
      quantity,
    };
    if (price !== undefined) item.price = price;
    items.push(item);
  }
  return items.length > 0 ? items : undefined;
}

export function prepareAnalyticsEvent(
  event: string,
  params: AnalyticsParams | undefined,
  fallbackSite: AnalyticsSite,
): { event: string; params: Record<string, unknown> } | null {
  if (!EVENTS.has(event)) return null;
  const source = params ?? {};
  const siteToken = token(source.site, 16, /^(swarm|bias|forecast|mediation|judiciary|fuzzy)$/);
  const site = siteToken ?? fallbackSite;
  const clean: Record<string, unknown> = { site };
  const explicitProduct = token(source.product, 16, /^(judiciary|mediation|swarm|bias|forecast|fuzzy)$/);
  if (explicitProduct) clean.product = explicitProduct;
  else if (site === "judiciary" || site === "mediation") clean.product = "judiciary";

  const packId = token(source.pack_id, 40, /^[A-Za-z0-9_-]+$/);
  if (packId) clean.pack_id = packId;
  const value = money(source.value);
  if (value !== undefined) clean.value = value;
  if (
    source.currency === "USD" &&
    (event === "purchase" ||
      event === "credits_purchase_success" ||
      event === "credits_purchase_click")
  ) {
    clean.currency = "USD";
  }
  const credits = whole(source.credits, 1_000_000);
  if (credits !== undefined) clean.credits = credits;
  const location = token(source.location, 40, /^[a-z0-9_]+$/);
  if (location) clean.location = location;
  const transactionId = token(
    source.transaction_id,
    200,
    /^[A-Za-z0-9_-]{8,200}$/,
  );
  if (transactionId) clean.transaction_id = transactionId;
  const runType = token(source.run_type, 8, /^(free|paid)$/);
  if (runType) clean.run_type = runType;
  const questionType = token(source.question_type, 8, /^(free|paid)$/);
  if (questionType) clean.question_type = questionType;
  if (typeof source.paid === "boolean") clean.paid = source.paid;
  const questionId = token(source.question_id, 64, /^[A-Za-z0-9_-]+$/);
  if (questionId) clean.question_id = questionId;
  const textLength = whole(source.question_text_length, 100_000);
  if (textLength !== undefined) clean.question_text_length = textLength;
  const model = token(source.model, 64, /^[A-Za-z0-9._:/-]+$/);
  if (model) clean.model = model;
  const modelCount = whole(source.model_count, 100);
  if (modelCount !== undefined) clean.model_count = modelCount;
  const questionCount = whole(source.question_count, 10_000);
  if (questionCount !== undefined) clean.question_count = questionCount;
  const feature = token(source.feature, 40, /^[a-z0-9_]+$/);
  if (feature) clean.feature = feature;
  const failure = token(source.failure, 32, /^[a-z0-9_]+$/);
  if (failure) clean.failure = failure;
  if (event === "purchase") {
    const items = cleanItems(source.items);
    if (items) clean.items = items;
  }
  return { event, params: clean };
}

function analyticsAllowed(): boolean {
  const view = browserWindow();
  if (!view) return false;
  if (process.env.NODE_ENV !== "production") return false;
  if (view.__VERAFY_ANALYTICS_DISABLED === true) return false;
  return true;
}

function flushQueue(): void {
  const view = browserWindow();
  if (!view || typeof view.gtag !== "function") return;
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    view.gtag("event", next.event, next.params);
  }
}

function waitForGtag(): void {
  if (flushing) return;
  const view = browserWindow();
  if (!view) return;
  flushing = true;
  const started = Date.now();
  const tick = () => {
    const current = browserWindow();
    if (!current) {
      flushing = false;
      queue.length = 0;
      return;
    }
    if (typeof current.gtag === "function") {
      flushing = false;
      flushQueue();
      return;
    }
    if (Date.now() - started >= QUEUE_WAIT_MS) {
      flushing = false;
      queue.length = 0;
      return;
    }
    const handle = current.setTimeout(tick, 250);
    (handle as unknown as { unref?: () => void }).unref?.();
  };
  const handle = view.setTimeout(tick, 250);
  (handle as unknown as { unref?: () => void }).unref?.();
}

export function track(event: string, params?: AnalyticsParams): void {
  try {
    const prepared = prepareAnalyticsEvent(event, params, currentSite());
    if (!prepared || !analyticsAllowed()) return;
    const view = browserWindow();
    if (!view) return;
    if (typeof view.gtag === "function") {
      view.gtag("event", prepared.event, prepared.params);
      return;
    }
    queue.push(prepared);
    if (queue.length > QUEUE_LIMIT) queue.shift();
    waitForGtag();
  } catch {
    // Analytics never blocks the product.
  }
}

export function trackQuestionClick(input: {
  paid: boolean;
  location: string;
  feature?: string;
  questionId?: string;
  textLength?: number;
  questionCount?: number;
}): void {
  track("question_click", {
    paid: input.paid,
    question_type: input.paid ? "paid" : "free",
    location: input.location,
    feature: input.feature,
    question_id: input.questionId,
    question_text_length: input.textLength,
    question_count: input.questionCount,
  });
}

export function trackPaywall(location: string, feature?: string): void {
  const params = { location, feature };
  track("paywall_shown", params);
  track("out_of_credits", params);
}

export function rememberPendingCheckout(pack: PendingCheckout): void {
  try {
    const view = browserWindow();
    view?.sessionStorage?.setItem(PENDING_KEY, JSON.stringify(pack));
  } catch {
    // Private mode can reject storage. The click event already fired.
  }
}

export function readPendingCheckout(
  store?: KeyValueStore | null,
): PendingCheckout | null {
  try {
    const source = store ?? browserWindow()?.sessionStorage;
    if (!source) return null;
    const raw = source.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingCheckout>;
    const packId = token(parsed.pack_id, 40, /^[A-Za-z0-9_-]+$/);
    const value = money(parsed.value);
    const credits = whole(parsed.credits, 1_000_000);
    if (!packId || value === undefined || credits === undefined) return null;
    const itemName =
      typeof parsed.item_name === "string" && !parsed.item_name.includes("@")
        ? parsed.item_name.trim().slice(0, 40)
        : packId;
    return { pack_id: packId, value, credits, item_name: itemName || packId };
  } catch {
    return null;
  }
}

export function claimPurchaseId(
  stores: KeyValueStore[],
  sessionId: string,
): boolean {
  const id = token(sessionId, 200, /^[A-Za-z0-9_-]{8,200}$/);
  if (!id) return false;
  if (claimed.has(id)) return false;
  const key = `${PURCHASE_PREFIX}${id}`;
  for (const store of stores) {
    try {
      if (store.getItem(key)) {
        claimed.add(id);
        return false;
      }
    } catch {
      // Ignore an unreadable store and try the next one.
    }
  }
  claimed.add(id);
  for (const store of stores) {
    try {
      store.setItem(key, "1");
    } catch {
      // One store is enough. The in-memory set still dedupes this page.
    }
  }
  return true;
}

function claimLoose(store: KeyValueStore | null, now: number): boolean {
  if (looseClaimedAt > 0 && now - looseClaimedAt < LOOSE_WINDOW_MS)
    return false;
  try {
    const prev = Number(store?.getItem(LOOSE_KEY) || 0);
    if (Number.isFinite(prev) && prev > 0 && now - prev < LOOSE_WINDOW_MS) {
      looseClaimedAt = prev;
      return false;
    }
    store?.setItem(LOOSE_KEY, String(now));
  } catch {
    // The in-memory timestamp still stops a second mount in this page.
  }
  looseClaimedAt = now;
  return true;
}

function stores(): KeyValueStore[] {
  const view = browserWindow();
  const found: KeyValueStore[] = [];
  if (view?.localStorage) found.push(view.localStorage);
  if (view?.sessionStorage) found.push(view.sessionStorage);
  return found;
}

/**
 * Stripe return is `?credits=success&session_id=...`.
 * `purchase` is the GA4 ecommerce event and is sent once per session id.
 * `credits_purchase_success` is sent with it. Without a session id, only
 * the custom success event is sent, and a short sessionStorage window
 * stops a double mount from counting twice.
 */
export function trackCheckoutSuccess(
  search: { get(name: string): string | null },
  now = Date.now(),
): void {
  try {
    const sessionId = token(
      search.get("session_id") || search.get("sessionId") || "",
      200,
      /^[A-Za-z0-9_-]{8,200}$/,
    );
    const pending = readPendingCheckout();
    const packId = token(
      search.get("pack_id") || pending?.pack_id,
      40,
      /^[A-Za-z0-9_-]+$/,
    );
    const value = money(search.get("value")) ?? pending?.value;
    const credits = pending?.credits;
    const itemName = pending?.item_name || packId || "credits";
    if (sessionId) {
      if (!claimPurchaseId(stores(), sessionId)) return;
    } else if (!claimLoose(browserWindow()?.sessionStorage ?? null, now)) {
      return;
    }
    try {
      browserWindow()?.sessionStorage?.removeItem(PENDING_KEY);
    } catch {
      // Leaving the pending pack in place is harmless after the claim.
    }
    const shared: AnalyticsParams = {
      pack_id: packId,
      value,
      currency: "USD",
      credits,
      feature: "credits",
    };
    if (sessionId) {
      track("purchase", {
        ...shared,
        transaction_id: sessionId,
        items: packId
          ? [
              {
                item_id: packId,
                item_name: itemName,
                price: value,
                quantity: 1,
              },
            ]
          : [
              {
                item_id: "credits",
                item_name: "credits",
                price: value,
                quantity: 1,
              },
            ],
      });
    }
    track("credits_purchase_success", {
      ...shared,
      transaction_id: sessionId,
    });
  } catch {
    // A failed analytics call must not block the balance refresh.
  }
}
