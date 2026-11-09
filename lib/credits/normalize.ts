import {
  CREDIT_PRODUCT_SHARED,
  packsForProduct,
  type CreditPackId,
  type CreditProduct,
} from "@/lib/credits/config";

export interface CreditPack {
  id: string;
  name: string;
  priceUsd: number;
  credits: number;
  recurring: false;
}

export interface CreditBalance {
  balance: number;
  /** True while the visitor is still on the complimentary grant. */
  freeCredits: boolean;
}

export function readBalance(body: unknown): CreditBalance | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const raw = record.balance ?? record.credits;
  const balance = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(balance)) return null;
  const freeFlag = record.freeCredits ?? record.free ?? record.freeGrant;
  return {
    balance,
    freeCredits: typeof freeFlag === "boolean" ? freeFlag : true,
  };
}

export function readPaymentsEnabled(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as { paymentsEnabled?: unknown }).paymentsEnabled === true;
}

export function readPacks(body: unknown, product: CreditProduct = CREDIT_PRODUCT_SHARED): CreditPack[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { packs?: unknown }).packs)
      ? (body as { packs: unknown[] }).packs
      : [];
  const packs: CreditPack[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const credits = Number(record.credits);
    const priceUsd = priceUsdOf(record);
    if (!id || !Number.isFinite(credits) || !Number.isFinite(priceUsd)) continue;
    const name = typeof record.name === "string" ? record.name : id;
    packs.push({ id, name, priceUsd, credits, recurring: false });
  }
  return packs.length > 0 ? packs : defaultPacks(product);
}

function priceUsdOf(record: Record<string, unknown>): number {
  if (record.priceUsd != null) return Number(record.priceUsd);
  if (record.priceCents != null) return Number(record.priceCents) / 100;
  return Number(record.price ?? record.amountUsd);
}

export function defaultPacks(product: CreditProduct = CREDIT_PRODUCT_SHARED): CreditPack[] {
  return packsForProduct(product).map((pack) => ({
    id: pack.id,
    name: pack.name,
    priceUsd: pack.priceUsd,
    credits: pack.credits,
    recurring: false,
  }));
}

export function isKnownPack(id: string, product: CreditProduct = CREDIT_PRODUCT_SHARED): id is CreditPackId {
  return packsForProduct(product).some((pack) => pack.id === id);
}

export function withCreditsSuccess(returnUrl: string): string {
  const url = new URL(returnUrl);
  url.searchParams.set("credits", "success");
  return url.toString();
}

const ALLOWED_RETURN_HOST = /(^|\.)verafy\.ai$/;

export function safeReturnUrl(value: unknown, requestUrl: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return null;
  try {
    const url = new URL(value, requestUrl);
    if (url.username || url.password) return null;
    const host = url.hostname;
    const local = host === "localhost" || host === "127.0.0.1";
    if (url.protocol === "http:" && !local) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!local && host !== "verafy.ai" && !ALLOWED_RETURN_HOST.test(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
