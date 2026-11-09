"use client";

import { useEffect } from "react";
import { CREDIT_PRODUCT_SHARED, type CreditProduct } from "@/lib/credits/config";
import { BuyCredits } from "@/components/credits/buy-credits";
import { trackPaywall } from "@/lib/analytics";

/** Shared out-of-credits state. The buy control is the same underlined link. */
export function OutOfCredits({
  product = CREDIT_PRODUCT_SHARED,
  message = "You're out of credits.",
  feature,
}: {
  product?: CreditProduct;
  message?: string;
  feature?: string;
}) {
  useEffect(() => {
    trackPaywall("out_of_credits", feature);
  }, [feature]);

  return (
    <div className="credits-out" role="status">
      <p>{message}</p>
      <BuyCredits product={product} source="out_of_credits">Buy credits</BuyCredits>
    </div>
  );
}
