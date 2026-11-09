import { NextRequest, NextResponse } from "next/server";
import { CREDIT_COSTS, CREDIT_PRODUCT_SHARED } from "@/lib/credits/config";
import { chargeAction } from "@/lib/credits/charge-request";
import { creditsMockForced, creditsUseMock } from "@/lib/credits/config";
import { refundCredits } from "@/lib/credits/service";
import { applyVisitorCookie } from "@/lib/credits/visitor-cookie";
// The engine is plain ESM JavaScript, shared with the CLI.
import * as engineRun from "@/src/engine/run.js";
import * as engineIngest from "@/src/engine/ingest.js";
import * as engineIdl from "@/src/engine/idl.js";
import * as sourceAddons from "@/src/addons/source.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const fuzz = engineRun.fuzz as (opts: any) => Promise<any>;
const fetchProgram = engineIngest.fetchProgram as (address: string, opts: any) => Promise<any>;
const elfInfo = engineIngest.elfInfo as (bytes: Uint8Array) => unknown;
const readIdl = engineIdl.readIdl as (idl: unknown) => unknown;
const runSourceAddons = sourceAddons.runSourceAddons as (programId: string, addons: string[]) => Promise<any>;
const addonCredits = sourceAddons.addonCredits as (addons: string[]) => number;
const KNOWN_ADDONS = new Set(["verified", "advisories"]);
const pickAddons = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter((x) => KNOWN_ADDONS.has(x));

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PROGRAM_BYTES = 4 * 1024 * 1024;
const MAX_IDL_BYTES = 512 * 1024;

type Input = { program: Uint8Array; idl: unknown; source: Record<string, unknown>; name?: string; addons: string[] };

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Read and check the program before any credits are spent. */
async function readInput(request: NextRequest): Promise<Input | NextResponse> {
  const type = request.headers.get("content-type") || "";
  let idl: unknown = null;
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("program");
    if (!(file instanceof File)) return fail("Add a compiled program (.so file).");
    if (file.size > MAX_PROGRAM_BYTES) return fail("That program is over 4 MB. Paste its address instead.");
    const program = new Uint8Array(await file.arrayBuffer());
    const idlFile = form.get("idl");
    if (idlFile instanceof File && idlFile.size > 0) {
      if (idlFile.size > MAX_IDL_BYTES) return fail("That IDL is over 512 KB.");
      try {
        idl = JSON.parse(await idlFile.text());
      } catch {
        return fail("The IDL is not valid JSON.");
      }
    }
    // Source add-ons need a deployed program to look up; uploads get the Sniff run only.
    return { program, idl, source: { file: file.name.slice(0, 80) }, name: file.name.replace(/\.so$/i, "").slice(0, 60), addons: [] };
  }
  const body = (await request.json().catch(() => null)) as { address?: unknown; network?: unknown; addons?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const network = body?.network === "devnet" ? "devnet" : "mainnet";
  if (!address) return fail("Paste a program address or drop a .so file.");
  try {
    const got = await fetchProgram(address, { network, rpcUrl: network === "mainnet" ? process.env.MAINNET_RPC_URL : process.env.DEVNET_RPC_URL });
    return {
      program: got.program,
      idl: got.idl,
      source: { address, network, upgradeable: got.upgradeable, upgradeAuthority: got.upgradeAuthority },
      // Verification records exist for mainnet deployments only.
      addons: network === "mainnet" ? pickAddons(body?.addons) : [],
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not fetch that program.");
  }
}

export async function POST(request: NextRequest) {
  // A production deploy without the credits secret must not fall back to the mock ledger,
  // which would make scans free and disagree with the balance in the header.
  const mock = creditsUseMock();
  if (mock && process.env.VERCEL_ENV === "production" && !creditsMockForced()) {
    return NextResponse.json({ error: "Credits are not configured on this deploy yet, so scans are paused." }, { status: 503 });
  }
  const input = await readInput(request);
  if (input instanceof NextResponse) return input;
  try {
    elfInfo(input.program);
    if (input.idl) readIdl(input.idl);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "That file could not be read.");
  }

  const amount = CREDIT_COSTS.fuzzySniff + addonCredits(input.addons);
  const charge = await chargeAction(request, { amount, reason: "fuzzy-sniff", source: "fuzzy", product: CREDIT_PRODUCT_SHARED });
  if (!charge.charged) return charge.response;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: unknown) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      emit({ type: "charged", credits: amount, balance: charge.balance, ...(mock ? { mock: true } : {}) });
      try {
        const report = await fuzz({
          program: input.program,
          idl: input.idl,
          name: input.name,
          source: input.source,
          tier: "sniff",
          onEvent: (event: { type: string }) => emit(event),
        });
        report.seed = report.program.sha256.slice(0, 16);
        if (input.addons.length) {
          emit({ type: "note", text: "Running add-ons: verified source and dependency advisories." });
          report.addons = await runSourceAddons(String(input.source.address), input.addons);
        }
        emit({ type: "report", report: mock ? { ...report, mock: true } : report });
      } catch (error) {
        await refundCredits({ visitorId: charge.visitorId, amount, reason: "fuzzy-sniff-failed", source: "fuzzy", idempotencyKey: charge.idempotencyKey, product: CREDIT_PRODUCT_SHARED });
        emit({ type: "error", message: `The run failed and your ${amount} credits were returned. ${error instanceof Error ? error.message : ""}`.trim() });
      }
      controller.close();
    },
  });
  const response = new NextResponse(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
  return applyVisitorCookie(response, request, charge.visitorId, charge.minted);
}
