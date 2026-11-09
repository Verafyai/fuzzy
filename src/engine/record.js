// Records each program invocation's inputs, so a Deep Fuzz run can trace them afterwards
// for coverage. Off unless a recorder is set. Inputs use agave-ledger-tool's program-run format.
let recorder = null;
export function setRecorder(fn) { recorder = fn; }

/** Called just before an instruction is sent: the program, its account metas and data. */
export function recordInvocation(svm, programId, metas, data) {
  if (!recorder) return;
  const accounts = metas.map((m) => {
    const a = svm.getAccount(m.address);
    const isSigner = m.role === 2 || m.role === 3; // READONLY_SIGNER, WRITABLE_SIGNER
    const isWritable = m.role === 1 || m.role === 3;
    return {
      key: m.address,
      owner: a.exists ? a.programAddress : '11111111111111111111111111111111',
      is_signer: isSigner,
      is_writable: isWritable,
      lamports: a.exists ? Number(a.lamports) : 0,
      data: a.exists ? Array.from(a.data) : [],
    };
  });
  recorder({ program_id: programId, accounts, instruction_data: Array.from(data) });
}
