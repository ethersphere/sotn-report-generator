# Swarm State of the Network Report Generator

Automated pipeline for generating monthly [State of the Network](https://blog.ethswarm.org/foundation/) reports for the Swarm network. Collects on-chain reward data, network topology snapshots, and geographic node distribution, then drafts a complete Hugo-compatible markdown article with charts.

## How it works

The workflow is driven by the `/sotn` Claude Code skill (`.claude/commands/sotn.md`). Open this repo in [Claude Code](https://claude.ai/code), run `/sotn`, and Claude will:

1. Check / fetch rewards data for the target month (via [bee-scripts/readsi](https://github.com/ethersphere/bee-scripts))
2. Download a committed-events dump from the [swarmscan API](https://api.swarmscan.io)
3. Download daily network topology dumps from swarmscan
4. Fetch the prior month's published article from GitHub to extract historical tables
5. Run analysis scripts to compute all 7 key metrics
6. Write a complete draft article in Hugo TOML frontmatter format
7. Generate 7 chart PNGs with matplotlib

## Prerequisites

| Tool | Purpose |
|------|---------|
| [Node.js](https://nodejs.org/) ≥ 18 | Runs all data collection and analysis scripts |
| [Go](https://go.dev/) ≥ 1.21 | Used by `readsi` to fetch on-chain reward data |
| [Python](https://python.org/) ≥ 3.9 | Chart generation |
| [Git](https://git-scm.com/) | Auto-clones `bee-scripts` on first run |
| [Claude Code](https://claude.ai/code) | Executes the `/sotn` skill |

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/NoahMaizels/sotn-report-generator.git
cd sotn-report-generator

# 2. Install Node dependencies
cd export && npm install && cd ..

# 3. Install Python dependencies
pip install -r requirements.txt
```

`bee-scripts` (the Go reward fetcher) is cloned automatically on first run into `bee-scripts/` at the repo root. It requires Go to be installed.

## Usage

Open the repo in Claude Code and run:

```
/sotn
```

Claude will ask for the target month and year, confirm the plan, then execute the full pipeline. Generated files:

- **Article**: `export/swarm-state-of-the-network-{month}-{year}.md`
- **Charts**: `export/charts/*.png`

Copy the charts to your blog's `/static/uploads/` directory and provide the banner image (`/uploads/sotn-MMM-YY.jpg`) before publishing.

## Scripts

All scripts are in `export/` and can also be run standalone:

| Script | Purpose |
|--------|---------|
| `get-rewards.js` | Fetches monthly reward data via readsi (Go) |
| `generate.js` | Orchestrates all data collection steps |
| `get-dumps.js` | Downloads daily network topology snapshots |
| `analyze-rewards.js` | Computes total/median/mean rewards and winning nodes |
| `analyze-commit-dumps-with-locations.js` | Counts active staking nodes by country |
| `count-nodes.js` | Counts total reachable full nodes by country |
| `extract-prior-month.js` | Fetches & parses the prior month's published article |
| `generate-charts.py` | Generates PNG charts from a markdown article file |

Each JS script exports its core function for programmatic use and also supports a standalone CLI mode.

## Data layout

Data directories are created at runtime and excluded from git:

```
sotn-report-generator/
├── bee-scripts/          ← auto-cloned Go tools (readsi)
├── swarmscan/            ← committed-events dump
├── network/dumps/        ← daily topology snapshots
└── export/
    └── readsi/           ← rewards JSON files
```

## Output layout

```
export/
├── swarm-state-of-the-network-{month}-{year}.md   ← draft article
└── charts/
    └── chart-*.png                                 ← copy to /static/uploads/
```
