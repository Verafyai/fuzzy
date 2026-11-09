import { NextRequest, NextResponse } from "next/server";
import * as cert from "@/src/certification.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const lookup = cert.lookupCertification as (program: string, opts: any) => Promise<any>;
const CORS = { "access-control-allow-origin": "*", "cache-control": "public, max-age=30" };

/**
 * GET /api/certification?program=<address>
 * Is this exact build of the program Verafy Certified? Read only. Open to any agent.
 */
export async function GET(request: NextRequest) {
  const program = request.nextUrl.searchParams.get("program")?.trim() || "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(program)) {
    return NextResponse.json({ error: "Pass ?program= with a Solana program address." }, { status: 400, headers: CORS });
  }
  try {
    const rpcUrl = process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com";
    return NextResponse.json({ network: "devnet", ...(await lookup(program, { rpcUrl })) }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lookup failed." }, { status: 502, headers: CORS });
  }
}
