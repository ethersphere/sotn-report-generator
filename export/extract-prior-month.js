#!/usr/bin/env node
/**
 * extract-prior-month.js
 *
 * Fetches the prior month's SOTN article from GitHub and extracts the last 5
 * data rows from each of the 7 metric tables, returning structured JSON.
 *
 * Usage (standalone):
 *   node extract-prior-month.js <year> <month>
 *   e.g.  node extract-prior-month.js 2026 2   → fetches January 2026 article
 *
 * Exported:
 *   extractPriorMonth(year, month) → Promise<PriorMonthData>
 *
 * PriorMonthData shape:
 * {
 *   priorMonthName: string,          // e.g. "January"
 *   priorYear: number,
 *   tables: {
 *     totalRewards:        Array<{month, value}>,  // last 5 rows
 *     medianWin:           Array<{month, value}>,
 *     avgWin:              Array<{month, value}>,
 *     avgEarningsPerNode:  Array<{month, value}>,
 *     activeStakingNodes:  Array<{month, value}>,
 *     reachableFullNodes:  Array<{month, value}>,
 *     winningNodes:        Array<{month, value}>,
 *   }
 * }
 */

const https = require('https');

const MONTH_NAMES = [
  'january','february','march','april','may','june',
  'july','august','september','october','november','december',
];

const BASE_URL = 'https://raw.githubusercontent.com/ethersphere/ethswarm-blog-hugo/main/content/foundation/posts';

function priorMonthOf(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

/**
 * Parse a markdown table section. Returns array of {month, value} objects,
 * one per data row (skips header and separator rows).
 * Strips bold markers (**) and commas from values.
 */
function parseTable(lines) {
  const rows = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    // Skip header row (contains non-numeric second cell) and separator rows
    if (cells[1].includes('---') || cells[1].includes('===')) continue;
    const rawValue = cells[1].replace(/\*\*/g, '').replace(/,/g, '').trim();
    const num = parseFloat(rawValue);
    if (isNaN(num)) continue; // header row
    rows.push({ month: cells[0].replace(/\*\*/g, '').trim(), value: num });
  }
  return rows;
}

/**
 * Given article markdown, find a section by heading keyword and return its
 * last N data rows.
 */
function extractTable(markdown, headingKeyword, lastN = 5) {
  const lines = markdown.split('\n');
  let inSection = false;
  const tableLines = [];

  for (const line of lines) {
    if (/^##\s/.test(line)) {
      if (inSection) break; // end of our section
      if (line.toLowerCase().includes(headingKeyword.toLowerCase())) {
        inSection = true;
      }
      continue;
    }
    if (inSection) tableLines.push(line);
  }

  const rows = parseTable(tableLines);
  return rows.slice(-lastN);
}

async function extractPriorMonth(year, month) {
  const { year: priorYear, month: priorMonth } = priorMonthOf(year, month);
  const priorMonthName = MONTH_NAMES[priorMonth - 1];
  const filename = `swarm-state-of-the-network-${priorMonthName}-${priorYear}.md`;
  const url = `${BASE_URL}/${filename}`;

  process.stderr.write(`Fetching ${url}\n`);
  const markdown = await fetchUrl(url);

  return {
    priorMonthName: priorMonthName.charAt(0).toUpperCase() + priorMonthName.slice(1),
    priorYear,
    url,
    tables: {
      totalRewards:       extractTable(markdown, 'Network Total Monthly Rewards'),
      medianWin:          extractTable(markdown, 'Monthly Median Win Values'),
      avgWin:             extractTable(markdown, 'Monthly Average Win Values'),
      avgEarningsPerNode: extractTable(markdown, 'Active Staking Node Monthly Average Earnings'),
      activeStakingNodes: extractTable(markdown, 'Total Active Staking Nodes by Month'),
      reachableFullNodes: extractTable(markdown, 'Total Reachable Full Nodes'),
      winningNodes:       extractTable(markdown, 'Total Winning Nodes by Month'),
    },
  };
}

// ─── standalone CLI ───────────────────────────────────────────────────────────

if (require.main === module) {
  const [,, yearArg, monthArg] = process.argv;
  if (!yearArg || !monthArg) {
    console.error('Usage: node extract-prior-month.js <year> <month>');
    console.error('  e.g. node extract-prior-month.js 2026 2   (fetches January 2026 article)');
    process.exit(1);
  }
  extractPriorMonth(parseInt(yearArg, 10), parseInt(monthArg, 10))
    .then(data => {
      console.log(JSON.stringify(data, null, 2));
      process.exit(0);
    })
    .catch(err => { console.error('Error:', err.message); process.exit(1); });
}

module.exports = { extractPriorMonth };
