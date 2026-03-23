#!/usr/bin/env python3
"""
seo_title_generator.py — One-time Walmart SEO title + description generator
=============================================================================
Input CSV columns (required):
  Brand       — e.g. "Cooper"
  Model       — e.g. "Discoverer AT3 4S"
  Size        — e.g. "265/70R17"
  Fits_*      — one or more columns named "Fits_1", "Fits_2", ... "Fits_N"
                containing vehicle names, e.g. "2019-2023 Ford F-150"
                (you can also use a single "Fitment" column — see FITMENT_COLUMN below)

Output CSV columns:
  Brand, Model, Size        — passthrough
  Product Name              — Walmart-ready title (≤ 200 chars)
  Description               — Walmart product description
  (all original columns preserved too)

Usage:
  python3 scripts/seo_title_generator.py \
    --input  data/tires_input.csv \
    --output data/tires_walmart.csv \
    [--fitment-column Fitment]   # if fitment is in one comma-separated column
    [--max-vehicles 3]           # top N vehicles to mention (default 3)
    [--dry-run]                  # print first 5 rows to stdout, no file write

Requirements:
  pip install pandas
"""

import argparse
import sys
import re
import textwrap
import pandas as pd
from pathlib import Path


# ─── CONSTANTS ────────────────────────────────────────────────────────────────

TITLE_MAX_CHARS    = 200
DESC_CANADIAN_NOTE = (
    "Ships from our Canadian warehouse — fast delivery across Canada. "
    "Every tire comes with the GCI AI Fitment Guarantee: our AI matches "
    "this tire to your vehicle before purchase so you can buy with confidence. "
    "Contact us if you have any questions about fitment for your vehicle."
)

# Columns to look for fitment data (in priority order)
FITMENT_COLUMN_OPTIONS = ["Fitment", "Vehicles", "Vehicle Fitment", "fits"]


# ─── HELPERS ──────────────────────────────────────────────────────────────────

def normalise_vehicle(v: str) -> str:
    """Strip leading/trailing whitespace and collapse inner spaces."""
    return re.sub(r"\s+", " ", str(v).strip())


def parse_fitment(row: pd.Series, fitment_column: str | None, max_vehicles: int) -> list[str]:
    """
    Extract up to max_vehicles vehicle strings from the row.

    Supports three input layouts:
      1. Single column (fitment_column arg or auto-detected) with comma-separated values.
      2. Multiple columns named Fits_1, Fits_2, …
      3. Multiple columns named Vehicle_1, Vehicle_2, …
    """
    vehicles: list[str] = []

    # Layout 1 — explicit single column
    if fitment_column and fitment_column in row.index:
        raw = str(row[fitment_column])
        vehicles = [normalise_vehicle(v) for v in raw.split(",") if v.strip()]

    # Layout 1 — auto-detect
    if not vehicles:
        for col in FITMENT_COLUMN_OPTIONS:
            if col in row.index and str(row[col]).strip():
                raw = str(row[col])
                vehicles = [normalise_vehicle(v) for v in raw.split(",") if v.strip()]
                break

    # Layout 2 — Fits_1, Fits_2, …
    if not vehicles:
        for i in range(1, 20):
            col = f"Fits_{i}"
            if col in row.index and str(row[col]).strip():
                vehicles.append(normalise_vehicle(str(row[col])))

    # Layout 3 — Vehicle_1, Vehicle_2, …
    if not vehicles:
        for i in range(1, 20):
            col = f"Vehicle_{i}"
            if col in row.index and str(row[col]).strip():
                vehicles.append(normalise_vehicle(str(row[col])))

    # Deduplicate while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for v in vehicles:
        if v and v not in seen:
            seen.add(v)
            deduped.append(v)

    return deduped[:max_vehicles]


def build_title(brand: str, model: str, size: str, vehicles: list[str]) -> str:
    """
    Build a Walmart-ready product title.

    Formula: [Brand] [Model] [Size] Tire - Fits [Top 3 Vehicles] - GCI AI Fitment Guaranteed
    Hard limit: 200 characters.

    If the full title exceeds 200 chars, vehicles are trimmed one by one
    until it fits. If even the base title without vehicles exceeds 200 chars,
    the title is hard-truncated with a trailing ellipsis.
    """
    suffix  = " - GCI AI Fitment Guaranteed"
    base    = f"{brand} {model} {size} Tire"

    def assemble(vlist: list[str]) -> str:
        if vlist:
            return f"{base} - Fits {', '.join(vlist)}{suffix}"
        return f"{base}{suffix}"

    title = assemble(vehicles)

    # Trim vehicles list until title fits
    v = list(vehicles)
    while len(title) > TITLE_MAX_CHARS and v:
        v.pop()
        title = assemble(v)

    # Hard truncate if still over limit (shouldn't happen with normal data)
    if len(title) > TITLE_MAX_CHARS:
        title = title[: TITLE_MAX_CHARS - 1] + "…"

    return title


