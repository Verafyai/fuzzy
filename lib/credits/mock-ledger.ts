import {
  CREDIT_PRODUCT_SHARED,
  CREDITS_TOKEN_PATTERN,
  NEW_VISITOR_FREE_CREDITS,
  packsForProduct,
  SPEND_RATE_LIMIT_PER_MINUTE,
  type CreditPackId,
  type CreditProduct,
} from "@/lib/credits/config";
import { defaultPacks, withCreditsSuccess, type CreditPack } from "@/lib/credits/normalize";

interface Account {
  balance: number;
  freeCredits: boolean;
}

const WINDOW_MS = 60_000;

const accounts = new Map<string, Account>();
const receipts = new Map<string, number>();
const spendWindows = new Map<string, number[]>();

export function resetMockLedger(): void {
  accounts.clear();
  receipts.clear();
  spendWindows.clear();
}

function accountKey(visitorId: string, product: CreditProduct): string {
  return `${product}:${visitorId}`;
}

function accountFor(visitorId: string, product: CreditProduct = CREDIT_PRODUCT_SHARED): Account {
  const key = accountKey(visitorId, product);
  const existing = accounts.get(key);
  if (existing) return existing;
  const created: Account = {
    balance: NEW_VISITOR_FREE_CREDITS,
    freeCredits: true,
  };
  accounts.set(key, created);
  return created;
}

export function mockBalance(
  visitorId: string,
  product: CreditProduct = CREDIT_PRODUCT_SHARED,
): { balance: number; freeCredits: boolean } {
  const account = accountFor(visitorId, product);
  return { balance: account.balance, freeCredits: account.freeCredits };
}

export function mockPacks(product: CreditProduct = CREDIT_PRODUCT_SHARED): CreditPack[] {
  return defaultPacks(product);
}

function allowSpendAttempt(visitorId: string, now: number): boolean {
  const windowStart = now - WINDOW_MS;
  const stamps = (spendWindows.get(visitorId) ?? []).filter((stamp) => stamp > windowStart);
  if (stamps.length >= SPEND_RATE_LIMIT_PER_MINUTE) {
    spendWindows.set(visitorId, stamps);
    return false;
  }
  stamps.push(now);
  spendWindows.set(visitorId, stamps);
  return true;
}

export function mockSpend(input: {
  visitorId: string;
  amount: number;
  idempotencyKey: string;
  product?: CreditProduct;
  now?: number;
}):
  | { ok: true; balance: number; idempotent: boolean }
  | { ok: false; code: "insufficient" | "rate_limited" | "invalid"; balance: number } {
  const product = input.product ?? CREDIT_PRODUCT_SHARED;
  const account = accountFor(input.visitorId, product);
  if (!CREDITS_TOKEN_PATTERN.test(input.idempotencyKey)) {
    return { ok: false, code: "invalid", balance: account.balance };
  }

  const receiptKey = `${product}:${input.visitorId}:${input.idempotencyKey}`;
  if (receipts.has(receiptKey)) return { ok: true, balance: account.balance, idempotent: true };

  if (!allowSpendAttempt(input.visitorId, input.now ?? Date.now())) {
    return { ok: false, code: "rate_limited", balance: account.balance };
  }

  if (account.balance < input.amount) {
    return { ok: false, code: "insufficient", balance: account.balance };
  }
  account.balance -= input.amount;
  receipts.set(receiptKey, input.amount);
  return { ok: true, balance: account.balance, idempotent: false };
}

/** Put a prior spend back. A second refund with the same key does not add twice. */
export function mockRefund(input: {
  visitorId: string;
  amount: number;
  idempotencyKey: string;
  product?: CreditProduct;
}):
  | { ok: true; balance: number; idempotent: boolean }
  | { ok: false; code: "missing" | "invalid"; balance: number } {
  const product = input.product ?? CREDIT_PRODUCT_SHARED;
  const account = accountFor(input.visitorId, product);
  if (!CREDITS_TOKEN_PATTERN.test(input.idempotencyKey) || input.amount <= 0) {
    return { ok: false, code: "invalid", balance: account.balance };
  }
  const spendKey = `${product}:${input.visitorId}:${input.idempotencyKey}`;
  const refundKey = `${product}:${input.visitorId}:refund:${input.idempotencyKey}`;
  const spent = receipts.get(spendKey);
  if (spent == null) return { ok: false, code: "missing", balance: account.balance };
  if (receipts.has(refundKey)) return { ok: true, balance: account.balance, idempotent: true };
  const amount = Math.min(input.amount, spent);
  account.balance += amount;
  receipts.set(refundKey, amount);
  return { ok: true, balance: account.balance, idempotent: false };
}

export function mockCheckout(input: {
  visitorId: string;
  packId: string;
  returnUrl: string;
  product?: CreditProduct;
}): { url: string } | { error: string } {
  const product = input.product ?? CREDIT_PRODUCT_SHARED;
  const pack = packsForProduct(product).find((item) => item.id === input.packId);
  if (!pack) return { error: "Unknown credit pack." };
  const account = accountFor(input.visitorId, product);
  account.balance += pack.credits;
  account.freeCredits = false;
  return { url: withCreditsSuccess(input.returnUrl) };
}

export function mockPackId(id: string, product: CreditProduct = CREDIT_PRODUCT_SHARED): id is CreditPackId {
  return packsForProduct(product).some((pack) => pack.id === id);
}
