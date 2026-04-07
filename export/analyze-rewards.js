const fs   = require('fs');
const path = require('path');

const MONTH_NAMES = {
  1:'january',2:'february',3:'march',4:'april',5:'may',6:'june',
  7:'july',8:'august',9:'september',10:'october',11:'november',12:'december'
};

const READSI_DIR = path.join(__dirname, 'readsi');

function convertKeysToLowercase(obj) {
  return Object.keys(obj).reduce((acc, key) => {
    acc[key.toLowerCase()] = obj[key];
    return acc;
  }, {});
}

function validateNumberInput(input, min, max) {
  const num = parseInt(input, 10);
  return !isNaN(num) && num >= min && num <= max;
}

/**
 * Analyse a rewards JSON file for a specific month/year.
 *
 * @param {number} year
 * @param {number} month   1-based
 * @param {string} filePath  absolute path to the rewards JSON file
 * @returns {{ totalReward, meanReward, medianReward, uniqueOwners, uniqueOverlays }}
 */
function analyzeRewards(year, month, filePath) {
  const raw  = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw).map(convertKeysToLowercase);

  const monthStr    = String(month).padStart(2, '0');
  const filtered    = data.filter(e => e.time && e.time.startsWith(`${year}-${monthStr}`));

  if (filtered.length === 0) {
    throw new Error(`No entries found for ${year}-${monthStr} in ${path.basename(filePath)}`);
  }

  const uniqueOwners   = new Set(filtered.map(e => e.owner));
  const uniqueOverlays = new Set(filtered.map(e => e.overlay));
  const rewards        = filtered.map(e => e.reward).filter(r => typeof r === 'number' && !isNaN(r));

  const totalReward = rewards.reduce((s, r) => s + r, 0);
  const meanReward  = totalReward / rewards.length;

  const sorted = [...rewards].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  const medianReward = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  return {
    totalEntries:  data.length,
    matchedEntries: filtered.length,
    totalReward,
    meanReward,
    medianReward,
    uniqueOwners:   uniqueOwners.size,
    uniqueOverlays: uniqueOverlays.size,
  };
}

// ─── standalone CLI entry point ───────────────────────────────────────────────

function main() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.question('Please enter a month (1-12): ', monthInput => {
    if (!validateNumberInput(monthInput, 1, 12)) {
      console.error('Invalid month. Please enter a number between 1 and 12.');
      rl.close(); return;
    }
    const month = parseInt(monthInput, 10);

    rl.question('Please enter a year (4 digits): ', yearInput => {
      if (!validateNumberInput(yearInput, 1000, 9999)) {
        console.error('Invalid year. Please enter a valid 4-digit year.');
        rl.close(); return;
      }
      const year = parseInt(yearInput, 10);

      if (!fs.existsSync(READSI_DIR)) {
        console.error('Directory "readsi" does not exist. Exiting.');
        rl.close(); return;
      }

      const files = fs.readdirSync(READSI_DIR).filter(f => f.endsWith('.json'));
      if (files.length === 0) {
        console.error('No JSON files found in the "readsi" directory. Exiting.');
        rl.close(); return;
      }

      console.log('\nAvailable JSON files:');
      files.forEach((f, i) => console.log(`${i + 1}. ${f}`));

      rl.question('\nPlease select a file by number: ', fileIndexInput => {
        if (!validateNumberInput(fileIndexInput, 1, files.length)) {
          console.error('Invalid file selection. Please select a valid number.');
          rl.close(); return;
        }

        const selectedFile = files[parseInt(fileIndexInput, 10) - 1];
        const monthName    = MONTH_NAMES[month];
        const monthStr     = String(month).padStart(2, '0');
        const nameLower    = selectedFile.toLowerCase();
        const hasYear      = nameLower.includes(`${year}`);
        const hasMonth     = nameLower.includes(monthName) || nameLower.includes(`-${monthStr}.`);

        if (!hasYear || !hasMonth) {
          console.error('The selected file does not match the input month or year. Exiting.');
          rl.close(); return;
        }

        try {
          const result = analyzeRewards(year, month, path.join(READSI_DIR, selectedFile));
          console.log(`Input Year: ${year}`);
          console.log(`Input Month: ${monthName.charAt(0).toUpperCase() + monthName.slice(1)}`);
          console.log(`Total entries in the file: ${result.totalEntries}`);
          console.log(`Entries matching the year and month: ${result.matchedEntries}`);
          console.table([
            { Metric: 'Total Reward',    Value: result.totalReward    },
            { Metric: 'Mean Reward',     Value: result.meanReward     },
            { Metric: 'Median Reward',   Value: result.medianReward   },
            { Metric: 'Unique Owners',   Value: result.uniqueOwners   },
            { Metric: 'Unique Overlays', Value: result.uniqueOverlays },
          ]);
        } catch (err) {
          console.error('Error reading or processing the file:', err.message);
        }
        rl.close();
      });
    });
  });
}

if (require.main === module) {
  main();
}

module.exports = { analyzeRewards };
