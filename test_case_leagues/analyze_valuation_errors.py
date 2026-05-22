#!/usr/bin/env python3

import csv
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path


def normalize_scalar(value):
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, list):
        return tuple(value)
    return value


def load_rows(path: Path) -> list[dict]:
    if path.suffix.lower() == ".json":
        rows = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(rows, list):
            raise RuntimeError("JSON input must be a list of comparison rows")
        return rows

    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8", newline="") as handle:
            return list(csv.DictReader(handle))

    raise RuntimeError("Input must be a .json or .csv file")


def as_float(value):
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def flatten(prefix: str, value, out: dict):
    if isinstance(value, dict):
        for key, nested in value.items():
            next_prefix = f"{prefix}.{key}" if prefix else str(key)
            flatten(next_prefix, nested, out)
        return
    if isinstance(value, list):
        if all(not isinstance(item, (dict, list)) for item in value):
            out[prefix] = tuple(value)
        return
    out[prefix] = value


def enrich_row(row: dict) -> dict:
    flat = {}
    flatten("", row, flat)

    positions = row.get("positions") or flat.get("positions") or []
    if isinstance(positions, str):
        positions = [part.strip() for part in positions.split(",") if part.strip()]
    elif isinstance(positions, tuple):
        positions = list(positions)

    if positions:
        flat["primaryPosition"] = positions[0]
        flat["positionsJoined"] = "|".join(positions)

    slot = row.get("positionSlot") or flat.get("positionSlot")
    if isinstance(slot, str) and "-" in slot:
        flat["slotRoot"] = slot.split("-", 1)[0]
    elif isinstance(slot, str):
        flat["slotRoot"] = slot

    age = as_float(flat.get("age"))
    if age is not None:
        if age <= 24:
            flat["ageBucket"] = "<=24"
        elif age <= 27:
            flat["ageBucket"] = "25-27"
        elif age <= 30:
            flat["ageBucket"] = "28-30"
        elif age <= 33:
            flat["ageBucket"] = "31-33"
        else:
            flat["ageBucket"] = "34+"

    diff = as_float(row.get("difference") or flat.get("difference"))
    abs_diff = as_float(row.get("absDifference") or flat.get("absDifference"))
    flat["difference"] = diff
    flat["absDifference"] = abs_diff
    flat["actualValue"] = as_float(row.get("actualValue") or flat.get("actualValue"))
    flat["apiValue"] = as_float(row.get("apiValue") or flat.get("apiValue"))
    return flat


def filter_healthy(rows: list[dict]) -> list[dict]:
    healthy = []
    for row in rows:
        status = row.get("injuryStatus")
        if status in (None, "", "active"):
            healthy.append(row)
    return healthy


def summarize_group(rows: list[dict]) -> dict:
    diffs = [row["difference"] for row in rows if row["difference"] is not None]
    abs_diffs = [
        row["absDifference"] for row in rows if row["absDifference"] is not None
    ]
    actuals = [row["actualValue"] for row in rows if row["actualValue"] is not None]
    apis = [row["apiValue"] for row in rows if row["apiValue"] is not None]
    return {
        "count": len(rows),
        "actualTotal": round(sum(actuals), 2),
        "apiTotal": round(sum(apis), 2),
        "netDiff": round(sum(diffs), 2),
        "meanDiff": round(sum(diffs) / len(diffs), 2) if diffs else 0.0,
        "absDiffTotal": round(sum(abs_diffs), 2),
        "meanAbsDiff": round(sum(abs_diffs) / len(abs_diffs), 2) if abs_diffs else 0.0,
        "maxAbsDiff": round(max(abs_diffs), 2) if abs_diffs else 0.0,
    }


