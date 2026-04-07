# State of the Network Report Generator

Generate a monthly State of the Network (SOTN) report for the Swarm network by collecting
current metrics, pulling historical data from the prior month's post, and drafting the article.

---

## Step 1 — Gather inputs and confirm plan

Ask the user **one question before doing anything else**:

1. **"Which month and year is this report for?"** (e.g., "March 2026")

Parse the target month as a number (1–12) and note the full month name and abbreviated month name.
Derive the **prior month** (e.g., if the target is March 2026, the prior month is February 2026).

Then, **before running any tools or commands**, present a summary of everything that will happen and ask for confirmation:

> I'll now run the following steps to generate the **{Month} {YYYY}** State of the Network report:
>
> 1. **Check rewards data** (`export/readsi/rewards-{YYYY}-{MM}.json`) — fetch ~60 min if missing/incomplete
> 2. **Download committed-events dump** from swarmscan API
> 3. **Download network topology dumps** for {Month} {YYYY} (~28 files via swarmscan API)
> 4. **Fetch prior month's article** ({Prior Month} {YYYY}) from GitHub to extract historical tables
> 5. **Run analysis scripts** — rewards, active staking nodes by country, total reachable nodes
> 6. **Write article** to `export/swarm-state-of-the-network-{month-lowercase}-{YYYY}.md`
> 7. **Generate chart PNGs** to `export/charts/`
>
> Steps 1–3 may be skipped if data already exists. **Shall I proceed?**

Only continue once the user confirms.

---

## Step 2 — Collect current-month data

### 2a — Check rewards data

Check whether `export/readsi/rewards-YYYY-MM.json` exists and covers the full target month.
Run from the **repo root**:

```bash
cd export && node -e "
const fs = require('fs');
const path = require('path');
const f = path.join(process.cwd(), 'readsi', 'rewards-YYYY-MM.json');
if (!fs.existsSync(f)) { console.log('MISSING'); process.exit(0); }
const raw = fs.readFileSync(f, 'utf8').trim();
if (!raw || raw === '[]' || raw === '') { console.log('EMPTY'); process.exit(0); }
const data = JSON.parse(raw);
if (!data.length) { console.log('EMPTY'); process.exit(0); }
const times = data.map(e => e.time || e.Time).filter(Boolean).sort();
const first = times[0], last = times[times.length - 1];
const monthStart = 'YYYY-MM-01';
const nextMonth = new Date(YYYY, MM, 1).toISOString().slice(0,10);
const coversStart = first <= monthStart + 'T23:59:59';
const coversEnd   = last  >= nextMonth;
console.log('first=' + first + ' last=' + last + ' coversStart=' + coversStart + ' coversEnd=' + coversEnd);
if (!coversStart || !coversEnd) console.log('INCOMPLETE');
else console.log('OK');
"
```

Replace `YYYY`, `MM` (zero-padded), and the `new Date(YYYY, MM, 1)` values with the actual year and month number.

- **`OK`** → rewards data is complete; proceed to Step 2b.
- **`MISSING`**, **`EMPTY`**, or **`INCOMPLETE`** → fetch fresh rewards data using the exported function:

```bash
cd export && node -e "
const { fetchRewards } = require('./get-rewards');
fetchRewards(YEAR, MONTH_NUMBER, null).then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
"
```

Use a timeout of **600000 ms** (10 minutes). Warn the user this can take 20–60 minutes and may need to be run manually if it times out. After completion, re-run the check to confirm coverage before proceeding.

### 2b — Check other data sources

Check whether the remaining two data sources exist:
- `swarmscan/committed-events.json`  (any file, even if stale, is acceptable)
- `network/dumps/YYYY/MM/` directory with at least one `.json` file

**If both exist**, inform the user that existing data will be used and skip to Step 3.

**If either is missing**, run `generate.js` (which skips steps already complete):

```bash
cd export && node -e "
const { generate } = require('./generate');
generate(YEAR, MONTH_NUMBER).then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
"
```

Use a timeout of **600000 ms** (10 minutes). Warn the user this step can take 20–60 minutes.

Do not proceed to Step 3 until all data files exist and rewards coverage is confirmed.

---

## Step 3 — Extract prior month's historical data

Run the `extract-prior-month.js` script, which fetches the prior month's article from GitHub
and parses all 7 tables deterministically. If the prior month's article is not yet published on
GitHub (HTTP 404), fall back to the locally generated version at
`export/swarm-state-of-the-network-{prior-month-lowercase}-{YYYY}.md` and parse it inline.

```bash
node export/extract-prior-month.js YEAR MONTH
```

Replace `YEAR` and `MONTH` with the **target** month's year and month number (the script
derives the prior month automatically). Example for March 2026: `node export/extract-prior-month.js 2026 3`

The script outputs JSON with a `tables` object containing `totalRewards`, `medianWin`, `avgWin`,
`avgEarningsPerNode`, `activeStakingNodes`, `reachableFullNodes`, and `winningNodes` — each an
array of `{month, value}` objects (last 5 rows of each table).

