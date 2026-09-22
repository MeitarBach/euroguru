"""
Promote verified data from the dev bucket to the prod bucket.

The workflow this supports:

    1. games are played, or code changes
    2. run_dev_fetch.py writes to the DEV bucket; the local app reads it
    3. you look at the local app and confirm it is right
    4. promote.py re-checks that mechanically, then copies to PROD
    5. the deployed app, which reads PROD, picks it up

Prod is therefore only ever written by this script, and only with data that has
already rendered correctly somewhere else. Nothing here fetches from an upstream
API - promoting is a copy of bytes that were already reviewed.

    python promote.py --check     # run the checks, copy nothing
    python promote.py --plan      # show what would change
    python promote.py             # check, plan, confirm, copy
    python promote.py --yes       # same without the confirmation prompt

Copies are server-side (S3 CopyObject), so nothing is downloaded and re-uploaded
and the object cannot be corrupted in transit.
"""

import argparse
import io
import os
import re
import sys

import pandas as pd
from botocore.exceptions import ClientError

from utils.s3_utils import get_s3_client, BUCKET_NAME

DEV_BUCKET = os.environ.get("DEV_BUCKET_NAME", BUCKET_NAME)
PROD_BUCKET = os.environ.get("PROD_BUCKET_NAME", "euroguru-prod")

# Exactly the keys the running app reads - see data_processing._resolve_cr_key,
# _load_first_available and _build_merged_frame, plus cr_history and the schedule.
# defense_vs_position_*.csv is deliberately absent: the fetcher writes it but
# nothing in the codebase has ever read it back. So is the undated legacy
# player_cr_data.csv, which _CR_KEY_RE is written to never match.
PROMOTE_PATTERNS = [
    re.compile(r"^player_stats_\d{4}\.csv$"),
    re.compile(r"^player_stats_fantasy_\d{4}\.csv$"),
    re.compile(r"^player_cr_data_\d{4}-\d{2}-\d{2}\.csv$"),
    re.compile(r"^cr_history_\d{4}\.csv$"),
    re.compile(r"^schedule_\d{4}\.csv$"),
    re.compile(r"^injury_report\.csv$"),
]

# Files the app treats as append-only. A shrink here means something went wrong
# upstream, which is exactly how a rate-limited backfill once replaced 9,301 rows
# with 1,842. Promote is the last point where that can be caught before users see it.
APPEND_ONLY = re.compile(r"^(player_stats_|cr_history_)")


def _promotable(key):
    return any(p.match(key) for p in PROMOTE_PATTERNS)


def _listing(bucket):
    """{key: {size, etag}} for the promotable keys in a bucket."""
    client = get_s3_client()
    out = {}
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            if _promotable(obj["Key"]):
                out[obj["Key"]] = {"size": obj["Size"], "etag": obj["ETag"].strip('"')}
    return out


def _row_count(bucket, key):
    """Rows in a stored CSV, or None if it cannot be read."""
    try:
        body = get_s3_client().get_object(Bucket=bucket, Key=key)["Body"].read()
        return len(pd.read_csv(io.BytesIO(body)))
    except (ClientError, Exception):
        return None


# --------------------------------------------------------------------------- checks


def check_dev():
    """
    Confirm the dev bucket actually serves a working app before anything is copied.

    This is the mechanical half of "I looked at it and it was fine": it exercises the
    same code path the API uses, for every season, and reports what a user would see.
    Returns (ok, lines).
    """
    from main import DATA_FILES
    from utils.data_processing import load_and_merge_data, score_metric

    if BUCKET_NAME != DEV_BUCKET:
        return False, [
            f"BUCKET_NAME is {BUCKET_NAME!r}, not the dev bucket {DEV_BUCKET!r}.",
            "Checks must run against dev. Fix backend/.env before promoting.",
        ]

    lines, ok = [], True
    for season, candidates in sorted(DATA_FILES.items()):
        try:
            df = load_and_merge_data(candidates, include_injuries=True, season=season)
        except FileNotFoundError as e:
            # A season with no stats file at all is a known gap, not a regression.
            lines.append(f"  {season}  SKIP   {e}")
            continue
        except Exception as e:
            lines.append(f"  {season}  FAIL   {type(e).__name__}: {e}")
            ok = False
            continue

        if df.empty:
            lines.append(f"  {season}  SKIP   no rows (season not in S3)")
            continue

        played = df[df["GameCode"].notna()]
        priced = int(df["CR"].notna().sum())
        note = f"{len(df):>6,} rows  {df['PlayerName'].nunique():>4} players  {priced:>4} priced"

        # An unpriced season renders as an empty table, and a season whose rows carry
        # no score renders as a table of dashes. Both are "loads fine, shows nothing".
        if priced == 0:
            lines.append(f"  {season}  FAIL   {note}  - no player has a CR")
            ok = False
            continue

        # Priced players with no games at all. Not a failure - a season that has not
        # tipped off looks exactly like this - but it is not "ok" either: the tables
        # render with every stat blank. Called out so it cannot be mistaken for
        # healthy data on the way to prod.
        if played.empty:
            lines.append(f"  {season}  EMPTY  {note}  - priced, but no games played")
            continue

        if played["Score"].notna().sum() == 0:
            lines.append(f"  {season}  FAIL   {note}  - no row has a Score")
            ok = False
            continue

        extra = f"{played['GameCode'].nunique():>3} games  metric={score_metric(df)}"
        if "Opponent" in df.columns:
            filled = played["Opponent"].notna().mean() * 100
            extra += f"  opponent={filled:.0f}%"
            if filled < 99:
                lines.append(f"  {season}  WARN   {note}  {extra}")
                continue
        lines.append(f"  {season}  ok     {note}  {extra}")

    return ok, lines


