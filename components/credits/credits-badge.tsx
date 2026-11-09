"use client";

import { useEffect, useState } from "react";
import { CREDIT_PRODUCT_SHARED, type CreditProduct } from "@/lib/credits/config";
import {
  CREDITS_REFRESH_EVENT,
  fetchCreditBalance,
  type BalanceView,
} from "@/lib/credits/client";
import { BuyCredits } from "@/components/credits/buy-credits";

function formatCredits(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function CreditsBadge({ product = CREDIT_PRODUCT_SHARED }: { product?: CreditProduct }) {
  const [view, setView] = useState<BalanceView>({
    status: "loading",
    balance: null,
    freeCredits: true,
    product,
  });

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void fetchCreditBalance(product).then((next) => {
        if (!cancelled) setView(next);
      });
    };
    refresh();
    window.addEventListener(CREDITS_REFRESH_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(CREDITS_REFRESH_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [product]);

  const count = view.balance === null ? "…" : formatCredits(view.balance);
  const words = view.balance === null ? "" : view.freeCredits ? " free credits" : " credits";
  const label = view.balance === null ? "Loading your credits" : `${count}${words}`;

  return (
    <div
      className="verafy-credits"
      data-credits-badge=""
      data-allow-small-text=""
      data-credit-product={product}
      role="group"
      aria-label={label}
    >
      <span className="verafy-credits__status">
        <span className="verafy-credits__dot" aria-hidden="true" />
        <span className="verafy-credits__count" data-role="count">
          {count}
        </span>
        <span className="verafy-credits__words verafy-credits__words--full" data-role="words">
          {words}
        </span>
        <span className="verafy-credits__words verafy-credits__words--short" data-role="words-short">
          {view.balance === null ? "" : " credits"}
        </span>
      </span>
      <BuyCredits product={product} variant="badge" listen />
    </div>
  );
}
