/**
 * Measurement IDs for the one gtag.js load in app/layout.tsx.
 *
 * NEXT_PUBLIC_GA_MEASUREMENT_ID may be one ID or a comma-separated list.
 * When it is unset, blank, or has no valid ID, the page configures the
 * shared property plus the two additional properties. A single valid ID
 * stays that one ID. Duplicates are dropped so a property is not
 * configured twice (that would double-count page views inside it).
 *
 * track() in lib/analytics.ts does not read this list. One gtag('event')
 * call is delivered by gtag to every ID configured on the page.
 */

export const GA_MEASUREMENT_ID_SHARED = "G-C3M2F8QGYC";

/** Part of the default list. Omitted when the env var sets its own IDs. */
export const GA_MEASUREMENT_IDS_ADDED = [
  "G-S4VE871DVG",
  "G-9SS2E9QPM8",
] as const;

export const DEFAULT_GA_MEASUREMENT_IDS = [
  GA_MEASUREMENT_ID_SHARED,
  ...GA_MEASUREMENT_IDS_ADDED,
] as const;

const MEASUREMENT_ID = /^G-[A-Z0-9]+$/;

export function gaMeasurementIds(raw: string | null | undefined): string[] {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return [...DEFAULT_GA_MEASUREMENT_IDS];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const id = part.trim();
    if (!MEASUREMENT_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : [...DEFAULT_GA_MEASUREMENT_IDS];
}

/** One loader. The query id is the first configured property. */
export function gaScriptSrc(ids: readonly string[]): string | null {
  const primary = ids[0];
  if (!primary) return null;
  return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(primary)}`;
}

/**
 * One inline bootstrap. Each ID is configured once, with cookie_domain
 * auto, so the verafy.ai subdomains share a client. The config command
 * sends that property's page view. Later event commands, which omit a
 * destination, go to every ID configured here.
 */
export function gaInlineSnippet(ids: readonly string[]): string {
  const lines = [
    "window.dataLayer = window.dataLayer || [];",
    "function gtag(){dataLayer.push(arguments);}",
    "gtag('js', new Date());",
    ...ids.map(
      (id) =>
        `gtag('config', ${JSON.stringify(id)}, { cookie_domain: 'auto' });`,
    ),
  ];
  return lines.join("\n");
}
