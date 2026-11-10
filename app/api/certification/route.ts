import { NextRequest, NextResponse } from "next/server";
import * as cert from "@/src/certification.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const lookup = cert.lookupCertification as (program: string, opts: any) => Promise<any>;
const follow = cert.followSupersession as (record: string, opts: any) => Promise<any[]>;
const CORS = { "access-control-allow-origin": "*", "cache-control": "public, max-age=30" };

/**
 * GET /api/certification?program=<address>[&record=<verdict record>]
 * Is this exact build of the program Verafy Certified? Read only. Open to any agent.
 * With `record` (from an earlier receipt), also follows superseded_by to the current verdict.
 */
export async function GET(request: NextRequest) {
  const program = request.nextUrl.searchParams.get("program")?.trim() || "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(program)) {
    return NextResponse.json({ error: "Pass ?program= with a Solana program address." }, { status: 400, headers: CORS });
  }
  try {
    const rpcUrl = process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com";
    const programRpcUrl = process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
    const record = request.nextUrl.searchParams.get("record")?.trim() || "";
    if (record && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(record)) {
      return NextResponse.json({ error: "record must be a verdict record address." }, { status: 400, headers: CORS });
    }
    const [result, supersession] = await Promise.all([lookup(program, { rpcUrl, programRpcUrl }), record ? follow(record, { rpcUrl }) : null]);
    if (supersession && supersession[0]?.program !== program) {
      return NextResponse.json({ error: "That record is for a different program." }, { status: 400, headers: CORS });
    }
    return NextResponse.json({ network: "devnet", ...result, ...(supersession ? { supersession } : {}) }, { headers: CORS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lookup failed." }, { status: 502, headers: CORS });
  }
}