def build_description(brand: str, model: str, size: str, vehicles: list[str]) -> str:
    """
    Build a Walmart product description with:
    - Vehicle fitment list
    - Canadian warehouse note
    - GCI AI Fitment Guarantee text
    """
    fitment_sentence = ""
    if vehicles:
        fitment_sentence = f"Compatible vehicles include: {', '.join(vehicles)}. "

    desc = (
        f"The {brand} {model} in size {size} is a high-quality tire "
        f"available exclusively through GCI Tire. "
        f"{fitment_sentence}"
        f"{DESC_CANADIAN_NOTE}"
    )
    return desc


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate Walmart-ready SEO titles and descriptions for tire products.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Examples:
              # Standard run
              python3 scripts/seo_title_generator.py -i data/tires.csv -o data/walmart_tires.csv

              # Single fitment column
              python3 scripts/seo_title_generator.py -i data/tires.csv -o out.csv --fitment-column Fitment

              # Preview first 5 rows without writing
              python3 scripts/seo_title_generator.py -i data/tires.csv --dry-run
        """),
    )
    parser.add_argument("-i", "--input",           required=True,  help="Input CSV file path")
    parser.add_argument("-o", "--output",          default=None,   help="Output CSV file path (default: input_walmart.csv)")
    parser.add_argument("--fitment-column",        default=None,   help="Column name containing comma-separated vehicle fitment")
    parser.add_argument("--max-vehicles",          default=3, type=int, help="Max vehicles to include in title (default: 3)")
    parser.add_argument("--dry-run", action="store_true",          help="Print first 5 rows to stdout, don't write file")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"❌ Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    output_path = Path(args.output) if args.output else input_path.with_stem(input_path.stem + "_walmart")

    # ── Load CSV ────────────────────────────────────────────────────────────────
    try:
        df = pd.read_csv(input_path, dtype=str).fillna("")
    except Exception as e:
        print(f"❌ Failed to read CSV: {e}", file=sys.stderr)
        sys.exit(1)

    # Validate required columns
    required = ["Brand", "Model", "Size"]
    missing  = [c for c in required if c not in df.columns]
    if missing:
        print(f"❌ Missing required columns: {', '.join(missing)}", file=sys.stderr)
        print(f"   Found columns: {', '.join(df.columns.tolist())}", file=sys.stderr)
        sys.exit(1)

    print(f"📂 Loaded {len(df)} rows from {input_path}")

    # ── Generate titles and descriptions ────────────────────────────────────────
    titles:       list[str] = []
    descriptions: list[str] = []
    title_lengths:list[int] = []
    truncated:    int = 0

    for _, row in df.iterrows():
        brand = str(row["Brand"]).strip()
        model = str(row["Model"]).strip()
        size  = str(row["Size"]).strip()

        vehicles = parse_fitment(row, args.fitment_column, args.max_vehicles)
        title    = build_title(brand, model, size, vehicles)
        desc     = build_description(brand, model, size, vehicles)

        if len(title) == TITLE_MAX_CHARS or title.endswith("…"):
            truncated += 1

        titles.append(title)
        descriptions.append(desc)
        title_lengths.append(len(title))

    df["Product Name"] = titles
    df["Description"]  = descriptions

    # ── Stats ────────────────────────────────────────────────────────────────────
    avg_len = sum(title_lengths) / len(title_lengths) if title_lengths else 0
    max_len = max(title_lengths, default=0)
    over    = sum(1 for l in title_lengths if l > TITLE_MAX_CHARS)

    print(f"✅ Titles generated: {len(df)}")
    print(f"   Avg title length : {avg_len:.0f} chars")
    print(f"   Max title length : {max_len} chars")
    print(f"   Truncated titles : {truncated}")
    print(f"   Over 200 chars   : {over} (should be 0)")

    # ── Dry run ──────────────────────────────────────────────────────────────────
    if args.dry_run:
        print("\n── DRY RUN: First 5 rows ──")
        preview = df[["Brand", "Model", "Size", "Product Name", "Description"]].head(5)
        for idx, row in preview.iterrows():
            print(f"\nRow {idx + 1}:")
            print(f"  Product Name ({len(row['Product Name'])} chars):")
            print(f"    {row['Product Name']}")
            print(f"  Description ({len(row['Description'])} chars):")
            print(f"    {row['Description'][:120]}…")
        print("\nNo file written (--dry-run mode).")
        return

    # ── Write output ─────────────────────────────────────────────────────────────
    try:
        df.to_csv(output_path, index=False, encoding="utf-8-sig")  # utf-8-sig for Excel compatibility
        print(f"💾 Output written to: {output_path}")
    except Exception as e:
        print(f"❌ Failed to write output: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
