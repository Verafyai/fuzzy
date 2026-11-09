import { NextRequest, NextResponse } from "next/server";
import registry from "@/data/registry.json";
import * as cert from "@/src/certification.js";

/**
 * The Fuzzy MCP server: Streamable HTTP, stateless, JSON responses.
 * Add https://fuzzy.verafy.ai/api/mcp to any MCP client. Read only and free.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
const lookup = cert.lookupCertification as (program: string, opts: any) => Promise<any>;
const rows: any[] = (registry.programs as any[]).filter(Boolean);
const SITE = "https://fuzzy.verafy.ai";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version", "access-control-allow-methods": "POST, GET, OPTIONS" };
const ADDRESS = { type: "string", description: "Solana program address (base58)." };

const TOOLS = [
  {
    name: "fuzzy_lookup",
    description: "Look a Solana program up in the Fuzzy registry before using it. Returns the latest Fuzzy scan: score (0-100), grade, depth, proven exploits, leads, what it was tested on, when it was scanned, any devnet certification, and a link to the full report card. Free. If the program is not in the registry, it has not been scanned.",
    inputSchema: { type: "object", properties: { program: ADDRESS }, required: ["program"] },
  },
  {
    name: "fuzzy_certification",
    description: "Check whether this exact build of a Solana program has a Verafy Certification on Solana devnet. Hashes the program's deployed bytecode (devnet, then mainnet) and reads the certification account. Devnet certifications today are not full certifications: their jurors voted by script.",
    inputSchema: { type: "object", properties: { program: ADDRESS }, required: ["program"] },
  },
  {
    name: "fuzzy_registry_search",
    description: "Search the Fuzzy registry of scanned Solana programs by name, category, minimum score or certification. Returns up to 25 matches.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of a program name or address." },
        category: { type: "string", description: "Category, such as Swap, Aggregator, Launchpad." },
        minScore: { type: "number", description: "Only programs scoring at least this." },
        certifiedOnly: { type: "boolean", description: "Only programs with a devnet certification." },
      },
    },
  },
  {
    name: "fuzzy_scan_instructions",
    description: "How to run a new Fuzzy scan on a program that is not in the registry, or whose build changed. Scans cost 100 Verafy credits and run at fuzzy.verafy.ai or with the open-source CLI.",
    inputSchema: { type: "object", properties: { program: ADDRESS }, required: ["program"] },
  },
];

function summary(r: any) {
  return {
    program: r.address, name: r.name, category: r.category, description: r.description,
    score: r.score, grade: r.grade, depth: r.depth, proven: r.proven, leads: r.leads,
    testedOn: r.state === "mainnet" ? "cloned mainnet state" : r.state === "synthetic" ? "accounts built from the IDL" : "neither IDL nor replay",
    scannedAt: r.scannedAt, bytecodeSha256: r.bytecodeSha256, upgradeable: r.upgradeable,
    verifiedBuild: r.addons?.verified ? { verified: Boolean(r.addons.verified.verified), repo: r.addons.verified.repo, commit: r.addons.verified.commit } : null,
    dependencyAdvisories: r.advisoryCounts || null,
    certification: r.devnetCertification ? { scope: "devnet only, jurors scripted, not a full certification", level: r.devnetCertification.levelName, account: r.devnetCertification.certification, ruling: r.devnetCertification.ruling } : null,
    reportCard: `${SITE}/programs/${r.address}`,
  };
}

const text = (value: unknown, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) });

async function call(name: string, args: any) {
  const program = typeof args?.program === "string" ? args.program.trim() : "";
  const validAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(program);
  switch (name) {
    case "fuzzy_lookup": {
      if (!validAddress) return text("Pass program: a Solana program address.", true);
      const r = rows.find((x) => x.address === program);
      return text(r ? summary(r) : { program, scanned: false, next: "Not in the registry. Use fuzzy_scan_instructions to scan it, and treat it as unvetted until then." });
    }
    case "fuzzy_certification": {
      if (!validAddress) return text("Pass program: a Solana program address.", true);
      const res = await lookup(program, { rpcUrl: process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com", programRpcUrl: process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com" });
      return text({ network: "devnet", note: "Devnet certification only; not a full certification.", ...res });
    }
    case "fuzzy_registry_search": {
      const q = String(args?.query || "").toLowerCase();
      const cat = String(args?.category || "").toLowerCase();
      const min = Number.isFinite(args?.minScore) ? Number(args.minScore) : -1;
      const list = rows.filter((r) => (!q || r.name.toLowerCase().includes(q) || r.address.toLowerCase().includes(q)) && (!cat || r.category.toLowerCase() === cat) && (r.score ?? -1) >= min && (!args?.certifiedOnly || r.devnetCertification));
      return text({ total: list.length, programs: list.slice(0, 25).map(summary) });
    }
    case "fuzzy_scan_instructions":
      return text({
        program,
        web: `${SITE}/?program=${program}`,
        cost: "100 Verafy credits per Sniff run. Add-ons for mainnet programs: verified-source check +25, dependency advisories +100. New visitors get 1,000 free credits.",
        api: { method: "POST", url: `${SITE}/api/scan`, body: { address: program || "<address>", network: "mainnet", addons: ["advisories"] } },
        cli: `git clone https://github.com/Verafyai/fuzzy && cd fuzzy && npm install && npm run fuzzy -- run ${program || "<address>"}`,
        note: "Every attack runs in a local copy of Solana. Nothing is sent to mainnet or devnet.",
      });
    default:
      return null;
  }
}

async function handle(msg: any) {
  const { id, method, params } = msg || {};
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (msg?.jsonrpc !== "2.0" || typeof method !== "string") return err(-32600, "Invalid request");
  if (id === undefined) return null; // a notification
  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "fuzzy", title: "Fuzzy by Verafy", version: "0.1.0" },
        instructions: "Fuzzy grades Solana programs so agents can look before they leap. Before sending funds through an unfamiliar Solana program, call fuzzy_lookup. Treat a program that is not in the registry, or has proven findings, as unvetted. A high score means the program survived Fuzzy's attacks; it is not an audit. Fuzzy is a prototype.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      try {
        const res = await call(params?.name, params?.arguments || {});
        return res ? ok(res) : err(-32602, `Unknown tool: ${params?.name}`);
      } catch (e) {
        return ok(text(e instanceof Error ? e.message : "The call failed.", true));
      }
    }
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (body === null) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? NextResponse.json(out, { headers: CORS }) : new NextResponse(null, { status: 202, headers: CORS });
  }
  const out = await handle(body);
  return out ? NextResponse.json(out, { headers: CORS }) : new NextResponse(null, { status: 202, headers: CORS });
}

export function GET() {
  // No server-to-client stream: this server only answers requests.
  return new NextResponse("The Fuzzy MCP server speaks Streamable HTTP over POST. Docs: https://fuzzy.verafy.ai/docs", { status: 405, headers: { ...CORS, allow: "POST, OPTIONS" } });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