def top_players(rows: list[dict], reverse: bool, limit: int = 15) -> list[dict]:
    sorted_rows = sorted(
        rows,
        key=lambda row: row["difference"] if row["difference"] is not None else 0.0,
        reverse=reverse,
    )
    result = []
    for row in sorted_rows[:limit]:
        result.append(
            {
                "playerName": row.get("playerName"),
                "teamName": row.get("teamName"),
                "positions": row.get("positions"),
                "actualValue": row.get("actualValue"),
                "apiValue": row.get("apiValue"),
                "difference": row.get("difference"),
                "absDifference": row.get("absDifference"),
                "age": row.get("age"),
                "depthChartStatus": row.get("depthChartStatus"),
                "depthChartOrder": row.get("depthChartOrder"),
            }
        )
    return result


def group_by_categorical(rows: list[dict], key: str, min_count: int = 3) -> list[dict]:
    groups = defaultdict(list)
    for row in rows:
        value = normalize_scalar(row.get(key))
        if value in (None, "", (), []):
            continue
        groups[value].append(row)

    summaries = []
    for value, items in groups.items():
        if len(items) < min_count:
            continue
        summary = summarize_group(items)
        summary["value"] = list(value) if isinstance(value, tuple) else value
        summaries.append(summary)

    summaries.sort(key=lambda item: item["meanAbsDiff"], reverse=True)
    return summaries


def numeric_correlation(rows: list[dict], key: str) -> dict | None:
    pairs = []
    for row in rows:
        x = as_float(row.get(key))
        y = row.get("difference")
        ay = row.get("absDifference")
        if x is None or y is None or ay is None:
            continue
        pairs.append((x, y, ay))

    if len(pairs) < 5:
        return None

    xs = [x for x, _, _ in pairs]
    ys = [y for _, y, _ in pairs]
    ays = [ay for _, _, ay in pairs]
    mean_x = statistics.mean(xs)
    mean_y = statistics.mean(ys)
    mean_ay = statistics.mean(ays)

    def corr(a, b, mean_a, mean_b):
        num = sum((x - mean_a) * (y - mean_b) for x, y in zip(a, b))
        den_a = math.sqrt(sum((x - mean_a) ** 2 for x in a))
        den_b = math.sqrt(sum((y - mean_b) ** 2 for y in b))
        if den_a == 0 or den_b == 0:
            return 0.0
        return num / (den_a * den_b)

    return {
        "count": len(pairs),
        "corrWithDiff": round(corr(xs, ys, mean_x, mean_y), 3),
        "corrWithAbsDiff": round(corr(xs, ays, mean_x, mean_ay), 3),
        "meanFeature": round(mean_x, 3),
    }


def quartile_buckets(rows: list[dict], key: str) -> list[dict]:
    values = sorted(
        as_float(row.get(key)) for row in rows if as_float(row.get(key)) is not None
    )
    if len(values) < 8:
        return []

    def percentile(p: float) -> float:
        index = (len(values) - 1) * p
        lower = math.floor(index)
        upper = math.ceil(index)
        if lower == upper:
            return values[lower]
        frac = index - lower
        return values[lower] * (1 - frac) + values[upper] * frac

    q1, q2, q3 = percentile(0.25), percentile(0.5), percentile(0.75)

    buckets = {
        f"<=Q1({q1:.2f})": [],
        f"Q1-Q2": [],
        f"Q2-Q3": [],
        f">Q3({q3:.2f})": [],
    }
    for row in rows:
        value = as_float(row.get(key))
        if value is None:
            continue
        if value <= q1:
            buckets[f"<=Q1({q1:.2f})"].append(row)
        elif value <= q2:
            buckets["Q1-Q2"].append(row)
        elif value <= q3:
            buckets["Q2-Q3"].append(row)
        else:
            buckets[f">Q3({q3:.2f})"].append(row)

    summaries = []
    for label, items in buckets.items():
        if not items:
            continue
        summary = summarize_group(items)
        summary["value"] = label
        summaries.append(summary)
    return summaries


