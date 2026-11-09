"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CreditsBadge } from "@/components/credits/credits-badge";
import { creditProductForHeader } from "@/lib/credits/config";
import { FuzzyMascot } from "@/components/fuzzy/mascot";
import {
  PRODUCT_HOMES,
  linkIsCurrent,
  type ProductId,
  type VerafyHeaderLink,
} from "@/components/verafy-header/links";
import { STAGE_LABEL, productStage } from "@/lib/product-status";
import "./product-header.css";

export function ProductHeader({
  product,
  links,
  badge,
}: {
  product: ProductId;
  links: readonly VerafyHeaderLink[];
  /** @deprecated The pill comes from lib/product-status.ts; kept so old callers compile. */
  badge?: string;
}) {
  void badge;
  const stage = productStage(product);
  const pathname = usePathname() || "";
  const home = PRODUCT_HOMES[product];
  const menuId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1100) setOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <header
      className="product-header"
      data-site-header
      data-product={product}
      ref={rootRef}
    >
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/credits/verafy-credits.css" />
      <div className="product-header__bar" data-header-inner>
        {links.length > 0 ? (
          <button
            ref={menuRef}
            type="button"
            className="product-header__menu"
            data-header-menu
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
          >
            <MenuGlyph open={open} />
          </button>
        ) : null}
        <a
          className="product-header__lockup"
          data-product-lockup
          href={home.home}
          aria-label={home.ariaLabel}
        >
          <FuzzyMascot mood="waiting" size={24} className="product-header__mark" decorative />
          <span className="product-header__name" data-product-name>
            {home.lockup ?? home.name}
          </span>
          {stage ? (
            <span
              className="product-header__beta product-header__stage"
              data-stage={stage}
              data-product-stage
              data-allow-small-text
            >
              {STAGE_LABEL[stage]}
            </span>
          ) : null}
        </a>
        <div className="product-header__cluster">
          {links.length > 0 ? (
            <nav
              className="product-header__links"
              aria-label="Product"
              data-allow-small-text
            >
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  aria-current={
                    linkIsCurrent(pathname, link.href) ? "page" : undefined
                  }
                >
                  {link.label}
                </a>
              ))}
            </nav>
          ) : null}
          {links.length > 0 ? (
            <span className="product-header__divider" aria-hidden="true" />
          ) : null}
          <a
            className="product-header__verafy"
            href="https://www.verafy.ai"
            data-allow-small-text
          >
            Verafy.ai
            <svg
              className="product-header__external"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path
                d="M3.2 8.8 L8.8 3.2 M5 3.2 H8.8 V7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
          <div className="product-header__slot">
            <CreditsBadge product={creditProductForHeader(product)} />
          </div>
        </div>
      </div>
      <div
        className="product-header__sheet"
        id={menuId}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        hidden={!open || links.length === 0}
      >
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={
              linkIsCurrent(pathname, link.href) ? "page" : undefined
            }
          >
            {link.label}
          </a>
        ))}
        <a href="https://www.verafy.ai">Verafy.ai</a>
      </div>
    </header>
  );
}

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      {open ? (
        <path
          d="M6 6 L18 18 M18 6 L6 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M4 7 H20 M4 12 H20 M4 17 H20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
