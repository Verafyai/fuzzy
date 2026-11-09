import { NextRequest, NextResponse } from "next/server";
import { CREDIT_PRODUCT_SHARED } from "@/lib/credits/config";
import { chargeAction } from "@/lib/credits/charge-request";
import { refundCredits } from "@/lib/credits/service";
import { applyVisitorCookie } from "@/lib/credits/visitor-cookie";
import { HEAVY_ADDONS, SINK_CREDITS, submitJob, workerConfigured, type HeavyAddon } from "@/lib/worker";
import * as sourceAddons from "@/src/addons/source.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const verifiedSource = sourceAddons.verifiedSource as (programId: string) => Promise<any>;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * POST /api/jobs  { address, jobs: ["rebuild"|"lints"|"deep"|"property"|"review"] | ["sink"], idl? }
 * Charges credits for the jobs that can run on this program, then sends them to the build machine.
 */
export async function POST(request: NextRequest) {
  if (!workerConfigured()) return fail("The build machine is not connected yet, so these add-ons cannot run. Nothing was charged.", 503);
  const body = (await request.json().catch(() => null)) as { address?: unknown; jobs?: unknown; idl?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return fail("Pass the address of a deployed mainnet program.");
  const asked = (Array.isArray(body?.jobs) ? body!.jobs : []).map(String);
  const sink = asked.includes("sink");
  let jobs = (sink ? Object.keys(HEAVY_ADDONS) : asked).filter((j): j is HeavyAddon => j in HEAVY_ADDONS);
  if (!jobs.length) return fail("Pick at least one add-on.");

  // Source checks need a verified build. Never charge for a check that cannot run.
  let source: any = null;
  const skipped: { job: string; reason: string }[] = [];
  if (jobs.some((j) => HEAVY_ADDONS[j].needsSource)) {
    source = await verifiedSource(address).catch(() => null);
    if (!source?.verified || !source.repo || !source.commit) {
      for (const j of jobs.filter((x) => HEAVY_ADDONS[x].needsSource)) skipped.push({ job: j, reason: "No verified build of public source is on record for this program." });
      jobs = jobs.filter((j) => !HEAVY_ADDONS[j].needsSource);
    }
  }
  if (!jobs.length) return NextResponse.json({ error: "None of these add-ons can run: they need a verified build of public source, and this program has none on record. Nothing was charged.", skipped }, { status: 422 });

  const full = sink && !skipped.length;
  const amount = full ? SINK_CREDITS : jobs.reduce((s, j) => s + HEAVY_ADDONS[j].credits, 0);
  const charge = await chargeAction(request, { amount, reason: full ? "fuzzy-kitchen-sink" : `fuzzy-${jobs.join("-")}`, source: "fuzzy", product: CREDIT_PRODUCT_SHARED });
  if (!charge.charged) return charge.response;

  try {
    const id = await submitJob({
      jobs, programId: address, network: "mainnet",
      ...(source?.verified ? { repo: source.repo, commit: source.commit, path: source.path || "" } : {}),
      ...(body?.idl && typeof body.idl === "object" ? { idl: body.idl } : {}),
      billing: { visitorId: charge.visitorId, amount, idempotencyKey: charge.idempotencyKey },
    });
    const response = NextResponse.json({ id, jobs, skipped, charged: amount, balance: charge.balance });
    return applyVisitorCookie(response, request, charge.visitorId, charge.minted);
  } catch (error) {
    await refundCredits({ visitorId: charge.visitorId, amount, reason: "fuzzy-job-submit-failed", source: "fuzzy", idempotencyKey: charge.idempotencyKey, product: CREDIT_PRODUCT_SHARED });
    return fail(`${error instanceof Error ? error.message : "The build machine could not take the job."} Your ${amount} credits were returned.`, 502);
  }
}

/** GET /api/jobs: whether the build machine is connected. */
export function GET() {
  return NextResponse.json({ configured: workerConfigured() }, { headers: { "cache-control": "no-store" } });
}
