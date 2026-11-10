/** The Fuzzy build machine on Modal: submit a job and read its status. Server only. */

export const HEAVY_ADDONS = {
  rebuild: { name: "Rebuild from source", credits: 500, needsSource: true },
  lints: { name: "Static lints", credits: 300, needsSource: true },
  deep: { name: "Deep Fuzz", credits: 1000, needsSource: false },
  property: { name: "Property fuzzing", credits: 1500, needsSource: false },
  review: { name: "AI design review", credits: 1000, needsSource: true },
} as const;
export type HeavyAddon = keyof typeof HEAVY_ADDONS;
export const SINK_CREDITS = 4000;

const prefix = () => (process.env.FUZZY_WORKER_PREFIX || "").trim().replace(/\/+$/, "");
/**
 * The build machine's endpoint for one function. FUZZY_WORKER_PREFIX may be the app prefix
 * (https://verafyai--fuzzy-worker, optionally with a region: https://verafyai--fuzzy-worker.us-east)
 * or the full submit URL Modal printed (https://verafyai--fuzzy-worker-submit.us-east.modal.run).
 */
export function endpoint(fn: "submit" | "status", base = prefix()) {
  const full = base.match(/^(https:\/\/[^/]+?)-(?:submit|status)(\.[a-z0-9-]+)?\.modal\.run$/);
  if (full) return `${full[1]}-${fn}${full[2] || ""}.modal.run`;
  const region = base.match(/^(https:\/\/[^/]+?)(\.[a-z0-9-]+)$/);
  if (region && !base.endsWith(".modal.run")) return `${region[1]}-${fn}${region[2]}.modal.run`;
  return `${base}-${fn}.modal.run`;
}
export const workerConfigured = () => Boolean(prefix() && process.env.MODAL_PROXY_KEY && process.env.MODAL_PROXY_SECRET);

const headers = () => ({
  "content-type": "application/json",
  "Modal-Key": process.env.MODAL_PROXY_KEY || "",
  "Modal-Secret": process.env.MODAL_PROXY_SECRET || "",
});

export async function submitJob(payload: unknown): Promise<string> {
  const res = await fetch(endpoint("submit"), { method: "POST", headers: headers(), body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`The build machine answered ${res.status}.`);
  const j = (await res.json()) as { id?: string };
  if (!j.id) throw new Error("The build machine did not return a job id.");
  return j.id;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function jobStatus(id: string): Promise<any | null> {
  const res = await fetch(`${endpoint("status")}?id=${encodeURIComponent(id)}`, { headers: headers(), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The build machine answered ${res.status}.`);
  return res.json();
}
