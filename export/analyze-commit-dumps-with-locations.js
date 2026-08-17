const fs         = require('fs');
const path       = require('path');
const JSONStream = require('jsonstream');
const Table      = require('cli-table3');

const ROOT_DIR            = path.resolve(__dirname, '..');
const COMMITTED_EVENTS    = path.join(ROOT_DIR, 'swarmscan', 'committed-events.json');
const DUMPS_DIR           = path.join(ROOT_DIR, 'network', 'dumps');

/**
 * Build an `ethereumAddress -> country` index from the month's topology dumps.
 *
 * The committed-events dump does not always carry a location for a node, and the
 * proportion that is missing varies with upstream enrichment. The daily topology
 * dumps cover the same nodes and are keyed by the same Ethereum address, so they
 * serve as a fallback: a node is resolved if *any* day of the month located it.
 * Returns an empty Map if the dumps are absent, in which case callers simply get
 * whatever the events dump provided.
 *
 * @param {number} year
 * @param {number} month  1-based
 * @returns {Map<string, string>} lowercased eth address -> country
 */
function buildLocationFallback(year, month) {
  const idx = new Map();
  const folder = path.join(DUMPS_DIR, String(year), String(month).padStart(2, '0'));
  if (!fs.existsSync(folder)) return idx;

  for (const file of fs.readdirSync(folder).filter(f => path.extname(f) === '.json')) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
    } catch {
      continue; // a malformed daily dump should not sink the whole month
    }
    if (!Array.isArray(data?.nodes)) continue;

    for (const node of data.nodes) {
      const eth = (node?.ethereumAddress || '').toLowerCase();
      if (!eth) continue;
      const raw = node?.location?.country;
      const country = (typeof raw === 'string' && raw.trim().length) ? raw.trim() : null;
      if (!country) continue;
      if (!idx.has(eth)) idx.set(eth, country);
    }
  }
  return idx;
}

/**
 * Analyse committed-events.json and return active staking node counts by country
 * for the given month.
 *
 * Each unique txSender is counted exactly once, and is attributed to a single
 * country: the location carried on its own commit events where present, and
 * otherwise the location for the same address in the topology dumps.
 *
 * @param {number} year
 * @param {number} month  1-based
 * @returns {Promise<{ totalActiveStaking, byCountry, warnings, resolvedFromDumps, unresolved }>}
 */
function analyzeCommits(year, month) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(COMMITTED_EVENTS)) {
      return reject(new Error(`committed-events.json not found at ${COMMITTED_EVENTS}`));
    }

    const monthStart = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
    const monthEnd   = Date.UTC(year, month, 0, 23, 59, 59, 999);

    const fallback = buildLocationFallback(year, month);
    const senderCountry = new Map(); // txSender -> country | null
    let warnings = 0;

    fs.createReadStream(COMMITTED_EVENTS)
      .pipe(JSONStream.parse('events.*'))
      .on('data', event => {
        if (!event?.blockTime) return;
        const ts = Date.parse(event.blockTime);
        if (isNaN(ts) || ts < monthStart || ts > monthEnd) return;

        const txSender = event?.txSender;
        if (!txSender) { warnings++; return; }

        const countryRaw = event?.node?.location?.country;
        const country = (typeof countryRaw === 'string' && countryRaw.trim().length)
          ? countryRaw.trim()
          : null;

        // Record the sender once; a located event always wins over an unlocated one,
        // so a sender can never be counted under two different countries.
        if (country) senderCountry.set(txSender, country);
        else if (!senderCountry.has(txSender)) senderCountry.set(txSender, null);
      })
      .on('end', () => {
        const counts = new Map();
        let resolvedFromDumps = 0;
        let unresolved = 0;

        for (const [txSender, country] of senderCountry) {
          let final = country;
          if (!final) {
            final = fallback.get(txSender.toLowerCase()) || null;
            if (final) resolvedFromDumps++;
            else { final = 'Unknown'; unresolved++; }
          }
          counts.set(final, (counts.get(final) || 0) + 1);
        }

        const byCountry = Array.from(counts.entries())
          .map(([country, count]) => ({ country, count }))
          .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));

        resolve({
          totalActiveStaking: senderCountry.size,
          byCountry,
          warnings,
          resolvedFromDumps,
          unresolved,
        });
      })
      .on('error', reject);
  });
}

// ─── standalone CLI entry point ───────────────────────────────────────────────

async function main() {
  const readline = require('readline');
  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));

  const yearInput  = await ask('Enter the year (e.g., 2024): ');
  const monthInput = await ask('Enter the month (1-12): ');
  rl.close();

  const year  = parseInt(yearInput,  10);
  const month = parseInt(monthInput, 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    console.error('Invalid year/month input.');
    process.exit(1);
  }

  const result = await analyzeCommits(year, month);

  const table = new Table({ head: ['Country', 'Unique commit txSenders'], colWidths: [30, 26] });
  for (const { country, count } of result.byCountry) table.push([country, count]);

  console.log('\nCommit txSenders by country (unique senders in month)');
  console.log('----------------------------------------------------');
  console.log(table.toString());
  console.log(`\nTotal unique commit txSenders: ${result.totalActiveStaking}`);
  console.log(`Located via topology dumps:    ${result.resolvedFromDumps}`);
  console.log(`Unresolved (no location):      ${result.unresolved}`);
  console.log(`Warnings (missing txSender): ${result.warnings}`);
}

if (require.main === module) {
  main().catch(err => { console.error('Error:', err.message); process.exit(1); });
}

module.exports = { analyzeCommits };
