#!/usr/bin/env python3
"""
Package a generated State of the Network report into a single distributable zip.

Bundles, for a given month:
  - the Hugo article  swarm-state-of-the-network-<month>-<year>.md   (unchanged, /uploads/ paths intact)
  - the 7 chart PNGs  charts/*-<Month>-<Year>.png
  - a self-contained HTML preview with the charts embedded as base64, so a
    recipient can read the whole report by double-clicking it (no tooling needed)

Output: export/swarm-sotn-<month>-<year>.zip

Usage (run from the repo root or export/):  python package-report.py <year> <month>
Example:                                     python package-report.py 2026 6

No third-party dependencies (uses only the Python standard library).
"""

import sys, os, re, base64, calendar, zipfile, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))          # .../export
CHARTS_DIR = os.path.join(HERE, "charts")


def strip_frontmatter(md):
    """Remove the +++ TOML frontmatter block; return (title, body)."""
    title = "State of the Network"
    m = re.match(r"\s*\+\+\+\s*(.*?)\s*\+\+\+\s*", md, re.S)
    if m:
        tm = re.search(r'title\s*=\s*"(.*?)"', m.group(1))
        if tm:
            title = tm.group(1)
        md = md[m.end():]
    return title, md


def inline(s):
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"\[(.+?)\]\((.+?)\)", r'<a href="\2">\1</a>', s)
    return s


def render_table(rows):
    def cells(r):
        return [c.strip() for c in r.strip().strip("|").split("|")]
    head = cells(rows[0])
    # row 1 is the |---|---| separator when it is only dashes/colons/pipes
    sep = re.sub(r"[\s|]", "", rows[1]) if len(rows) > 1 else ""
    body = rows[2:] if sep and set(sep) <= set("-:") else rows[1:]
    out = ["<table><thead><tr>"]
    out += [f"<th>{inline(c)}</th>" for c in head]
    out.append("</tr></thead><tbody>")
    for r in body:
        out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells(r)) + "</tr>")
    out.append("</tbody></table>")
    return "".join(out)


def md_to_html_body(md):
    # collapse Hugo admonition shortcodes into a sentinel-wrapped block
    md = re.sub(
        r"\{\{<\s*admonition[^>]*>\}\}(.*?)\{\{<\s*/admonition\s*>\}\}",
        lambda mo: "\n\x00ADM\x00" + mo.group(1).strip() + "\x00/ADM\x00\n",
        md, flags=re.S,
    )
    lines = md.split("\n")
    n = len(lines)
    out = []
    i = 0
    while i < n:
        st = lines[i].strip()
        if not st:
            i += 1
            continue
        if "\x00ADM\x00" in st:
            parts, j = [], i
            while j < n and "\x00/ADM\x00" not in lines[j]:
                parts.append(lines[j])
                j += 1
            if j < n:
                parts.append(lines[j])
            text = "\n".join(parts).replace("\x00ADM\x00", "").replace("\x00/ADM\x00", "")
            out.append(f'<div class="admonition">{inline(text.strip())}</div>')
            i = j + 1
            continue
        hm = re.match(r"(#{1,6})\s+(.*)", st)
        if hm:
            lvl = len(hm.group(1))
            out.append(f"<h{lvl}>{inline(hm.group(2))}</h{lvl}>")
            i += 1
            continue
        im = re.match(r"!\[(.*?)\]\((.*?)\)", st)
        if im:
            alt, src = im.group(1), im.group(2)
            cm = re.search(r"(chart-[^/)]+\.png)", src)
            if cm:
                p = os.path.join(CHARTS_DIR, cm.group(1))
                if os.path.exists(p):
                    b64 = base64.b64encode(open(p, "rb").read()).decode()
                    src = f"data:image/png;base64,{b64}"
            out.append(f'<img alt="{alt}" src="{src}">')
            i += 1
            continue
        if st.startswith("|"):
            tbl = []
            while i < n and lines[i].strip().startswith("|"):
                tbl.append(lines[i].strip())
                i += 1
            out.append(render_table(tbl))
            continue
        para = [st]
        i += 1
        while i < n and lines[i].strip() and not lines[i].strip().startswith(("|", "#", "!", "\x00")):
            para.append(lines[i].strip())
            i += 1
        out.append("<p>" + inline(" ".join(para)) + "</p>")
    return "\n".join(out)


PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>
<style>
 body{{font:16px/1.6 -apple-system,Helvetica,Arial,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#222}}
 h1,h2,h3{{color:#111}} h2{{border-bottom:1px solid #eee;padding-top:1rem;margin-top:2rem}}
 table{{border-collapse:collapse;margin:1rem 0;width:100%}}
 th,td{{border:1px solid #ddd;padding:6px 12px;text-align:left}} th{{background:#f6f6f6}}
 img{{max-width:100%;border:1px solid #eee;margin:1rem 0}}
 .admonition{{background:#eef5ff;border-left:4px solid #3b7edb;padding:.6rem 1rem;margin:1rem 0;border-radius:4px}}
 .draftbanner{{background:#fff3cd;border:1px solid #ffe08a;padding:.5rem 1rem;border-radius:4px;font-size:14px}}
</style></head><body>
<div class="draftbanner">Self-contained preview. If the article still has <b>draft = true</b>, flip it to false before publishing; the header banner image is supplied separately.</div>
<h1>{title}</h1>
{body}
</body></html>"""


def main():
    if len(sys.argv) != 3:
        print("usage: python package-report.py <year> <month>")
        sys.exit(1)
    year = int(sys.argv[1])
    month = int(sys.argv[2])
    month_lc = calendar.month_name[month].lower()          # e.g. "june"
    month_cap = calendar.month_name[month]                 # e.g. "June"

    md_path = os.path.join(HERE, f"swarm-state-of-the-network-{month_lc}-{year}.md")
    if not os.path.exists(md_path):
        print(f"error: article not found at {md_path} — run the /sotn draft step first.")
        sys.exit(1)

    md = open(md_path, encoding="utf-8").read()
    title, body = strip_frontmatter(md)
    html = PAGE.format(title=title, body=md_to_html_body(body))

    # charts for this month
    charts = sorted(
        f for f in os.listdir(CHARTS_DIR)
        if f.endswith(".png") and f"-{month_cap}-{year}" in f
    ) if os.path.isdir(CHARTS_DIR) else []
    if not charts:
        print(f"warning: no charts matching -{month_cap}-{year} in {CHARTS_DIR}")

    stage_root = tempfile.mkdtemp()
    stage = os.path.join(stage_root, f"sotn-{month_lc}-{year}")
    os.makedirs(os.path.join(stage, "charts"))
    shutil.copy2(md_path, stage)
    for c in charts:
        shutil.copy2(os.path.join(CHARTS_DIR, c), os.path.join(stage, "charts", c))
    preview_name = f"swarm-state-of-the-network-{month_lc}-{year}-preview.html"
    open(os.path.join(stage, preview_name), "w", encoding="utf-8").write(html)

    dest = os.path.join(HERE, f"swarm-sotn-{month_lc}-{year}.zip")
    if os.path.exists(dest):
        os.remove(dest)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(stage):
            for f in files:
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, stage_root))
    shutil.rmtree(stage_root)

    print(f"Packaged {1 + len(charts) + 1} files -> {dest}")
    print(f"  - swarm-state-of-the-network-{month_lc}-{year}.md")
    print(f"  - charts/ ({len(charts)} PNGs)")
    print(f"  - {preview_name} (self-contained, charts embedded)")


if __name__ == "__main__":
    main()