If the GitHub fetch returns 404, parse the local fallback file directly:

```bash
cd export && node -e "
const fs = require('fs');
const path = require('path');
const markdown = fs.readFileSync(path.join(process.cwd(), 'swarm-state-of-the-network-PRIOR_MONTH_LOWERCASE-PRIOR_YEAR.md'), 'utf8');

function parseTable(lines) {
  const rows = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    if (cells[1].includes('---') || cells[1].includes('===')) continue;
    const rawValue = cells[1].replace(/\*\*/g, '').replace(/,/g, '').trim();
    const num = parseFloat(rawValue);
    if (isNaN(num)) continue;
    rows.push({ month: cells[0].replace(/\*\*/g, '').trim(), value: num });
  }
  return rows;
}

function extractTable(markdown, headingKeyword, lastN = 5) {
  const lines = markdown.split('\n');
  let inSection = false;
  const tableLines = [];
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      if (inSection) break;
      if (line.toLowerCase().includes(headingKeyword.toLowerCase())) { inSection = true; }
      continue;
    }
    if (inSection) tableLines.push(line);
  }
  return parseTable(tableLines).slice(-lastN);
}

const tables = {
  totalRewards:       extractTable(markdown, 'Network Total Monthly Rewards'),
  medianWin:          extractTable(markdown, 'Monthly Median Win Values'),
  avgWin:             extractTable(markdown, 'Monthly Average Win Values'),
  avgEarningsPerNode: extractTable(markdown, 'Active Staking Node Monthly Average Earnings'),
  activeStakingNodes: extractTable(markdown, 'Total Active Staking Nodes by Month'),
  reachableFullNodes: extractTable(markdown, 'Total Reachable Full Nodes'),
  winningNodes:       extractTable(markdown, 'Total Winning Nodes by Month'),
};
console.log(JSON.stringify({ priorMonthName: 'PRIOR_MONTH_NAME', priorYear: PRIOR_YEAR, tables }, null, 2));
"
```

---

## Step 4 — Run analysis to get current metrics

Run a single `node -e` command that calls all three exported module functions and prints
every metric needed for the article:

```bash
cd export && node -e "
const { analyzeRewards }  = require('./analyze-rewards');
const { analyzeCommits }  = require('./analyze-commit-dumps-with-locations');
const { countNodes }      = require('./count-nodes');
const path = require('path');

const year = YEAR, month = MONTH;
const rewardsFile = path.join(process.cwd(), 'readsi', 'rewards-YYYY-MM.json');

analyzeCommits(year, month).then(commits => {
  const rewards = analyzeRewards(year, month, rewardsFile);
  const nodes   = countNodes(year, month, true);
  const avgEarnings = rewards.totalReward / commits.totalActiveStaking;

  console.log(JSON.stringify({
    totalReward:         Math.round(rewards.totalReward),
    medianWin:           +rewards.medianReward.toFixed(2),
    avgWin:              +rewards.meanReward.toFixed(2),
    winningNodes:        rewards.uniqueOverlays,
    activeStakingNodes:  commits.totalActiveStaking,
    activeByCountry:     commits.byCountry,
    reachableFullNodes:  nodes.totalFullNodes,
    fullByCountry:       nodes.fullByCountry,
    avgEarningsPerNode:  +avgEarnings.toFixed(2),
  }, null, 2));
}).catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null
```

Replace `YEAR`, `MONTH`, and `YYYY-MM` with actual values. The output is a single JSON object
containing all metrics needed for Steps 5 and 6.

---

## Step 5 — Build the historical tables

For each of the 7 metric tables, construct a 6-row table:
- Rows 1–5: the last 5 rows from the prior month's JSON output (Step 3)
- Row 6: current month's data from the JSON output (Step 4), using `**value**` bold format

Month names in tables use full names (September, October, etc.).
Format numbers with commas where appropriate (e.g. `20,967` not `20967`).

---

## Step 6 — Draft the article

Write the complete article to `export/swarm-state-of-the-network-{{month-lowercase}}-{{YYYY}}.md`.
Use the structure below exactly,
substituting all `{{PLACEHOLDERS}}` with real values.

The banner and chart image slugs follow this naming convention:
- Banner: `/uploads/sotn-MMMM-YY.jpg`  (e.g., `sotn-mar-26.jpg`)
- Charts: `/uploads/chart-{Metric-Name}-{Month}-{Year}.png`
  where the metric slug is the section heading with spaces replaced by hyphens
  (examples: `chart-Total-Network-Monthly-Rewards-March-2026.png`,
  `chart-Monthly-Median-Win-Values-March-2026.png`)

---

