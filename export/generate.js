/**
 * generate.js
 *
 * One-shot script that collects all source data for a target month, then runs
 * every analysis script and prints the results.
 *
 * Steps
 *   1. Fetch rewards data via readsi (get-rewards.js)
 *   2. Download committed-events dump from swarmscan API
 *   3. Download per-day network dumps (get-dumps.js)
 *   4. Analyse rewards  (analyze-rewards.js)
 *   5. Analyse commit locations (analyze-commit-dumps-with-locations.js)
 *   6. Count nodes by country (count-nodes.js)
 */

const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const { spawn } = require('child_process');
const { fetchRewards } = require('./get-rewards');

// Root of the project (one level up from export/)
const ROOT_DIR   = path.resolve(__dirname, '..');
const SWARMSCAN  = path.join(ROOT_DIR, 'swarmscan');

function section(label) {
  const bar = '─'.repeat(60);
  console.log(`\n${bar}\n  ${label}\n${bar}`);
}

/**
 * Spawn a Node.js script, supplying `answers` (one per readline prompt) via
 * stdin.  The child inherits stdout/stderr so its output appears inline.
 *
 * @param {string}   label      - display label for the section header
 * @param {string}   scriptPath - absolute path to the script
 * @param {string[]} answers    - answers to each readline prompt, in order
 * @param {string}   [cwd]      - working directory (defaults to export/)
 */
/**
 * Render a fixed-width ASCII progress bar.
 * pct: 0–100, width: number of fill characters in the bar
 */
function renderBar(pct, width = 30) {
  const filled = Math.round((pct / 100) * width);
  return '[' + '='.repeat(filled) + ' '.repeat(width - filled) + ']';
}

function runScript(label, scriptPath, answers, cwd) {
  section(label);
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {
      stdio: ['pipe', 'inherit', 'inherit'],
      cwd: cwd || __dirname,
    });

    child.stdin.write(answers.join('\n') + '\n');
    child.stdin.end();

    child.on('close', code => {
      if (code !== 0) reject(new Error(`"${label}" exited with code ${code}`));
      else resolve();
    });
    child.on('error', reject);
  });
}

/**
 * Download a URL to `dest`, showing a live progress indicator.
 * Overwrites any existing file.
 */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    https.get(url, res => {
      if (res.statusCode !== 200)
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));

      const total    = parseInt(res.headers['content-length'] || '0', 10);
      let received   = 0;

      res.on('data', chunk => {
        received += chunk.length;
        const mb   = (received / 1024 / 1024).toFixed(1);
        const info = total
          ? `${((received / total) * 100).toFixed(0)}%  (${mb} MB)`
          : `${mb} MB`;
        process.stdout.write(`\r  Downloading... ${info}   `);
      });

      res.pipe(file);
      file.on('finish', () => { process.stdout.write('\n'); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

// ─── core pipeline ────────────────────────────────────────────────────────────

/**
 * Run the full data collection pipeline for the given month.
 * Safe to call from other scripts — no readline, no process.exit.
 *
 * @param {number} year
 * @param {number} month  1-based
 */
async function generate(year, month) {
  const monthStr = String(month).padStart(2, '0');
  const bar = '═'.repeat(60);

  console.log(`\n${bar}`);
  console.log(`  Generating metrics for ${year}-${monthStr}`);
  console.log(bar);

  // ── 1. Rewards data ─────────────────────────────────────────────────────────
  section('[1/6] Fetching rewards data');
  await fetchRewards(year, month, ({ hoursFetched, totalHours, pct }) => {
    process.stderr.write(
      `\r  ${renderBar(pct)} ${String(Math.round(pct)).padStart(3)}%` +
      `  ${Math.round(hoursFetched)}h / ${Math.round(totalHours)}h fetched   `
    );
  });
  process.stderr.write('\r' + ' '.repeat(70) + '\r');

  // ── 2. Committed events dump ─────────────────────────────────────────────────
  section('[2/6] Downloading committed events dump');
  fs.mkdirSync(SWARMSCAN, { recursive: true });
  const committedPath = path.join(SWARMSCAN, 'committed-events.json');
  await download(
    'https://api.swarmscan.io/v1/events/redistribution/committed/dump',
    committedPath
  );
  console.log(`  Saved to: ${committedPath}`);

  // ── 3. Network dumps ─────────────────────────────────────────────────────────
  await runScript(
    '[3/6] Downloading network dumps',
    path.join(__dirname, 'get-dumps.js'),
    [String(year), String(month), '2'],
    ROOT_DIR
  );

  // ── 4. Rewards analysis ──────────────────────────────────────────────────────
  const readsiDir  = path.join(__dirname, 'readsi');
  const allFiles   = fs.readdirSync(readsiDir).filter(f => f.endsWith('.json')).sort();
  const targetFile = `rewards-${year}-${monthStr}.json`;
  const fileIdx    = allFiles.indexOf(targetFile) + 1;

  if (!fileIdx) {
    throw new Error(`${targetFile} not found in export/readsi/ — rewards step may have failed.`);
  }

  await runScript(
    '[4/6] Rewards analysis',
    path.join(__dirname, 'analyze-rewards.js'),
    [String(month), String(year), String(fileIdx)]
  );

  // ── 5. Commit locations ──────────────────────────────────────────────────────
  await runScript(
    '[5/6] Active staking nodes by country',
    path.join(__dirname, 'analyze-commit-dumps-with-locations.js'),
    [String(year), String(month)],
    ROOT_DIR
  );

  // ── 6. Node count ────────────────────────────────────────────────────────────
  await runScript(
    '[6/6] Total reachable nodes by country',
    path.join(__dirname, 'count-nodes.js'),
    [String(year), String(month)]
  );

  console.log(`\n${bar}`);
  console.log(`  All done — metrics for ${year}-${monthStr} generated successfully.`);
  console.log(bar + '\n');
}

// ─── standalone CLI entry point ───────────────────────────────────────────────

async function main() {
  const readline = require('readline');
  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));

  const monthInput = await ask('Enter target month (1-12): ');
  const yearInput  = await ask('Enter target year (e.g. 2026): ');
  rl.close();

  const month = parseInt(monthInput, 10);
  const year  = parseInt(yearInput,  10);

  if (isNaN(month) || month < 1 || month > 12 || isNaN(year) || year < 2020) {
    console.error('Invalid month or year.');
    process.exit(1);
  }

  await generate(year, month);
}

if (require.main === module) {
  main().catch(err => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
  });
}

module.exports = { generate };
