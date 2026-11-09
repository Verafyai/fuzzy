export type VerafyHeaderLink = { label: string; href: string };

export type ProductId = "fuzzy";

/** Fuzzy at https://fuzzy.verafy.ai. The lockup is the home. */
export const PRODUCT_HOMES: Record<
  ProductId,
  { name: string; home: string; ariaLabel: string; lockup?: string }
> = {
  fuzzy: { name: "Fuzzy", home: "/", ariaLabel: "Fuzzy home" },
};

/** Header cap is three. Scan is the lockup. */
export const FUZZY_LINKS: readonly VerafyHeaderLink[] = [
  { label: "Example report", href: "/example" },
  { label: "Method", href: "/method" },
];

export const PRODUCT_LINKS: Record<ProductId, readonly VerafyHeaderLink[]> = {
  fuzzy: FUZZY_LINKS,
};

export function linkIsCurrent(pathname: string, href: string): boolean {
  const path = (pathname.split("?")[0] || "/").replace(/\/$/, "") || "/";
  const target = (href.split("?")[0] || "/").replace(/\/$/, "") || "/";
  if (target === "/") return path === "/";
  return path === target || path.startsWith(`${target}/`);
}