```
+++
draft = true
banner = "/uploads/sotn-{{MMM}}-{{YY}}.jpg"
images = [ "/uploads/sotn-{{MMM}}-{{YY}}.jpg" ]
categories = [ "Development updates" ]
date = {{YYYY}}-{{MM}}-01T00:00:00.000Z
description = "This report provides an overview of the Swarm network's key metrics for {{Month}} {{YYYY}}, including rewards, participation levels, and node distribution, and places them in context with recent monthly trends."
references_and_footnotes = [ ]
title = "State of the Network: {{Month}} {{YYYY}}"
_template = "post"
slug="swarm-state-of-the-network-{{month-lowercase}}-{{YYYY}}"
+++

### **{{Month}} {{YYYY}} State of the Network Report**

This report provides an overview of the Swarm network's key metrics for {{Month}} {{YYYY}}, including rewards, participation levels, and node distribution, and places them in context with recent monthly trends.

{{< admonition info >}}
**_Active nodes_** are full nodes identified by a unique Gnosis Chain address with the required minimum staked xBZZ that have submitted a [commit](https://docs.ethswarm.org/docs/concepts/incentives/redistribution-game/#redistribution-game-details) transaction during the month.
{{< /admonition >}}

{{< admonition info >}}
All rewards are denominated in xBZZ. Since the fiat value of xBZZ fluctuates monthly, these metrics may not reflect the real-world returns for node operators.
{{< /admonition >}}

## Network Total Monthly Rewards

This metric shows the total storage incentive rewards paid out across the network each month.

{{INSERT 6-ROW TABLE: Network Total Monthly Rewards}}

![Total Network Rewards (xBZZ) vs. Month](/uploads/chart-Total-Network-Monthly-Rewards-{{Month}}-{{YYYY}}.png)

{{ONE SENTENCE summarising the change from prior month, e.g.: "Total network rewards in {{Month}} were {{VALUE}} xBZZ, [up/down] from {{PRIOR}} xBZZ in {{PRIOR_MONTH}}."}}


## Monthly Median Win Values

{{INSERT 6-ROW TABLE: Monthly Median Win Values}}

![Median Win Values (xBZZ) vs. Month](/uploads/chart-Monthly-Median-Win-Values-{{Month}}-{{YYYY}}.png)

{{ONE SENTENCE summarising the change.}}


## Monthly Average Win Values

{{INSERT 6-ROW TABLE: Monthly Average Win Values}}

![Average Win Values (xBZZ) vs. Month](/uploads/chart-Monthly-Average-Win-Values-{{Month}}-{{YYYY}}.png)

{{ONE SENTENCE summarising the change.}}


## Active Staking Node Monthly Average Earnings

{{INSERT 6-ROW TABLE: Active Staking Node Monthly Average Earnings}}

![Avg Total Earnings per Node (xBZZ) vs. Month](/uploads/chart-Avg-Total-Earnings-per-Node-{{Month}}-{{YYYY}}.png)

{{ONE SENTENCE summarising the change.}}


## Total Active Staking Nodes by Month

{{INSERT 6-ROW TABLE: Total Active Staking Nodes}}

![Total Active Staking Nodes (xBZZ) vs. Month](/uploads/chart-Total-Active-Staking-Nodes-{{Month}}-{{YYYY}}.png)

{{ONE SENTENCE summarising the change.}}


## Total Reachable Full Nodes Regardless of Active Status

{{INSERT 6-ROW TABLE: Total Reachable Full Nodes}}

![Total Reachable Full Nodes vs. Month](/uploads/chart-Total-Reachable-Full-Nodes-{{Month}}-{{YYYY}}.png)

{{ONE SENTENCE summarising the change.}}


## Total Winning Nodes by Month

{{INSERT 6-ROW TABLE: Total Winning Nodes}}

![Number of Winning Staking Nodes by Month](/uploads/chart-Number-of-Winning-Staking-Nodes-by-Month-{{Month}}-{{YYYY}}.png)

{{ONE SENTENCE summarising the change.}}


## Total Active Staking Nodes by Country

{{INSERT FULL COUNTRY TABLE from Step 4b, sorted descending by node count}}

{{ONE OR TWO SENTENCES describing the geographic distribution, noting the top country and any notable changes from prior month.}}

## Total Nodes By Country Regardless of Staking Status

{{INSERT FULL COUNTRY TABLE from Step 4c (full nodes only), sorted descending by node count}}

{{ONE OR TWO SENTENCES describing the geographic distribution, noting dominant countries.}}


## Conclusion

{{TWO TO FOUR SENTENCES summarising the overall trends for the month. Note whether metrics increased or decreased overall. Mention any notable changes in geographic distribution compared to the prior month. Keep a neutral, factual tone — do not speculate on causes.}}
```

---

## Step 7 — Generate charts

After writing the article file, run the chart generation script from the repo root:

```bash
cd export && python generate-charts.py swarm-state-of-the-network-{{month-lowercase}}-{{YYYY}}.md
```

This will generate one PNG per chart section and save them to `export/charts/`.

---

## Step 8 — Report back to the user

After the charts are generated, tell the user:

1. The article has been saved to `export/swarm-state-of-the-network-{month-lowercase}-{YYYY}.md`
2. Charts have been generated and saved to `export/charts/` — copy them to the blog's `/static/uploads/` directory
3. The banner image at `/uploads/sotn-MMM-YY.jpg` still needs to be provided
4. The `draft = true` flag is set — change to `false` when ready to publish
