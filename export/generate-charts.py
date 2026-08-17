#!/usr/bin/env python3
"""
generate-charts.py

Reads export/article.md, finds every section that has both a data table and a
chart image reference, and generates the corresponding PNG using matplotlib.

Usage:
  python generate-charts.py [output_dir]

Output directory defaults to ./charts/
Copy the PNGs to the blog's /static/uploads/ directory when done.
"""

import re
import os
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

BLUE = '#4472C4'
GRID_COLOR = '#e0e0e0'
FIG_W, FIG_H = 6.25, 4.17  # ~600x400px at 96dpi


def extract_charts(markdown):
    """Parse article.md and return one entry per chart section."""
    results = []

    # Split on level-2 headings; first chunk is frontmatter/intro — skip it.
    sections = re.split(r'^## ', markdown, flags=re.MULTILINE)[1:]

    for section in sections:
        title = section.split('\n')[0].strip()

        # Only process sections that reference a chart image.
        img_match = re.search(r'!\[.*?\]\(/uploads/(chart-[^)]+\.png)\)', section)
        if not img_match:
            continue
        image_file = img_match.group(1)

        # Collect table rows.
        raw_rows = re.findall(r'^\|.+\|$', section, re.MULTILINE)
        if not raw_rows or len(raw_rows) < 3:
            continue

        rows = [[c.strip() for c in row.split('|') if c.strip()] for row in raw_rows]

        y_label = rows[0][1] if len(rows[0]) > 1 else ''
        data_rows = rows[2:]  # skip header and separator

        labels = []
        values = []

        for cols in data_rows:
            if len(cols) < 2:
                continue
            raw_value = re.sub(r'\*\*', '', cols[1]).replace(',', '').strip()
            try:
                value = float(raw_value)
                labels.append(re.sub(r'\*\*', '', cols[0]).strip())
                values.append(value)
            except ValueError:
                pass

        if labels:
            # Use comma formatting for large whole numbers, decimal for small/float values
            all_integers = all(v == int(v) for v in values)
            large = max(values) >= 100
            y_format = 'comma' if (all_integers and large) else 'decimal'
            results.append({
                'title': title,
                'y_label': y_label,
                'labels': labels,
                'values': values,
                'image_file': image_file,
                'y_format': y_format,
            })

    return results


def make_chart(title, y_label, labels, values, filename, y_format, output_dir):
    fig, ax = plt.subplots(figsize=(FIG_W, FIG_H))
    fig.patch.set_facecolor('white')
    ax.set_facecolor('white')

    ax.plot(labels, values, color=BLUE, linewidth=2, marker='None')

    # Grid: horizontal only, light gray
    ax.yaxis.grid(True, color=GRID_COLOR, linewidth=0.8, zorder=0)
    ax.xaxis.grid(False)
    ax.set_axisbelow(True)

    # Remove spines except bottom
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_visible(False)

    # Y-axis starts at 0
    ax.set_ylim(bottom=0)

    # Labels
    ax.set_xlabel('Month', fontsize=11, color='#555555', labelpad=6)
    ax.set_ylabel(y_label, fontsize=10, color='#555555', labelpad=6)

    # Title: top-left, normal weight
    ax.set_title(title, loc='left', fontsize=13, fontweight='normal', color='#333333', pad=12)

    # Tick formatting
    ax.tick_params(axis='both', colors='#555555', labelsize=10)
    ax.tick_params(axis='y', left=False)

    if y_format == 'comma':
        ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f'{int(x):,}'))
    else:
        ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f'{x:g}'))

    # Rotate x labels if needed
    if len(labels) > 4:
        plt.xticks(rotation=0)

    # Bold the current (latest) month's tick label, matching the source table
    fig.canvas.draw()
    ax.get_xticklabels()[-1].set_fontweight('bold')

    plt.tight_layout(pad=1.2)
    out_path = os.path.join(output_dir, filename)
    fig.savefig(out_path, dpi=96, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    print(f'  {filename} ... done')


def main():
    # First positional arg: article .md file (or omit to use article.md)
    # Second positional arg: output directory (or omit to use ./charts/)
    args = sys.argv[1:]
    if args and args[0].endswith('.md'):
        article_path = args[0] if os.path.isabs(args[0]) else os.path.join(SCRIPT_DIR, args[0])
        output_dir = args[1] if len(args) > 1 else os.path.join(SCRIPT_DIR, 'charts')
    else:
        article_path = os.path.join(SCRIPT_DIR, 'article.md')
        output_dir = args[0] if args else os.path.join(SCRIPT_DIR, 'charts')

    if not os.path.exists(article_path):
        print(f'{article_path} not found. Run /sotn first to draft the article.', file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    with open(article_path, 'r', encoding='utf-8') as f:
        markdown = f.read()

    charts = extract_charts(markdown)

    if not charts:
        print('No chart sections found in article.md.', file=sys.stderr)
        sys.exit(1)

    print(f'\nGenerating {len(charts)} charts → {output_dir}\n')

    for chart in charts:
        make_chart(
            title=chart['title'],
            y_label=chart['y_label'],
            labels=chart['labels'],
            values=chart['values'],
            filename=chart['image_file'],
            y_format=chart['y_format'],
            output_dir=output_dir,
        )

    print(f'\nAll {len(charts)} charts saved to: {output_dir}')
    print("Copy them to the blog's /static/uploads/ directory.")


if __name__ == '__main__':
    main()
