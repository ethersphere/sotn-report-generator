const fs = require('fs');
const path = require('path');

const DUMPS_ROOT = path.resolve(__dirname, '..', 'network', 'dumps');

function getCountryFromNode(node) {
  const raw = node?.location?.country;
  if (!raw || typeof raw !== 'string') return 'Unknown';
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : 'Unknown';
}

function normEth(addr) {
  if (!addr || typeof addr !== 'string') return null;
  const a = addr.trim().toLowerCase();
  return a.length ? a : null;
}

function padRight(str, width) {
  const s = String(str);
  return s + ' '.repeat(Math.max(0, width - s.length));
}

function padLeft(str, width) {
  const s = String(str);
  return ' '.repeat(Math.max(0, width - s.length)) + s;
}

function printCountryTable(rows, countHeaderLabel, title) {
  const headerCountry = 'Country';
  const headerCount = countHeaderLabel;
  const countryWidth = Math.max(headerCountry.length, ...rows.map(r => r.country.length), 1);
  const countWidth = Math.max(headerCount.length, ...rows.map(r => String(r.count).length), 1);
  const top    = `┌${'─'.repeat(countryWidth + 2)}┬${'─'.repeat(countWidth + 2)}┐`;
  const mid    = `├${'─'.repeat(countryWidth + 2)}┼${'─'.repeat(countWidth + 2)}┤`;
  const bottom = `└${'─'.repeat(countryWidth + 2)}┴${'─'.repeat(countWidth + 2)}┘`;
  console.log('');
  console.log(title);
  console.log(top);
  console.log(`│ ${padRight(headerCountry, countryWidth)} │ ${padRight(headerCount, countWidth)} │`);
  console.log(mid);
  if (rows.length === 0) {
    console.log(`│ ${padRight('Unknown', countryWidth)} │ ${padLeft('0', countWidth)} │`);
    console.log(bottom);
    return;
  }
  rows.forEach((r, idx) => {
    console.log(`│ ${padRight(r.country, countryWidth)} │ ${padLeft(String(r.count), countWidth)} │`);
    console.log(idx === rows.length - 1 ? bottom : mid);
  });
}

/**
 * Count full and non-full nodes by country for a given month.
 * Deduplicates by ethereumAddress; a node is "full" if fullNode:true at any point in the month.
 *
 * @param {number|string} year
 * @param {number|string} month  - 1-based month number
 * @param {boolean} [verbose]    - if true, log a progress indicator to stderr
 * @returns {{ totalFullNodes, fullByCountry, totalNonFullNodes, nonFullByCountry,
 *             uniqueOverlays, uniqueEthereumAddresses }}
 */
function countNodes(year, month, verbose = false) {
  const monthStr = String(month).padStart(2, '0');
  const folderPath = path.join(DUMPS_ROOT, String(year), monthStr);

  if (!fs.existsSync(folderPath)) {
    throw new Error(`Dumps folder not found: ${folderPath}`);
  }

  const files = fs.readdirSync(folderPath).filter(f => path.extname(f) === '.json');
  if (files.length === 0) {
    throw new Error(`No .json dump files found in ${folderPath}`);
  }

  const uniqueOverlays          = new Set();
  const uniqueEthereumAddresses = new Set();
  const ethIndex                = new Map(); // eth -> { everFull, country }

  for (let i = 0; i < files.length; i++) {
    if (verbose) process.stderr.write(`\r  Processing dump ${i + 1}/${files.length}...`);
    const filePath = path.join(folderPath, files[i]);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data?.nodes || !Array.isArray(data.nodes)) continue;

    for (const node of data.nodes) {
      const overlay = node?.overlay;
      if (overlay) uniqueOverlays.add(overlay);

      const eth = normEth(node?.ethereumAddress);
      if (!eth) continue;

      uniqueEthereumAddresses.add(eth);
      const country   = getCountryFromNode(node);
      const isFullNow = node?.fullNode === true;

      if (!ethIndex.has(eth)) {
        ethIndex.set(eth, { everFull: isFullNow, country });
      } else {
        const entry = ethIndex.get(eth);
        if (isFullNow) entry.everFull = true;
        if (entry.country === 'Unknown' && country !== 'Unknown') entry.country = country;
      }
    }
  }

  if (verbose) process.stderr.write('\n');

  // Build country breakdown maps
  const fullMap    = new Map(); // country -> Set<eth>
  const nonFullMap = new Map();

  for (const [eth, info] of ethIndex.entries()) {
    const country   = info.country || 'Unknown';
    const targetMap = info.everFull ? fullMap : nonFullMap;
    if (!targetMap.has(country)) targetMap.set(country, new Set());
    targetMap.get(country).add(eth);
  }

  const toRows = map => Array.from(map.entries())
    .map(([country, set]) => ({ country, count: set.size }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));

  const fullByCountry    = toRows(fullMap);
  const nonFullByCountry = toRows(nonFullMap);

  return {
    totalFullNodes:          fullByCountry.reduce((s, r) => s + r.count, 0),
    fullByCountry,
    totalNonFullNodes:       nonFullByCountry.reduce((s, r) => s + r.count, 0),
    nonFullByCountry,
    uniqueOverlays:          uniqueOverlays.size,
    uniqueEthereumAddresses: uniqueEthereumAddresses.size,
  };
}

