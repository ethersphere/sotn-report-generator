const fs         = require('fs');
const path       = require('path');
const JSONStream = require('jsonstream');
const Table      = require('cli-table3');

const ROOT_DIR            = path.resolve(__dirname, '..');
const COMMITTED_EVENTS    = path.join(ROOT_DIR, 'swarmscan', 'committed-events.json');

/**
 * Analyse committed-events.json and return active staking node counts by country
 * for the given month.
 *
 * @param {number} year
 * @param {number} month  1-based
 * @returns {Promise<{ totalActiveStaking, byCountry: Array<{country, count}>, warnings }>}
 */
function analyzeCommits(year, month) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(COMMITTED_EVENTS)) {
      return reject(new Error(`committed-events.json not found at ${COMMITTED_EVENTS}`));
    }

    const monthStart = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
    const monthEnd   = Date.UTC(year, month, 0, 23, 59, 59, 999);

    const countryToSenders = new Map();
    let totalUniqueSenders = 0;
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
          : 'Unknown';

        if (!countryToSenders.has(country)) countryToSenders.set(country, new Set());
        const set = countryToSenders.get(country);
        if (!set.has(txSender)) { set.add(txSender); totalUniqueSenders++; }
      })
      .on('end', () => {
        const byCountry = Array.from(countryToSenders.entries())
          .map(([country, set]) => ({ country, count: set.size }))
          .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));

        resolve({ totalActiveStaking: totalUniqueSenders, byCountry, warnings });
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
  console.log(`Warnings (missing txSender): ${result.warnings}`);
}

if (require.main === module) {
  main().catch(err => { console.error('Error:', err.message); process.exit(1); });
}

module.exports = { analyzeCommits };
