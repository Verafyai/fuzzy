import { NextRequest, NextResponse } from "next/server";
import { readCreditProduct } from "@/lib/credits/config";
import { loadPacks } from "@/lib/credits/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const product = readCreditProduct(request.nextUrl.searchParams.get("product"));
  const packs = await loadPacks(product);
  return NextResponse.json(packs, { headers: { "Cache-Control": "no-store" } });
}
