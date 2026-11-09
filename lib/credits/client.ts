"use client";

import {
  CREDIT_PRODUCT_SHARED,
  type CreditProduct,
} from "@/lib/credits/config";
import { readBalance, readPacks, readPaymentsEnabled, type CreditPack } from "@/lib/credits/normalize";
import { rememberCreditGrant } from "@/lib/analytics";

export const CREDITS_OPEN_EVENT = "verafy-credits:open";
export const CREDITS_REFRESH_EVENT = "verafy-credits:refresh";

const SAME_ORIGIN_BASE = "/api/verafy-credits";

export interface BalanceView {
  status: "loading" | "ready" | "unavailable";
  balance: number | null;
  freeCredits: boolean;
  product: CreditProduct;
}

export interface PackView {
  packs: CreditPack[];
  paymentsEnabled: boolean;
  product: CreditProduct;
}

export function openBuyCredits(detail?: { outOfCredits?: boolean; product?: CreditProduct }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CREDITS_OPEN_EVENT, { detail }));
}

export function refreshCreditsBalance(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CREDITS_REFRESH_EVENT));
}

export class OutOfCreditsError extends Error {
  readonly code = "out_of_credits";

  constructor(
    message: string,
    readonly balance: number | null,
  ) {
    super(message);
    this.name = "OutOfCreditsError";
  }
}

export function isOutOfCredits(error: unknown): error is OutOfCreditsError {
  return (
    error instanceof OutOfCreditsError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "out_of_credits")
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function productQuery(product: CreditProduct): string {
  return `product=${encodeURIComponent(product)}`;
}

export async function fetchCreditBalance(
  product: CreditProduct = CREDIT_PRODUCT_SHARED,
): Promise<BalanceView> {
  try {
    const response = await fetch(`${SAME_ORIGIN_BASE}/balance?${productQuery(product)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await readJson(response);
    if (!response.ok || (body && typeof body === "object" && (body as { unavailable?: boolean }).unavailable)) {
      return { status: "unavailable", balance: null, freeCredits: false, product };
    }
    const parsed = readBalance(body);
    if (!parsed) return { status: "unavailable", balance: null, freeCredits: false, product };
    rememberCreditGrant(parsed.freeCredits);
    return { status: "ready", balance: parsed.balance, freeCredits: parsed.freeCredits, product };
  } catch {
    return { status: "unavailable", balance: null, freeCredits: false, product };
  }
}

export async function fetchCreditPacks(
  product: CreditProduct = CREDIT_PRODUCT_SHARED,
): Promise<PackView> {
  try {
    const response = await fetch(`${SAME_ORIGIN_BASE}/packs?${productQuery(product)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await readJson(response);
    if (!response.ok) {
      return { packs: readPacks(null, product), paymentsEnabled: false, product };
    }
    return {
      packs: readPacks(body, product),
      paymentsEnabled: readPaymentsEnabled(body),
      product,
    };
  } catch {
    return { packs: readPacks(null, product), paymentsEnabled: false, product };
  }
}

export async function startCreditCheckout(
  packId: string,
  returnUrl: string,
  product: CreditProduct = CREDIT_PRODUCT_SHARED,
): Promise<{ url: string } | { error: string }> {
  try {
    const response = await fetch(`${SAME_ORIGIN_BASE}/checkout`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId, returnUrl, product }),
    });
    const body = await readJson(response);
    const url = body && typeof body === "object" ? (body as { url?: unknown }).url : null;
    if (response.ok && typeof url === "string") return { url };
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      return { error: (body as { error: string }).error };
    }
  } catch {
    return { error: "Card checkout is unavailable right now." };
  }
  return { error: "Card checkout is unavailable right now." };
}
