"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  CREDIT_PRODUCT_SHARED,
  CREDITS_PURCHASE_CLOSED,
  type CreditProduct,
} from "@/lib/credits/config";
import {
  CREDITS_OPEN_EVENT,
  fetchCreditPacks,
  startCreditCheckout,
} from "@/lib/credits/client";
import type { CreditPack } from "@/lib/credits/normalize";
import { rememberPendingCheckout, track, trackPaywall } from "@/lib/analytics";

export function BuyCredits({
  product = CREDIT_PRODUCT_SHARED,
  variant = "link",
  listen = false,
  source,
  children = "Buy credits",
}: {
  product?: CreditProduct;
  variant?: "link" | "badge";
  listen?: boolean;
  /** Where the buy control sits. Sent as the analytics `location` param. */
  source?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const location = source ?? (variant === "badge" ? "header_badge" : "buy_link");

  useEffect(() => {
    if (!listen) return;
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ outOfCredits?: boolean; product?: CreditProduct }>).detail;
      if (detail?.product && detail.product !== product) return;
      const blocked = Boolean(detail?.outOfCredits);
      setOutOfCredits(blocked);
      setOpen(true);
      if (blocked) trackPaywall("credits_dialog", "credits");
    };
    window.addEventListener(CREDITS_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CREDITS_OPEN_EVENT, onOpen);
  }, [listen, product]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea")].filter(
        (item) => !item.hasAttribute("disabled"),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      (previouslyFocused ?? triggerRef.current)?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={variant === "badge" ? "verafy-credits__buy" : "credits-buy-link"}
        aria-label={variant === "badge" ? "Buy more" : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOutOfCredits(false);
          setOpen(true);
          track("credits_purchase_click", { location, feature: "credits" });
        }}
      >
        {variant === "badge" ? (
          <>
            <span className="verafy-credits__buy-full">Buy more</span>
            <span className="verafy-credits__buy-short">Buy</span>
          </>
        ) : (
          children
        )}
      </button>
      {open ? (
        <PurchaseDialog
          product={product}
          titleId={titleId}
          dialogRef={dialogRef}
          outOfCredits={outOfCredits}
          location={location}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function PurchaseDialog({
  product,
  titleId,
  dialogRef,
  outOfCredits,
  location,
  onClose,
}: {
  product: CreditProduct;
  titleId: string;
  dialogRef: RefObject<HTMLDivElement | null>;
  outOfCredits: boolean;
  location: string;
  onClose: () => void;
}) {
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchCreditPacks(product).then((result) => {
      if (cancelled) return;
      setPaymentsEnabled(result.paymentsEnabled);
      setPacks(result.packs);
    });
    return () => {
      cancelled = true;
    };
  }, [product]);

  const dialog = (
    <div className="verafy-credits__layer">
      <button type="button" className="verafy-credits__backdrop" aria-label="Close buy credits" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="verafy-credits__sheet"
      >
        <div className="verafy-credits__head">
          <div>
            <h2 id={titleId}>Buy credits</h2>
            {outOfCredits ? <p>You&apos;re out of credits.</p> : null}
            {paymentsEnabled ? (
              <p>Credits never expire. There are no subscriptions.</p>
            ) : (
              <p>{CREDITS_PURCHASE_CLOSED}</p>
            )}
          </div>
          <button type="button" className="verafy-credits__close" onClick={onClose}>
            Close
          </button>
        </div>
        {paymentsEnabled ? (
          <ul className="verafy-credits__packs">
            {packs.map((pack) => (
              <li key={pack.id} className="verafy-credits__pack">
                <h3>{pack.name}</h3>
                <p className="verafy-credits__price">${pack.priceUsd}</p>
                <p>{pack.credits.toLocaleString("en-US")} credits</p>
                <button
                  type="button"
                  className="credits-buy-link"
                  disabled={busyId !== null}
                  onClick={() => {
                    track("credits_purchase_click", {
                      location,
                      pack_id: pack.id,
                      value: pack.priceUsd,
                      currency: "USD",
                      credits: pack.credits,
                      feature: "credits",
                    });
                    rememberPendingCheckout({
                      pack_id: pack.id,
                      value: pack.priceUsd,
                      credits: pack.credits,
                      item_name: pack.name,
                    });
                    setBusyId(pack.id);
                    setError(null);
                    void startCreditCheckout(pack.id, window.location.href.split("#")[0], product).then((result) => {
                      if ("url" in result) {
                        window.location.assign(result.url);
                        return;
                      }
                      setError(result.error);
                      setBusyId(null);
                    });
                  }}
                >
                  Buy {pack.credits.toLocaleString("en-US")} credits for ${pack.priceUsd}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p className="verafy-credits__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(dialog, document.body);
}
