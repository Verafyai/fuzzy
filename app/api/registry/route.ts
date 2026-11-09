import { NextRequest, NextResponse } from "next/server";
import registry from "@/data/registry.json";

export const dynamic = "force-dynamic";

const CORS = { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" };

/** The registry of scanned programs. ?program=<address> returns one row. */
export function GET(request: NextRequest) {
  const program = request.nextUrl.searchParams.get("program")?.trim();
  const rows = registry.programs.filter(Boolean);
  if (!program) return NextResponse.json({ kind: registry.kind, engine: registry.engine, generatedAt: registry.generatedAt, source: registry.source, programs: rows }, { headers: CORS });
  const row = rows.find((r) => r.address === program);
  if (!row) return NextResponse.json({ program, scanned: false, reason: "Fuzzy has not scanned this program yet. Run a scan at https://fuzzy.verafy.ai." }, { status: 404, headers: CORS });
  return NextResponse.json({ program, scanned: row.status === "scanned", ...row }, { headers: CORS });
}
