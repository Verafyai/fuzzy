"""Fuzzy build machine on Modal.

Runs the add-ons a web request cannot: rebuild from source, static lints, Deep Fuzz with branch
coverage, property fuzzing and the AI design review. Each job runs in its own container with
Node 22, the Rust toolchain, the Agave tools and cargo-dylint.

Endpoints (both behind Modal proxy auth: send the `Modal-Key` and `Modal-Secret` headers of a
proxy auth token created in the Modal dashboard):
  POST submit   body: the run-job input            -> {"id": "..."}
  GET  status   ?id=...                            -> {"status": "queued|running|done|failed", "result": {...}}

Secrets (Modal secret "fuzzy-worker"): OPENROUTER_API_KEY (for the AI design review) and MAINNET_RPC_URL, both optional.
Deploy: `modal deploy worker/modal_app.py` (the GitHub workflow does this on push to main).
"""
import json
import os
import subprocess
import time
import uuid

import modal

AGAVE = "2.1.21"
PATH = "/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "curl", "ca-certificates", "build-essential", "pkg-config", "libssl-dev", "libudev-dev", "bzip2", "procps")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs",
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable",
        f'sh -c "$(curl -sSfL https://release.anza.xyz/v{AGAVE}/install)"',
        # Trail of Bits solana-lints pin dylint 3.4 and a 2025-01 nightly.
        "/root/.cargo/bin/cargo install --locked cargo-dylint@3.4.1 dylint-link@3.4.1",
        "/root/.cargo/bin/rustup toolchain install nightly-2025-01-09 --component llvm-tools-preview rustc-dev",
        # Trail of Bits lints, cloned once and built once on a scratch crate so jobs start warm.
        "git clone --depth 1 https://github.com/crytic/solana-lints /opt/solana-lints",
        "cd /tmp && /root/.cargo/bin/cargo new -q --lib warm && cd warm && PATH=/root/.cargo/bin:$PATH cargo dylint --path /opt/solana-lints --pattern 'lints/*' --all || true",
        # A genesis ledger for agave-ledger-tool program run (branch coverage).
        f"export PATH={PATH} && (solana-test-validator --ledger /opt/ledger --quiet --reset & sleep 30; pkill -f solana-test-validator; sleep 2) || true",
    )
    .pip_install("fastapi[standard]")
    .env({"PATH": PATH, "FUZZY_LEDGER": "/opt/ledger", "AGAVE_LEDGER_TOOL": "agave-ledger-tool", "FUZZY_BUILD_SBF": "cargo-build-sbf", "FUZZY_SOLANA_LINTS": "/opt/solana-lints"})
    .add_local_dir(".", "/app", copy=True, ignore=["node_modules", ".next", ".git", "programs/target", "reports", "design", "brand", "public", "app", "components", "content"])
    .run_commands("cd /app && npm ci --omit=dev --ignore-scripts")
)

app = modal.App("fuzzy-worker", image=image)
jobs = modal.Dict.from_name("fuzzy-jobs", create_if_missing=True)
secret = modal.Secret.from_name("fuzzy-worker")


@app.function(cpu=4.0, memory=8192, timeout=3600, secrets=[secret])
def run_job(job_id: str, payload: dict):
    jobs[job_id] = {**jobs.get(job_id, {}), "status": "running", "startedAt": time.time()}
    if os.environ.get("MAINNET_RPC_URL") and not payload.get("rpcUrl") and payload.get("network", "mainnet") == "mainnet":
        payload["rpcUrl"] = os.environ["MAINNET_RPC_URL"]
    try:
        p = subprocess.run(["node", "/app/worker/run-job.mjs", json.dumps(payload)], capture_output=True, text=True, timeout=3400, cwd="/app")
        if p.returncode != 0:
            raise RuntimeError((p.stderr or "")[-1500:])
        jobs[job_id] = {**jobs.get(job_id, {}), "status": "done", "finishedAt": time.time(), "result": json.loads(p.stdout)}
    except Exception as e:  # report, never crash silently
        jobs[job_id] = {**jobs.get(job_id, {}), "status": "failed", "finishedAt": time.time(), "error": str(e)[-1500:]}


@app.function(secrets=[secret])
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
def submit(body: dict):
    job_id = uuid.uuid4().hex
    billing = body.pop("billing", None)  # who to refund if the job fails; read only by Fuzzy's server
    jobs[job_id] = {"status": "queued", "createdAt": time.time(), "jobs": body.get("jobs", []), "programId": body.get("programId"), "billing": billing}
    run_job.spawn(job_id, body)
    return {"id": job_id}


@app.function(secrets=[secret])
@modal.fastapi_endpoint(method="GET", requires_proxy_auth=True)
def status(id: str):
    from fastapi import HTTPException

    j = jobs.get(id)
    if j is None:
        raise HTTPException(status_code=404, detail="no such job")
    return j
