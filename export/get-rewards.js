const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

const READSI_REPO = 'https://github.com/ethersphere/bee-scripts';
const READSI_DIR = path.resolve(__dirname, '..', 'bee-scripts', 'readsi');
const OUTPUT_DIR = path.join(__dirname, 'readsi');

function checkCommand(cmd) {
  try {
    execSync(`${cmd} version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureReadsi() {
  if (fs.existsSync(path.join(READSI_DIR, 'main.go'))) {
    console.log('readsi found at', READSI_DIR);
    return;
  }

  console.log('readsi not found. Cloning bee-scripts from GitHub...');

  if (!checkCommand('git')) {
    console.error('Error: git is not installed or not in PATH.');
    process.exit(1);
  }

  const parentDir = path.resolve(__dirname, '..');
  const beeScriptsDir = path.join(parentDir, 'bee-scripts');

  if (!fs.existsSync(beeScriptsDir)) {
    execSync(`git clone ${READSI_REPO} "${beeScriptsDir}"`, { stdio: 'inherit' });
  } else {
    console.log('bee-scripts directory exists but readsi/main.go is missing. Pulling latest...');
    execSync(`git -C "${beeScriptsDir}" pull`, { stdio: 'inherit' });
  }

  if (!fs.existsSync(path.join(READSI_DIR, 'main.go'))) {
    console.error('Error: Could not find readsi/main.go after cloning. Check the repo structure.');
    process.exit(1);
  }

  console.log('readsi installed successfully.');
}

// Calculate hours from the start of the target month (UTC) to now, plus 48h buffer
// to account for timezone offsets and API delays at the month boundary.
function calcSinceHours(year, month) {
  const startOfMonth = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
  const now = Date.now();
  const diffMs = now - startOfMonth;
  if (diffMs <= 0) {
    console.error('Error: target month has not started yet.');
    process.exit(1);
  }
  return Math.ceil(diffMs / (1000 * 60 * 60)) + 48; // +48h buffer
}

/**
 * Fetch rewards for the given month/year and save to readsi/rewards-YYYY-MM.json.
 *
 * @param {number}   year
 * @param {number}   month
 * @param {Function} [onProgress] - optional callback called with { hoursFetched, totalHours, pct }
 *                                   for each Go progress update. When provided, Go's stderr is piped
 *                                   rather than inherited so the caller can render its own UI.
 * @returns {Promise<string>} absolute path to the saved rewards file
 */
async function fetchRewards(year, month, onProgress) {
  if (!checkCommand('go')) {
    console.error('Error: Go is not installed or not in PATH. Install it from https://go.dev/dl/');
    process.exit(1);
  }

  ensureReadsi();

  const sinceHours = calcSinceHours(year, month);
  const monthStr = String(month).padStart(2, '0');
  console.log(`\nFetching rewards for ${year}-${monthStr} (--since=${sinceHours}h)...\n`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outFile = path.join(OUTPUT_DIR, `rewards-${year}-${monthStr}.json`);

  await new Promise((resolve, reject) => {
    const child = spawn(
      'go',
      ['run', 'main.go', `--since=${sinceHours}h`, '--cmd=reward', '--format=json'],
      { cwd: READSI_DIR, shell: true, stdio: ['ignore', 'pipe', onProgress ? 'pipe' : 'inherit'] }
    );

    child.stdout.pipe(fs.createWriteStream(outFile));

    if (onProgress) {
      const RE = /Fetched\s+([\d.]+)h\s*\/\s*([\d.]+)h\s*\(([\d.]+)%\)/;
      let buf = '';
      child.stderr.on('data', data => {
        buf += data.toString();
        const parts = buf.split(/[\r\n]/);
        buf = parts.pop(); // keep incomplete trailing chunk
        for (const line of parts) {
          const m = line.match(RE);
          if (m) {
            onProgress({
              hoursFetched: parseFloat(m[1]),
              totalHours:   parseFloat(m[2]),
              pct:          parseFloat(m[3]),
            });
          }
        }
      });
    }

    child.on('close', code => {
      if (code !== 0) reject(new Error(`readsi exited with code ${code}`));
      else resolve();
    });
    child.on('error', reject);
  });

  // Validate output
  const output = fs.readFileSync(outFile, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(output);
    console.log(`\nReceived ${parsed.length} reward entries.`);
  } catch {
    console.error('Output is not valid JSON. Raw output:\n', output.slice(0, 500));
    process.exit(1);
  }

  // Coverage check
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd   = new Date(Date.UTC(year, month, 1));
  const now        = new Date();

  if (parsed.length > 0) {
    const times    = parsed.map(e => new Date(e.time)).filter(t => !isNaN(t));
    const earliest = new Date(Math.min(...times));
    const latest   = new Date(Math.max(...times));

    console.log(`  Earliest entry: ${earliest.toISOString()}`);
    console.log(`  Latest entry:   ${latest.toISOString()}`);

    if (earliest > monthStart) {
      console.warn(`\nWARNING: Earliest entry (${earliest.toISOString()}) is after the start of ${year}-${monthStr}. Data may be missing from the beginning of the month.`);
    }

    if (monthEnd > now) {
      console.warn(`\nNOTE: ${year}-${monthStr} is not yet complete (ends ${monthEnd.toISOString()}). Re-run after the month ends for full data.`);
    } else {
      const hasEntryPastMonth = times.some(t => t >= monthEnd);
      if (hasEntryPastMonth) {
        console.log(`\nCoverage check passed: at least one entry past end of ${year}-${monthStr} confirms full month captured.`);
      } else {
        console.warn(`\nWARNING: No entries found past the end of ${year}-${monthStr}. The fetch window may not have extended far enough — full month data may be incomplete.`);
      }
    }
  } else {
    console.warn('\nWARNING: No entries found in output.');
  }

  console.log(`\nSaved to: ${outFile}`);
  return outFile;
}

// ─── standalone entry point ───────────────────────────────────────────────────

async function main() {
  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));

  const monthInput = await ask('Enter target month (1-12): ');
  const yearInput  = await ask('Enter target year (e.g. 2026): ');
  rl.close();

  const month = parseInt(monthInput, 10);
  const year  = parseInt(yearInput, 10);

  if (isNaN(month) || month < 1 || month > 12) { console.error('Invalid month.'); process.exit(1); }
  if (isNaN(year)  || year < 2020)              { console.error('Invalid year.');  process.exit(1); }

  // When run standalone, inherit Go's stderr directly (no progress callback needed).
  await fetchRewards(year, month, null);
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { fetchRewards };
