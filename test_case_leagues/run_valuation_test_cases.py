#!/usr/bin/env python3

import json
from pathlib import Path
import ssl
import sys
import urllib.request

API_KEY = "cse416-team-white_irDXd_L2EmZnKDLOFdQi9cZ7bRKLDgYTZBcy_JAcePs"
BASE_URL = "http://localhost:3001/api/valuations"
TEST_CASES = [
    ("test_case_1", "NEW_before_draft_starts.json"),
    ("test_case_2", "after_10_players_taken.json"),
    ("test_case_3", "after_50_players_taken.json"),
    ("test_case_4", "after_100_players_taken.json"),
    ("test_case_5", "after_130_players.json"),
]
SCRIPT_DIR = Path(__file__).resolve().parent


def load_league(filename: str) -> dict:
    path = SCRIPT_DIR / filename
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def serialize_league_for_api(league: dict) -> dict:
    team_id_by_name = {}
    teams = []

    for index, team in enumerate(league.get("teams", []), start=1):
        team_id = f"team-{index}"
        team_name = team["name"]
        team_id_by_name[team_name] = team_id
        teams.append([team_id, team_name, team.get("budget", 0)])

    taken_players = []
    for player in league.get("taken_players", []):
        taken_players.append(
            [
                player["playerName"],
                team_id_by_name[player["teamName"]],
                player["positionSlot"],
                player["price"],
                player.get("contract", ""),
            ]
        )

    draft_picks = []
    for pick in league.get("draft_picks", []):
        draft_picks.append(
            [
                pick["pickNumber"],
                team_id_by_name[pick["nominatingTeamName"]],
                team_id_by_name[pick["winningTeamName"]],
                pick["playerName"],
                pick["salary"],
            ]
        )

    payload = {
        "name": league["name"],
        "format": league["format"],
        "draftType": league["draftType"],
        "battingCategories": league["battingCategories"],
        "pitchingCategories": league["pitchingCategories"],
        "rosterSlots": {
            "C": league["rosterSlots"].get("C", 0),
            "1B": league["rosterSlots"].get("1B", 0),
            "2B": league["rosterSlots"].get("2B", 0),
            "3B": league["rosterSlots"].get("3B", 0),
            "SS": league["rosterSlots"].get("SS", 0),
            "OF": league["rosterSlots"].get("OF", 0),
            "DH": league["rosterSlots"].get("DH", 0),
            "SP": league["rosterSlots"].get("SP", 0),
            "RP": league["rosterSlots"].get("RP", 0),
            "UTIL": league["rosterSlots"].get("UTIL", 0),
            "BENCH": league["rosterSlots"].get("BENCH", 0),
        },
        "totalBudget": league.get("totalBudget"),
        "teams": teams,
        "taken_players": taken_players,
        "draft_picks": draft_picks,
    }

    if league.get("description") is not None:
        payload["description"] = league["description"]

    if league.get("categoryWeights") is not None:
        payload["categoryWeights"] = league["categoryWeights"]

    return payload


def fetch_valuation(league: dict, player_name: str) -> dict:
    body = json.dumps(
        {
            "league": serialize_league_for_api(league),
            "query": {
                "name": player_name,
                "limit": 1,
            },
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        BASE_URL,
        data=body,
        method="POST",
        headers={
            "x-api-key": API_KEY,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )

    with urllib.request.urlopen(
        request,
        timeout=15,
        context=ssl._create_unverified_context(),
    ) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "Usage: python3 test_case_leagues/run_valuation_test_cases.py"
            ' "Player Name"',
            file=sys.stderr,
        )
        return 1

    player_name = " ".join(sys.argv[1:])

    print("=" * 60)
    print(f"Player: {player_name}")
    print("=" * 60)

    for test_case_name, league_filename in TEST_CASES:
        league = load_league(league_filename)
        payload = fetch_valuation(league, player_name)

        data = payload.get("data", {})
        valuations = data.get("valuations", [])
        valuation = valuations[0] if valuations else {}

        league_name = league.get("name")
        taken_players = league.get("taken_players", [])
        taken_player_count = len(taken_players)

        dollar_value = valuation.get("dollarValue")
        matched_name = valuation.get("name")
        positions = valuation.get("positions", [])
        team = valuation.get("team")

        print(f"\n[{test_case_name}]")
        print(f"League Name : {league_name}")
        print(f"League File : {league_filename}")
        print(f"Taken Count : {taken_player_count}")
        print(f"Matched Name: {matched_name}")
        print(f"Positions   : {', '.join(positions) if positions else None}")
        print(f"Team        : {team}")
        print(f"Dollar Value: {dollar_value}")

        if not valuations:
            print("Status      : No valuation found")
    print("\n" + "=" * 60)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
