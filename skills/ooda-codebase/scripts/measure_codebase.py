#!/usr/bin/env python3
"""
OODA Codebase Measurement Tool

Scans a codebase directory and produces a context-fitness report:
- File census with token estimates
- Distribution analysis against budget tiers
- Oversized module identification
- Wiki coverage check

Usage:
    python measure_codebase.py /path/to/project [--budget 65536] [--json]
"""

import argparse
import json
import os
import sys
from pathlib import Path
from collections import defaultdict

SOURCE_EXTENSIONS = {
    ".rs", ".ts", ".tsx", ".js", ".jsx", ".py", ".svelte", ".vue",
    ".go", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp",
}

EXCLUDE_DIRS = {
    "node_modules", "target", ".next", "dist", "build", ".turbo",
    ".venv", "venv", "__pycache__", ".git", ".svn",
}

TOKENS_PER_LINE = 4  # conservative estimate

BUDGET_TIERS = [
    (2000, "<=2k (comfortable)"),
    (8000, "2k-8k (normal)"),
    (16000, "8k-16k (watch)"),
    (28000, "16k-28k (split candidate)"),
    (65000, "28k-65k (hard split)"),
    (float("inf"), ">65k (critical)"),
]


def should_exclude(path: Path) -> bool:
    return any(part in EXCLUDE_DIRS for part in path.parts)


def scan_files(root: Path) -> list[dict]:
    files = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        # Prune excluded directories in-place
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fname in filenames:
            fpath = Path(dirpath) / fname
            if fpath.suffix not in SOURCE_EXTENSIONS:
                continue
            try:
                rel = fpath.relative_to(root)
            except ValueError:
                continue
            try:
                line_count = sum(1 for _ in open(fpath, "r", errors="replace"))
            except (OSError, PermissionError):
                continue
            token_est = line_count * TOKENS_PER_LINE
            files.append({
                "path": str(rel),
                "lines": line_count,
                "tokens": token_est,
                "suffix": fpath.suffix,
            })
    files.sort(key=lambda f: f["tokens"], reverse=True)
    return files


def bucket_files(files: list[dict]) -> dict:
    buckets = defaultdict(list)
    for f in files:
        for threshold, label in BUDGET_TIERS:
            if f["tokens"] <= threshold:
                buckets[label].append(f)
                break
    return dict(buckets)


def check_wiki(root: Path) -> dict:
    wiki_files = []
    for name in ["WIKI.md", "ARCHITECTURE.md", "wiki.md", "architecture.md"]:
        p = root / name
        if p.exists():
            wiki_files.append(str(p.relative_to(root)))
    docs_dir = root / "docs"
    if docs_dir.is_dir():
        for p in docs_dir.rglob("*.md"):
            wiki_files.append(str(p.relative_to(root)))
    return {
        "wiki_files": wiki_files,
        "has_wiki": len(wiki_files) > 0,
    }


def generate_report(root: Path, budget: int) -> dict:
    files = scan_files(root)
    buckets = bucket_files(files)
    wiki = check_wiki(root)

    total_tokens = sum(f["tokens"] for f in files)
    total_lines = sum(f["lines"] for f in files)

    # Code budget is roughly 25% of total context budget
    code_budget = int(budget * 0.25)
    fits_budget = sum(1 for f in files if f["tokens"] <= code_budget)

    oversized = [f for f in files if f["tokens"] > code_budget]
    oversized.sort(key=lambda f: f["tokens"], reverse=True)

    return {
        "project": str(root),
        "budget": budget,
        "code_budget": code_budget,
        "summary": {
            "total_files": len(files),
            "total_lines": total_lines,
            "total_tokens": total_tokens,
            "fits_code_budget": fits_budget,
            "fits_percentage": round(fits_budget / max(1, len(files)) * 100, 1),
        },
        "distribution": {
            label: len(bucket_files)
            for label, bucket_files in buckets.items()
        },
        "oversized": oversized[:20],
        "wiki": wiki,
    }


def print_report(report: dict) -> None:
    s = report["summary"]
    print(f"\n{'='*60}")
    print(f"OODA CODEBASE MEASUREMENT: {report['project']}")
    print(f"{'='*60}")
    print(f"Context budget: {report['budget']:,} tokens")
    print(f"Code slot budget: {report['code_budget']:,} tokens")
    print(f"")
    print(f"Total files:  {s['total_files']}")
    print(f"Total lines:  {s['total_lines']:,}")
    print(f"Total tokens: {s['total_tokens']:,} (est.)")
    print(f"Fits budget:  {s['fits_code_budget']}/{s['total_files']} ({s['fits_percentage']}%)")
    print(f"")
    print("DISTRIBUTION:")
    for label, count in report["distribution"].items():
        bar = "#" * min(50, count)
        print(f"  {label:30s} {count:4d} {bar}")
    print(f"")
    if report["oversized"]:
        print("OVERSIZED FILES (exceed code budget):")
        for f in report["oversized"]:
            print(f"  {f['tokens']:6d} tok  {f['lines']:5d} lines  {f['path']}")
    else:
        print("NO OVERSIZED FILES. All modules fit the context budget.")
    print(f"")
    w = report["wiki"]
    if w["has_wiki"]:
        print(f"WIKI: found {len(w['wiki_files'])} doc(s): {', '.join(w['wiki_files'])}")
    else:
        print("WIKI: NONE FOUND. No WIKI.md, ARCHITECTURE.md, or docs/ directory.")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(description="OODA Codebase Measurement")
    parser.add_argument("path", help="Path to codebase root")
    parser.add_argument("--budget", type=int, default=65536, help="Context budget in tokens")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    root = Path(args.path).expanduser().resolve()
    if not root.exists():
        parser.error(f"path does not exist: {root}")
    if not root.is_dir():
        parser.error(f"path is not a directory: {root}")

    report = generate_report(root, args.budget)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print_report(report)


if __name__ == "__main__":
    main()