# ---------------------------------------------------------------------------- plan


def build_plan(allow_shrink=False):
    """
    Work out what promoting would change. Returns (actions, blockers).

    Identical ETags mean the object is already promoted byte for byte, so a repeat
    run copies nothing. Nothing is ever deleted from prod: a key that exists there
    and not in dev is left alone rather than treated as a removal.
    """
    dev, prod = _listing(DEV_BUCKET), _listing(PROD_BUCKET)
    actions, blockers = [], []

    for key in sorted(dev):
        before = prod.get(key)
        if before is None:
            actions.append(("add", key, f"{dev[key]['size']:,} bytes"))
            continue
        if before["etag"] == dev[key]["etag"]:
            continue

        delta = dev[key]["size"] - before["size"]
        detail = f"{before['size']:,} -> {dev[key]['size']:,} bytes ({delta:+,})"

        # Only pay for row counts when the file got smaller - that is the case worth
        # describing precisely, and it is rare.
        if delta < 0:
            dev_rows, prod_rows = _row_count(DEV_BUCKET, key), _row_count(PROD_BUCKET, key)
            if dev_rows is not None and prod_rows is not None:
                pct = (dev_rows - prod_rows) / prod_rows * 100 if prod_rows else 0
                detail = f"{prod_rows:,} -> {dev_rows:,} rows ({pct:+.1f}%)"
                if dev_rows < prod_rows and APPEND_ONLY.match(key) and not allow_shrink:
                    blockers.append((key, detail))
                    continue
        actions.append(("update", key, detail))

    only_prod = sorted(set(prod) - set(dev))
    return actions, blockers, only_prod


# ------------------------------------------------------------------------- promote


def run(args):
    print(f"dev   {DEV_BUCKET}")
    print(f"prod  {PROD_BUCKET}\n")

    if not args.skip_checks:
        print("Checking the dev bucket serves a working app:")
        ok, lines = check_dev()
        print("\n".join(lines) or "  (nothing to check)")
        print()
        if not ok:
            print("Checks failed. Nothing promoted.")
            print("Fix dev first, or re-run with --skip-checks if you disagree.")
            return 1
    if args.check:
        return 0

    actions, blockers, only_prod = build_plan(allow_shrink=args.allow_shrink)

    if blockers:
        print("BLOCKED - dev has fewer rows than prod for append-only data:\n")
        for key, detail in blockers:
            print(f"  {key}\n    {detail}")
        print("\nThis is what a truncated fetch looks like. Re-run the fetch or")
        print("backfill, or pass --allow-shrink if the shrink is intended.")
        return 1

    if not actions:
        print("prod is already up to date - nothing to copy.")
        return 0

    print(f"{len(actions)} object(s) to promote:\n")
    for verb, key, detail in actions:
        print(f"  {verb:<7} {key:<34} {detail}")
    if only_prod:
        print(f"\n  ({len(only_prod)} object(s) in prod but not dev, left untouched)")

    if args.plan:
        return 0

    if not args.yes:
        print()
        if input(f"Copy these to {PROD_BUCKET}? [y/N] ").strip().lower() != "y":
            print("Cancelled.")
            return 1

    print()
    client = get_s3_client()
    for verb, key, _ in actions:
        client.copy_object(Bucket=PROD_BUCKET, Key=key,
                           CopySource={"Bucket": DEV_BUCKET, "Key": key})
        print(f"  {verb:<7} {key}")
    print(f"\nPromoted {len(actions)} object(s) to {PROD_BUCKET}.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Promote verified data from dev to prod.")
    parser.add_argument("--check", action="store_true", help="run the checks only")
    parser.add_argument("--plan", action="store_true", help="check and show the plan, copy nothing")
    parser.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    parser.add_argument("--skip-checks", action="store_true", help="promote without checking dev")
    parser.add_argument("--allow-shrink", action="store_true",
                        help="permit an append-only file to lose rows")
    sys.exit(run(parser.parse_args()))
