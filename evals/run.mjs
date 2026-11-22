// The suggestion evals (spec requirement 24): plain Node, no dependencies, run on demand.
//
//   pnpm eval -- --api http://localhost:3000
//
// It calls the running API's POST /purchase-requests/suggestion once per case, as the
// case's seeded user, in sequence. It costs tokens only when that API was started with
// LLM_PROVIDER=anthropic (`pnpm dev:llm`): ask Chris before every such run.
// It reports the pass rate and exits 0 whatever the rate; 1 only when it can't run.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** The seeded users and suppliers (db/seed.sql). Cases name suppliers; ids are compared. */
const USERS = {
  alice: 'a0000000-0000-4000-8000-000000000101',
  bella: 'b0000000-0000-4000-8000-000000000101',
};
const SUPPLIERS = {
  'Bright Office Supplies': 'a0000000-0000-4000-8000-000000000201',
  'Nordic Laptops': 'a0000000-0000-4000-8000-000000000202',
  'Harbor Print Co': 'b0000000-0000-4000-8000-000000000201',
  'Summit IT Hardware': 'b0000000-0000-4000-8000-000000000202',
};
const NAME_OF_SUPPLIER = Object.fromEntries(Object.entries(SUPPLIERS).map(([n, id]) => [id, n]));
const FIELDS = ['title', 'category', 'quantity', 'amountCents', 'currency', 'supplierId'];

// pnpm 10 passes `pnpm eval -- --api x` through as ["--", "--api", "x"].
const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();
const { values } = parseArgs({
  args: argv,
  options: {
    api: { type: 'string', default: `http://localhost:${process.env.API_PORT ?? 3000}` },
    cases: { type: 'string', default: fileURLToPath(new URL('./cases.json', import.meta.url)) },
  },
});
const api = values.api.replace(/\/+$/, '');

const cases = loadCases(values.cases);
console.log(`${cases.length} cases against ${api}`);

let passed = 0;
for (const [i, c] of cases.entries()) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(`${api}/purchase-requests/suggestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': USERS[c.user] },
      body: JSON.stringify({ description: c.description }),
    });
  } catch (err) {
    if (i === 0) stop(`cannot reach the API at ${api} (${reason(err)})`);
    console.log(`FAIL ${c.name}: request failed (${reason(err)})`);
    continue;
  }
  const ms = Math.round(performance.now() - started);
  const body = await res.json().catch(() => null);
  const problems = res.ok ? compare(c.expected, body?.suggestion) : [`status ${res.status}`];
  if (problems.length === 0) {
    passed += 1;
    console.log(`PASS ${c.name} (${ms} ms)`);
  } else {
    console.log(`FAIL ${c.name} (${ms} ms): ${problems.join('; ')}`);
  }
}

const pct = Math.round((passed / cases.length) * 100);
console.log(`pass rate: ${passed}/${cases.length} (${pct}%)`);

/** Every expected field must equal the suggestion's; a null suggestion fails the case. */
function compare(expected, suggestion) {
  if (suggestion === null || typeof suggestion !== 'object') return ['no suggestion'];
  const problems = [];
  for (const [field, want] of Object.entries(expected)) {
    const got = suggestion[field];
    if (got !== want)
      problems.push(`${field} expected ${show(field, want)} got ${show(field, got)}`);
  }
  return problems;
}

/** Ids shown as the seeded supplier's name; anything else as JSON. */
function show(field, value) {
  if (field === 'supplierId' && NAME_OF_SUPPLIER[value]) return `"${NAME_OF_SUPPLIER[value]}"`;
  return JSON.stringify(value);
}

/** Reads and checks the case file, and turns supplier names into their seeded ids. */
function loadCases(path) {
  let list;
  try {
    list = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    stop(`cannot read the cases at ${path}: ${err.message}`);
  }
  if (!Array.isArray(list) || list.length < 12 || list.length > 20) {
    stop('cases.json must hold 12 to 20 cases');
  }
  return list.map((c, i) => {
    const where = `case ${i + 1} (${c?.name ?? 'no name'})`;
    if (typeof c?.name !== 'string' || typeof c.description !== 'string') {
      stop(`${where}: needs a name and a description`);
    }
    if (!(c.user in USERS)) stop(`${where}: user must be alice or bella`);
    const expected = { ...c.expected };
    for (const field of Object.keys(expected)) {
      if (!FIELDS.includes(field)) stop(`${where}: unknown field ${field}`);
    }
    if (typeof expected.supplierId === 'string') {
      const id = SUPPLIERS[expected.supplierId];
      if (!id) stop(`${where}: unknown supplier ${expected.supplierId}`);
      expected.supplierId = id;
    }
    return { ...c, expected };
  });
}

function stop(message) {
  console.error(message);
  process.exit(1);
}

/** Why a fetch failed, without the request: `ECONNREFUSED`, or fetch's own `bad port`. */
function reason(err) {
  const cause = err?.cause;
  return cause?.code ?? cause?.errors?.[0]?.code ?? cause?.message ?? err?.name ?? 'error';
}
