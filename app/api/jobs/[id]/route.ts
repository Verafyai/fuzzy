import { NextRequest, NextResponse } from "next/server";
import { CREDIT_PRODUCT_SHARED } from "@/lib/credits/config";
import { refundCredits } from "@/lib/credits/service";
import { jobStatus, workerConfigured } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/jobs/<id>: the job's status and, when done, its results. A failed job is refunded. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!workerConfigured()) return NextResponse.json({ error: "The build machine is not connected yet." }, { status: 503 });
  const { id } = await params;
  if (!/^[0-9a-f]{32}$/.test(id)) return NextResponse.json({ error: "Not a job id." }, { status: 400 });
  const job = await jobStatus(id).catch((e) => ({ status: "unknown", error: e.message }));
  if (!job) return NextResponse.json({ error: "No such job." }, { status: 404 });
  const { billing, ...rest } = job;
  if (job.status === "failed" && billing?.visitorId) {
    // Same idempotency key as the charge, so this releases it once however often it is polled.
    await refundCredits({ visitorId: billing.visitorId, amount: billing.amount, reason: "fuzzy-job-failed", source: "fuzzy", idempotencyKey: billing.idempotencyKey, product: CREDIT_PRODUCT_SHARED }).catch(() => null);
    rest.refunded = billing.amount;
  }
  return NextResponse.json(rest, { headers: { "cache-control": "no-store" } });
}
