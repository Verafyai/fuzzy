import { NextResponse } from "next/server";
import { creditsUseMock } from "@/lib/credits/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tells the browser whether to stay on the local ledger. */
export async function GET() {
  return NextResponse.json(
    { mocked: creditsUseMock() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