def build_report(rows: list[dict]) -> dict:
    healthy_rows = filter_healthy([enrich_row(row) for row in rows])
    numeric_keys = sorted(
        key
        for key in healthy_rows[0].keys()
        if healthy_rows
        and as_float(healthy_rows[0].get(key)) is not None
        and key not in {"difference", "absDifference", "actualValue", "apiValue"}
    )

    categorical_priority = [
        "playerType",
        "primaryPosition",
        "positionsJoined",
        "slotRoot",
        "contract",
        "ageBucket",
        "depthChartStatus",
        "depthChartOrder",
        "draftable",
        "draftableReason",
        "team",
    ]

    for key in healthy_rows[0].keys():
        if (
            key.startswith("multipliers.")
            or key.startswith("valuation.averagedStats.")
            or key.startswith("averagedStats.")
        ):
            if key not in numeric_keys and key not in categorical_priority:
                categorical_priority.append(key)

    categorical_analysis = {}
    for key in categorical_priority:
        summaries = group_by_categorical(healthy_rows, key)
        if summaries:
            categorical_analysis[key] = summaries[:20]

    numeric_analysis = {}
    for key in sorted(set(numeric_keys)):
        corr = numeric_correlation(healthy_rows, key)
        buckets = quartile_buckets(healthy_rows, key)
        if corr or buckets:
            numeric_analysis[key] = {
                "correlation": corr,
                "buckets": buckets,
            }

    return {
        "summary": summarize_group(healthy_rows),
        "healthyCount": len(healthy_rows),
        "topOvervalued": top_players(healthy_rows, reverse=True),
        "topUndervalued": top_players(healthy_rows, reverse=False),
        "categoricalAnalysis": categorical_analysis,
        "numericAnalysis": numeric_analysis,
    }


def print_report(report: dict) -> None:
    summary = report["summary"]
    print("Summary")
    print("-------")
    print(
        f"healthyCount={report['healthyCount']} "
        f"actual={summary['actualTotal']:.2f} api={summary['apiTotal']:.2f} "
        f"netDiff={summary['netDiff']:.2f} meanDiff={summary['meanDiff']:.2f} "
        f"absDiff={summary['absDiffTotal']:.2f} meanAbsDiff={summary['meanAbsDiff']:.2f} "
        f"maxAbsDiff={summary['maxAbsDiff']:.2f}"
    )
    print()

    print("Top Undervalued")
    print("---------------")
    for row in report["topUndervalued"][:10]:
        print(
            f"{row['playerName']:<28} {str(row['positions']):<16} "
            f"actual={row['actualValue']:.2f} api={row['apiValue']:.2f} diff={row['difference']:.2f}"
        )
    print()

    print("Top Overvalued")
    print("--------------")
    for row in report["topOvervalued"][:10]:
        print(
            f"{row['playerName']:<28} {str(row['positions']):<16} "
            f"actual={row['actualValue']:.2f} api={row['apiValue']:.2f} diff={row['difference']:.2f}"
        )
    print()

    print("Categorical Groups")
    print("------------------")
    for key, groups in report["categoricalAnalysis"].items():
        print(key)
        for group in groups[:8]:
            print(
                f"  {group['value']}: count={group['count']} "
                f"netDiff={group['netDiff']:.2f} meanAbsDiff={group['meanAbsDiff']:.2f} "
                f"maxAbsDiff={group['maxAbsDiff']:.2f}"
            )
        print()

    print("Numeric Features")
    print("----------------")
    for key, data in report["numericAnalysis"].items():
        corr = data["correlation"]
        if corr:
            print(
                f"{key}: corrDiff={corr['corrWithDiff']:.3f} "
                f"corrAbsDiff={corr['corrWithAbsDiff']:.3f} "
                f"count={corr['count']}"
            )
            for bucket in data["buckets"][:4]:
                print(
                    f"  {bucket['value']}: count={bucket['count']} "
                    f"netDiff={bucket['netDiff']:.2f} meanAbsDiff={bucket['meanAbsDiff']:.2f}"
                )
            print()


def main() -> int:
    input_file = "final_roster_vs_api_values.csv"
    input_path = Path(input_file).resolve()
    rows = load_rows(input_path)
    if not rows:
        print("No rows found")
        return 1

    report = build_report(rows)
    output_path = input_path.with_suffix(".analysis.json")
    output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print_report(report)
    print(f"JSON: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