// ─── standalone CLI entry point ───────────────────────────────────────────────

async function main() {
  const readline    = require('readline');
  const cliProgress = require('cli-progress');

  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));

  const yearInput  = await ask('Enter year (e.g., 2024): ');
  const monthInput = await ask('Enter month (e.g., 7 for July): ');
  rl.close();

  const year  = yearInput.trim();
  const month = monthInput.trim();

  // Use a cli-progress bar in standalone mode
  const monthStr   = month.padStart(2, '0');
  const folderPath = path.join(DUMPS_ROOT, year, monthStr);

  if (!fs.existsSync(folderPath)) {
    console.log('The specified folder does not exist.');
    process.exit(1);
  }

  const files = fs.readdirSync(folderPath).filter(f => path.extname(f) === '.json');
  if (files.length === 0) {
    console.log('No .json dump files found in the specified folder.');
    process.exit(0);
  }

  const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  bar.start(files.length, 0);

  // Re-run core logic with progress bar updates
  const uniqueOverlays          = new Set();
  const uniqueEthereumAddresses = new Set();
  const ethIndex                = new Map();

  for (let i = 0; i < files.length; i++) {
    const data = JSON.parse(fs.readFileSync(path.join(folderPath, files[i]), 'utf8'));
    if (data?.nodes && Array.isArray(data.nodes)) {
      for (const node of data.nodes) {
        const overlay = node?.overlay;
        if (overlay) uniqueOverlays.add(overlay);
        const eth = normEth(node?.ethereumAddress);
        if (!eth) continue;
        uniqueEthereumAddresses.add(eth);
        const country   = getCountryFromNode(node);
        const isFullNow = node?.fullNode === true;
        if (!ethIndex.has(eth)) {
          ethIndex.set(eth, { everFull: isFullNow, country });
        } else {
          const e = ethIndex.get(eth);
          if (isFullNow) e.everFull = true;
          if (e.country === 'Unknown' && country !== 'Unknown') e.country = country;
        }
      }
    }
    bar.update(i + 1);
  }
  bar.stop();

  const fullMap    = new Map();
  const nonFullMap = new Map();
  for (const [eth, info] of ethIndex.entries()) {
    const country   = info.country || 'Unknown';
    const targetMap = info.everFull ? fullMap : nonFullMap;
    if (!targetMap.has(country)) targetMap.set(country, new Set());
    targetMap.get(country).add(eth);
  }

  const toRows = map => Array.from(map.entries())
    .map(([country, set]) => ({ country, count: set.size }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));

  console.log(`Number of unique overlays: ${uniqueOverlays.size}`);
  console.log(`Number of unique ethereum addresses: ${uniqueEthereumAddresses.size}`);

  printCountryTable(toRows(fullMap),    'Unique nodes', 'Full nodes (fullNode:true at least once during the month) — deduped by ethereumAddress');
  printCountryTable(toRows(nonFullMap), 'Unique nodes', 'Non-full nodes (never fullNode:true during the month) — deduped by ethereumAddress');
}

if (require.main === module) {
  main().catch(err => { console.error('An error occurred:', err); process.exit(1); });
}

module.exports = { countNodes };
