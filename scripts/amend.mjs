// Propose an amendment to Fuzzy's charter and build the contract a Verafy jury
// rules on (VIP-0035). Run the contract with the harness (verafy_run, or
// `npx verafy run`) to get the ruling.
//
//   HARNESS_DIR=../verafyHarness node scripts/amend.mjs governance/proposals/0001-example.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HARNESS = process.env.HARNESS_DIR || '../verafyHarness';
const core = await import(join(process.cwd(), HARNESS, 'packages/core/src/index.js'));
const charter = JSON.parse(readFileSync('governance/charter.json', 'utf8'));
const proposal = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const amendment = { kind: core.CHARTER_AMENDMENT_KIND, charter: core.charterHash(charter), ...proposal };
const problems = [...core.validateCharter(charter), ...core.validateCharterAmendment(charter, amendment)];
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
const contract = core.charterAmendmentContract(charter, amendment);
const out = process.argv[2].replace(/\.json$/, '.contract.json');
writeFileSync(out, JSON.stringify(contract, null, 2) + '\n');
console.log(`Charter v${charter.version} (${core.charterHash(charter).slice(0, 12)}). Contract ${core.ascHash(contract).slice(0, 12)} written to ${out}.`);
console.log('If the jury rules ADOPT, apply it with applyCharterAmendment and commit the new governance/charter.json.');
