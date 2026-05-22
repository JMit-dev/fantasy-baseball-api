#!/usr/bin/env python3

import json
import os
import random
from pathlib import Path

from compare_final_roster_to_api import (
    DEFAULT_API_KEY,
    DEFAULT_BASE_URL,
    extract_valuation_result,
    normalize_name,
    open_request_with_retry,
)
import urllib.request

SCRIPT_DIR = Path(__file__).resolve().parent
FINAL_JSON_PATH = SCRIPT_DIR / "after_130_players.json"
OUTPUT_SAMPLE_JSON_PATH = SCRIPT_DIR / "final_roster_sample_vs_api_values.json"
DEFAULT_SAMPLE_SIZE = 15
DEFAULT_SEED = 42


def load_league() -> dict:
    return json.loads(FINAL_JSON_PATH.read_text(encoding="utf-8"))


def sample_players(league: dict, sample_size: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    players = [
        player
        for player in league.get("taken_players", [])
        if not player["positionSlot"].startswith("MiLB-")
        and not player["positionSlot"].startswith("TAXI-")
    ]
    if sample_size >= len(players):
        return list(players)
    return rng.sample(players, sample_size)


def serialize_league_for_api(league: dict) -> dict:
    team_id_by_name: dict[str, str] = {}
    teams = []

    for index, team in enumerate(league.get("teams", []), start=1):
        team_id = f"team-{index}"
        team_id_by_name[team["name"]] = team_id
        teams.append([team_id, team["name"], team.get("budget", 0)])

    taken_players = [
        [
            player["playerName"],
            team_id_by_name[player["teamName"]],
            player["positionSlot"],
            player["price"],
            player.get("contract", ""),
        ]
        for player in league.get("taken_players", [])
        if player["teamName"] in team_id_by_name
    ]

    roster_slots = league.get("rosterSlots", {})

    payload = {
        "name": league["name"],
        "format": league["format"],
        "draftType": league["draftType"],
        "battingCategories": league["battingCategories"],
        "pitchingCategories": league["pitchingCategories"],
        "rosterSlots": {
            "C": roster_slots.get("C", 0),
            "1B": roster_slots.get("1B", 0),
            "2B": roster_slots.get("2B", 0),
            "3B": roster_slots.get("3B", 0),
            "SS": roster_slots.get("SS", 0),
            "CI": roster_slots.get("CI", 0),
            "MI": roster_slots.get("MI", 0),
            "OF": roster_slots.get("OF", 0),
            "DH": roster_slots.get("DH", 0),
            "UTIL": roster_slots.get("UTIL", 0),
            "SP": roster_slots.get("SP", 0),
            "RP": roster_slots.get("RP", 0),
            "P": roster_slots.get("P", 0),
            "BENCH": roster_slots.get("BENCH", 0),
        },
        "totalBudget": league.get("totalBudget"),
        "teams": teams,
        "taken_players": taken_players,
        "draft_picks": [],
    }

    if league.get("description") is not None:
        payload["description"] = league["description"]

    if league.get("categoryWeights") is not None:
        payload["categoryWeights"] = league["categoryWeights"]

    return payload


def compare_sample(league: dict, sampled_players: list[dict]) -> list[dict]:
    api_league = serialize_league_for_api(league)
    comparisons = []

    for player in sampled_players:
        body = json.dumps(
            {
                "league": api_league,
                "query": {
                    "name": player["playerName"],
                    "limit": 1,
                },
            }
        ).encode("utf-8")

        request = urllib.request.Request(
            os.environ.get("API_BASE_URL", DEFAULT_BASE_URL),
            data=body,
            method="POST",
            headers={
                "x-api-key": os.environ.get("API_KEY", DEFAULT_API_KEY),
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )

        with open_request_with_retry(request) as response:
            payload = json.loads(response.read().decode("utf-8"))
        data = extract_valuation_result(payload)
        valuation = next(
            (
                row
                for row in data.get("valuations", [])
                if normalize_name(row.get("name", ""))
                == normalize_name(player["playerName"])
            ),
            None,
        )
        if not valuation:
            continue

        if valuation.get("injuryStatus") and valuation["injuryStatus"] != "active":
            continue

        actual_value = float(player["price"])
        api_value = float(valuation["dollarValue"])
        comparisons.append(
            {
                "teamName": player["teamName"],
                "playerName": player["playerName"],
                "positionSlot": player["positionSlot"],
                "contract": player.get("contract", ""),
                "actualValue": actual_value,
                "valuation": valuation,
                "matchedName": valuation["name"],
                "playerType": valuation["playerType"],
                "positions": valuation["positions"],
                "age": valuation.get("age"),
                "depthChartStatus": valuation.get("depthChartStatus"),
                "depthChartOrder": valuation.get("depthChartOrder"),
                "injuryStatus": valuation.get("injuryStatus"),
                "baseValue": valuation.get("baseValue"),
                "dollarValue": valuation.get("dollarValue"),
                "averagedStats": valuation.get("averagedStats"),
                "multipliers": valuation.get("multipliers"),
                "draftable": valuation.get("draftable"),
                "draftableReason": valuation.get("draftableReason"),
                "apiValue": api_value,
                "difference": round(api_value - actual_value, 2),
                "absDifference": round(abs(api_value - actual_value), 2),
            }
        )

    comparisons.sort(key=lambda row: -row["absDifference"])
    return comparisons


def print_summary(rows: list[dict], sample_size: int, seed: int) -> None:
    print(f"Sample Size: {sample_size}")
    print(f"Seed: {seed}")
    print()

    for row in rows:
        positions = "/".join(row["positions"])
        print(
            f"{row['playerType']:<7} {row['teamName']:<8} {row['playerName']:<28} "
            f"{positions:<10} actual={row['actualValue']:.2f} "
            f"api={row['apiValue']:.2f} diff={row['difference']:.2f} "
            f"absDiff={row['absDifference']:.2f}"
        )

    print()
    for title, group in (
        ("Hitters", [row for row in rows if row["playerType"] == "hitter"]),
        ("Pitchers", [row for row in rows if row["playerType"] == "pitcher"]),
        ("All Players", rows),
    ):
        actual_total = sum(row["actualValue"] for row in group)
        api_total = sum(row["apiValue"] for row in group)
        net_diff = api_total - actual_total
        abs_diff = sum(row["absDifference"] for row in group)
        mean_abs = abs_diff / len(group) if group else 0.0
        print(
            f"{title}: actual={actual_total:.2f} api={api_total:.2f} "
            f"netDiff={net_diff:.2f} absDiff={abs_diff:.2f} meanAbsDiff={mean_abs:.2f}"
        )

    print()
    print(f"JSON: {OUTPUT_SAMPLE_JSON_PATH}")


def main() -> int:
    sample_size = int(os.environ.get("SAMPLE_SIZE", DEFAULT_SAMPLE_SIZE))
    seed = int(os.environ.get("SAMPLE_SEED", DEFAULT_SEED))

    base_url = os.environ.get("API_BASE_URL", DEFAULT_BASE_URL)
    api_key = os.environ.get("API_KEY", DEFAULT_API_KEY)

    import compare_final_roster_to_api as compare_module

    compare_module.BASE_URL = base_url
    compare_module.API_KEY = api_key

    league = load_league()
    sampled_players = sample_players(league, sample_size, seed)
    comparisons = compare_sample(league, sampled_players)

    OUTPUT_SAMPLE_JSON_PATH.write_text(
        json.dumps(comparisons, indent=2) + "\n",
        encoding="utf-8",
    )
    print_summary(comparisons, len(sampled_players), seed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
