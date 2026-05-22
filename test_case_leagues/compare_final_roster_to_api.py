#!/usr/bin/env python3

import csv
import json
from collections import defaultdict
from dataclasses import dataclass
import os
import re
from pathlib import Path
import ssl
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

DEFAULT_API_KEY = "cse416-team-white_irDXd_L2EmZnKDLOFdQi9cZ7bRKLDgYTZBcy_JAcePs"
DEFAULT_BASE_URL = "https://fantasy-baseball-api.onrender.com/api/valuations"
API_KEY = DEFAULT_API_KEY
BASE_URL = DEFAULT_BASE_URL
SCRIPT_DIR = Path(__file__).resolve().parent
WORKBOOK_PATH = SCRIPT_DIR / "Draft Test Cases.xlsx"
FINAL_JSON_PATH = SCRIPT_DIR / "after_130_players.json"
OUTPUT_JSON_PATH = SCRIPT_DIR / "final_roster_vs_api_values.json"
OUTPUT_CSV_PATH = SCRIPT_DIR / "final_roster_vs_api_values.csv"
SKIPPED_JSON_PATH = SCRIPT_DIR / "final_roster_skipped_players.json"
NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
TEAM_BLOCK_COLUMNS = [
    ("A", "D"),
    ("E", "H"),
    ("I", "L"),
    ("M", "P"),
    ("Q", "T"),
]
SLOT_ORDER = {
    "C": 0,
    "1B": 1,
    "3B": 2,
    "CI": 3,
    "2B": 4,
    "SS": 5,
    "MI": 6,
    "OF": 7,
    "U": 8,
    "UTIL": 8,
    "P": 9,
}
PLAYER_CANDIDATE_CACHE: dict[str, list[dict]] = {}


@dataclass
class WorkbookRosterRow:
    team_name: str
    slot_label: str
    slot_base: str
    abbreviated_name: str
    contract: str
    actual_value: float


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def load_league(filename: Path) -> dict:
    with filename.open("r", encoding="utf-8") as handle:
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
        try:
            player_id, player_name = resolve_player_identity(
                player["playerName"],
                player["positionSlot"],
            )
        except RuntimeError:
            continue
        taken_players.append(
            [
                player_id,
                team_id_by_name[player["teamName"]],
                player["positionSlot"],
                player["price"],
                player.get("contract", ""),
            ]
        )

    draft_picks = []
    for pick in league.get("draft_picks", []):
        try:
            player_id, _player_name = resolve_player_identity(
                pick["playerName"],
                None,
            )
        except RuntimeError:
            continue
        draft_picks.append(
            [
                pick["pickNumber"],
                team_id_by_name[pick["nominatingTeamName"]],
                team_id_by_name[pick["winningTeamName"]],
                player_id,
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

    with open_request_with_retry(request) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_valuations_page(league: dict, page: int) -> dict:
    body = json.dumps(
        {
            "league": serialize_league_for_api(league),
            "query": {
                "limit": 100,
                "page": page,
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

    with open_request_with_retry(request) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_valuation_result(payload: dict) -> dict:
    data = payload.get("data")
    if isinstance(data, dict) and "valuations" in data:
        return data
    return payload


def fetch_all_valuations(league: dict) -> list[dict]:
    valuations: list[dict] = []
    page = 1

    while True:
        payload = fetch_valuations_page(league, page)
        data = extract_valuation_result(payload)
        page_values = data.get("valuations", [])
        valuations.extend(page_values)
        pagination = data.get("pagination", {})
        total = int(pagination.get("total", 0))
        limit = int(pagination.get("limit", 100))
        if len(valuations) >= total or not page_values:
            break
        if limit <= 0:
            break
        page += 1

    return valuations


def open_request_with_retry(
    request: urllib.request.Request,
    retries: int = 5,
):
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            return urllib.request.urlopen(
                request,
                timeout=30,
                context=ssl._create_unverified_context(),
            )
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            if error.code == 429 and attempt < retries - 1:
                retry_after = error.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    delay = int(retry_after)
                else:
                    delay = 5 * (attempt + 1)
                time.sleep(delay)
                continue
            raise RuntimeError(
                f"HTTP {error.code} from valuations API: {body}"
            ) from error
        except urllib.error.URLError as error:
            last_error = error
            if attempt < retries - 1:
                time.sleep(1 + attempt)
                continue
            raise

    if last_error is not None:
        raise last_error
    raise RuntimeError("Request failed without an exception")


def fetch_player_candidates(search_term: str) -> list[dict]:
    if search_term in PLAYER_CANDIDATE_CACHE:
        return PLAYER_CANDIDATE_CACHE[search_term]

    query = urllib.parse.urlencode({"search": search_term, "limit": 50})
    url = BASE_URL.rsplit("/api/valuations", 1)[0] + f"/api/players?{query}"
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "x-api-key": API_KEY,
            "Accept": "application/json",
        },
    )

    with open_request_with_retry(request) as response:
        payload = json.loads(response.read().decode("utf-8"))
    candidates = payload.get("data", [])
    PLAYER_CANDIDATE_CACHE[search_term] = candidates
    return candidates


def excel_cell_to_value(cell: ET.Element, shared_strings: list[str]) -> str | None:
    cell_type = cell.attrib.get("t")
    value_node = cell.find("a:v", NS)
    if value_node is None or value_node.text is None:
        return None

    value = value_node.text
    if cell_type == "s":
        return shared_strings[int(value)]
    return value


def read_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    shared_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings = []
    for si in shared_root.findall("a:si", NS):
        text = "".join(t.text or "" for t in si.findall(".//a:t", NS))
        strings.append(text)
    return strings


def parse_final_roster_sheet(workbook_path: Path) -> list[WorkbookRosterRow]:
    with zipfile.ZipFile(workbook_path) as zf:
        shared_strings = read_shared_strings(zf)
        sheet_root = ET.fromstring(zf.read("xl/worksheets/sheet4.xml"))

    rows = sheet_root.find("a:sheetData", NS)
    if rows is None:
        raise RuntimeError("Final Roster sheet has no sheetData")

    roster_rows: list[WorkbookRosterRow] = []
    current_team_names: dict[int, str] = {}

    for row in rows.findall("a:row", NS):
        row_number = int(row.attrib["r"])
        row_cells: dict[str, str | None] = {}
        for cell in row.findall("a:c", NS):
            row_cells[cell.attrib["r"]] = excel_cell_to_value(cell, shared_strings)

        if row_number in (1, 25):
            for index, (start_col, _) in enumerate(TEAM_BLOCK_COLUMNS):
                value = row_cells.get(f"{start_col}{row_number}")
                if value:
                    current_team_names[index] = value.split(" $", 1)[0]
            continue

        for index, (start_col, end_col) in enumerate(TEAM_BLOCK_COLUMNS):
            team_name = current_team_names.get(index)
            if not team_name:
                continue

            slot_label = row_cells.get(f"{start_col}{row_number}")
            name = row_cells.get(f"{chr(ord(start_col) + 1)}{row_number}")
            contract = row_cells.get(f"{chr(ord(start_col) + 2)}{row_number}")
            actual_value = row_cells.get(f"{end_col}{row_number}")

            if not slot_label or not name or actual_value is None:
                continue

            slot_base = "UTIL" if slot_label == "U" else slot_label
            roster_rows.append(
                WorkbookRosterRow(
                    team_name=team_name,
                    slot_label=slot_label,
                    slot_base=slot_base,
                    abbreviated_name=name.strip(),
                    contract=(contract or "").strip(),
                    actual_value=float(actual_value),
                )
            )

    return roster_rows


def slot_sort_key(position_slot: str) -> tuple[int, int]:
    slot_base, _, slot_index = position_slot.partition("-")
    return (SLOT_ORDER.get(slot_base, 999), int(slot_index or 0))


def build_final_json_lookup(final_league: dict) -> dict[str, list[dict]]:
    lookup: dict[str, list[dict]] = defaultdict(list)
    for player in final_league.get("taken_players", []):
        slot_base = player["positionSlot"].split("-", 1)[0]
        if slot_base == "MiLB":
            continue
        lookup[player["teamName"]].append(player)

    for team_name, players in lookup.items():
        players.sort(key=lambda player: slot_sort_key(player["positionSlot"]))

    return lookup


def score_candidate(display_name: str, candidate_name: str) -> tuple[int, int, int]:
    cleaned = re.sub(r"\s*\([^)]*\)", "", display_name).replace(".", " ").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    candidate_norm = normalize_name(candidate_name)
    cleaned_norm = normalize_name(cleaned)
    if candidate_norm == cleaned_norm:
        return (4, 0, -len(candidate_name))

    cleaned_parts = cleaned_norm.split()
    candidate_parts = candidate_norm.split()
    if not cleaned_parts or not candidate_parts:
        return (0, 0, 0)

    display_surname = cleaned_parts[-1]
    candidate_surname = candidate_parts[-1]
    if display_surname != candidate_surname:
        return (0, 0, 0)

    display_first = cleaned_parts[0]
    candidate_first = candidate_parts[0]
    if len(display_first) == 1 and candidate_first.startswith(display_first):
        return (3, 0, -len(candidate_name))
    if candidate_first.startswith(display_first):
        return (2, 0, -len(candidate_name))
    return (1, 0, -len(candidate_name))


def slot_matches_candidate(position_slot: str | None, positions: list[str]) -> int:
    if not position_slot:
        return 0
    slot_root = position_slot.split("-", 1)[0]
    if slot_root in {"UTIL", "U", "DH"}:
        return 1 if any(pos not in {"SP", "RP"} for pos in positions) else 0
    if slot_root == "CI":
        return 2 if any(pos in {"1B", "3B"} for pos in positions) else 0
    if slot_root == "MI":
        return 2 if any(pos in {"2B", "SS"} for pos in positions) else 0
    if slot_root == "P":
        return 2 if any(pos in {"SP", "RP"} for pos in positions) else 0
    return 2 if slot_root in positions else 0


def candidate_volume_score(candidate: dict) -> float:
    total = 0.0
    for stat in candidate.get("stats", []):
        if str(stat.get("season")) not in {"2025", "2024", "2023"}:
            continue
        for value in (stat.get("data") or {}).values():
            if isinstance(value, (int, float)):
                total += abs(float(value))
    return total


def resolve_player_identity(
    display_name: str,
    position_slot: str | None,
) -> tuple[str, str]:
    exact_matches = []
    for candidate in fetch_player_candidates(display_name):
        name = candidate.get("name")
        if name and normalize_name(name) == normalize_name(display_name):
            exact_matches.append(candidate)

    if not exact_matches:
        resolved_name = resolve_name_via_api(display_name)
        exact_matches = [
            candidate
            for candidate in fetch_player_candidates(resolved_name)
            if normalize_name(candidate.get("name", ""))
            == normalize_name(resolved_name)
        ]

    if not exact_matches:
        raise RuntimeError(f"Could not resolve workbook name via API: {display_name}")

    ranked = sorted(
        exact_matches,
        key=lambda candidate: (
            slot_matches_candidate(position_slot, candidate.get("positions", [])),
            candidate_volume_score(candidate),
        ),
        reverse=True,
    )
    chosen = ranked[0]
    player_id = chosen.get("_id")
    player_name = chosen.get("name")
    if not player_id or not player_name:
        raise RuntimeError(f"Could not resolve workbook name via API: {display_name}")
    return str(player_id), str(player_name)


def resolve_name_via_api(display_name: str) -> str:
    cleaned = re.sub(r"\s*\([^)]*\)", "", display_name).replace(".", " ").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    search_terms = [cleaned]

    parts = cleaned.split()
    if parts:
        surname = parts[-1]
        if surname not in search_terms:
            search_terms.append(surname)

    candidates: list[dict] = []
    seen_names = set()
    for term in search_terms:
        for candidate in fetch_player_candidates(term):
            name = candidate.get("name")
            if name and name not in seen_names:
                seen_names.add(name)
                candidates.append(candidate)

    ranked = sorted(
        (
            (score_candidate(display_name, candidate["name"]), candidate["name"])
            for candidate in candidates
        ),
        reverse=True,
    )
    ranked = [item for item in ranked if item[0][0] > 0]
    if not ranked:
        raise RuntimeError(f"Could not resolve workbook name via API: {display_name}")
    if len(ranked) > 1 and ranked[0][0] == ranked[1][0]:
        raise RuntimeError(f"Ambiguous workbook name via API: {display_name}")
    return ranked[0][1]


def resolve_full_roster(
    workbook_rows: list[WorkbookRosterRow],
    final_league: dict,
) -> tuple[list[dict], list[dict]]:
    final_lookup = build_final_json_lookup(final_league)
    grouped_workbook: dict[str, list[WorkbookRosterRow]] = defaultdict(list)
    for row in workbook_rows:
        grouped_workbook[row.team_name].append(row)

    resolved: list[dict] = []
    skipped: list[dict] = []
    for team_name, rows in grouped_workbook.items():
        rows.sort(
            key=lambda row: (SLOT_ORDER.get(row.slot_base, 999), row.actual_value)
        )
        final_players = final_lookup.get(team_name, [])
        unused = list(final_players)

        for workbook_row in rows:
            exact_matches = [
                player
                for player in unused
                if player["positionSlot"].split("-", 1)[0] == workbook_row.slot_base
                and player.get("contract", "") == workbook_row.contract
                and abs(float(player["price"]) - workbook_row.actual_value) < 1e-9
            ]

            final_player = None
            if len(exact_matches) == 1:
                final_player = exact_matches[0]
                unused.remove(final_player)
            elif len(exact_matches) > 1:
                ranked_matches = sorted(
                    (
                        (
                            score_candidate(
                                workbook_row.abbreviated_name,
                                player["playerName"],
                            ),
                            player,
                        )
                        for player in exact_matches
                    ),
                    key=lambda item: item[0],
                    reverse=True,
                )
                ranked_matches = [item for item in ranked_matches if item[0][0] > 0]
                if len(ranked_matches) == 1 or (
                    len(ranked_matches) > 1
                    and ranked_matches[0][0] != ranked_matches[1][0]
                ):
                    final_player = ranked_matches[0][1]
                    unused.remove(final_player)

            if final_player is None:
                skipped.append(
                    {
                        "teamName": team_name,
                        "slotLabel": workbook_row.slot_label,
                        "abbreviatedName": workbook_row.abbreviated_name,
                        "contract": workbook_row.contract,
                        "actualValue": workbook_row.actual_value,
                        "reason": "Could not map workbook row cleanly to final JSON roster",
                    }
                )
                continue

            resolved.append(
                {
                    "teamName": team_name,
                    "slotLabel": workbook_row.slot_label,
                    "positionSlot": final_player["positionSlot"],
                    "abbreviatedName": workbook_row.abbreviated_name,
                    "playerId": final_player.get("playerId"),
                    "playerName": final_player["playerName"],
                    "contract": final_player.get("contract", ""),
                    "actualValue": float(final_player["price"]),
                }
            )

    return resolved, skipped


def build_api_league(final_league: dict, resolved_roster: list[dict]) -> dict:
    api_league = dict(final_league)
    api_league["taken_players"] = [
        {
            "playerName": row["playerName"],
            "teamName": row["teamName"],
            "positionSlot": row["positionSlot"],
            "price": row["actualValue"],
            "contract": row["contract"],
        }
        for row in resolved_roster
    ]
    return api_league


def compare_values(
    final_league: dict,
    resolved_roster: list[dict],
) -> tuple[list[dict], list[dict]]:
    api_league = build_api_league(final_league, resolved_roster)
    valuations = fetch_all_valuations(api_league)
    valuation_lookup_by_id = {
        valuation["playerId"]: valuation for valuation in valuations
    }
    valuation_lookup_by_name = {
        normalize_name(valuation["name"]): valuation for valuation in valuations
    }
    comparisons = []
    skipped = []
    for player in resolved_roster:
        valuation = None
        if player.get("playerId"):
            valuation = valuation_lookup_by_id.get(player["playerId"])
        if not valuation:
            valuation = valuation_lookup_by_name.get(
                normalize_name(player["playerName"])
            )
        if not valuation:
            skipped.append(
                {
                    "teamName": player["teamName"],
                    "slotLabel": player["slotLabel"],
                    "abbreviatedName": player["abbreviatedName"],
                    "playerName": player["playerName"],
                    "contract": player["contract"],
                    "actualValue": player["actualValue"],
                    "reason": "No valuation returned by API",
                }
            )
            continue
        if valuation.get("injuryStatus") and valuation["injuryStatus"] != "active":
            skipped.append(
                {
                    "teamName": player["teamName"],
                    "slotLabel": player["slotLabel"],
                    "abbreviatedName": player["abbreviatedName"],
                    "playerName": player["playerName"],
                    "contract": player["contract"],
                    "actualValue": player["actualValue"],
                    "reason": f"Injured player excluded: {valuation['injuryStatus']}",
                }
            )
            continue
        if normalize_name(valuation["name"]) != normalize_name(player["playerName"]):
            skipped.append(
                {
                    "teamName": player["teamName"],
                    "slotLabel": player["slotLabel"],
                    "abbreviatedName": player["abbreviatedName"],
                    "playerName": player["playerName"],
                    "contract": player["contract"],
                    "actualValue": player["actualValue"],
                    "reason": f"Valuation mismatch: API returned {valuation['name']}",
                }
            )
            continue
        api_value = float(valuation["dollarValue"])
        actual_value = float(player["actualValue"])

        comparisons.append(
            {
                **player,
                "valuation": valuation,
                "matchedName": valuation["name"],
                "playerType": valuation["playerType"],
                "positions": valuation["positions"],
                "age": valuation.get("age"),
                "injuryStatus": valuation.get("injuryStatus"),
                "depthChartStatus": valuation.get("depthChartStatus"),
                "depthChartOrder": valuation.get("depthChartOrder"),
                "team": valuation["team"],
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

    comparisons.sort(
        key=lambda row: (
            0 if row["playerType"] == "hitter" else 1,
            -row["actualValue"],
            row["playerName"],
        )
    )
    return comparisons, skipped


def write_outputs(comparisons: list[dict]) -> None:
    OUTPUT_JSON_PATH.write_text(
        json.dumps(comparisons, indent=2) + "\n",
        encoding="utf-8",
    )

    fieldnames = [
        "playerType",
        "teamName",
        "playerName",
        "abbreviatedName",
        "positions",
        "positionSlot",
        "contract",
        "actualValue",
        "apiValue",
        "difference",
        "absDifference",
    ]

    with OUTPUT_CSV_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in comparisons:
            writer.writerow(
                {
                    field: (
                        ", ".join(row["positions"])
                        if field == "positions"
                        else row.get(field, "")
                    )
                    for field in fieldnames
                }
            )


def print_section(title: str, rows: list[dict]) -> None:
    print(title)
    print("-" * len(title))
    print(
        f"{'Team':<8} {'Player':<28} {'Pos':<10} {'Actual':>8} {'API':>8} {'Diff':>8}"
    )
    for row in rows:
        positions = "/".join(row["positions"])
        print(
            f"{row['teamName']:<8} {row['playerName']:<28} {positions:<10} "
            f"{row['actualValue']:>8.2f} {row['apiValue']:>8.2f} {row['difference']:>8.2f}"
        )
    print()


def print_summary(rows: list[dict]) -> None:
    hitters = [row for row in rows if row["playerType"] == "hitter"]
    pitchers = [row for row in rows if row["playerType"] == "pitcher"]

    print_section("Hitters", hitters)
    print_section("Pitchers", pitchers)

    for title, group in (
        ("Hitters", hitters),
        ("Pitchers", pitchers),
        ("All Players", rows),
    ):
        actual_total = sum(row["actualValue"] for row in group)
        api_total = sum(row["apiValue"] for row in group)
        diff_total = api_total - actual_total
        abs_diff_total = sum(row["absDifference"] for row in group)
        mean_abs_diff = abs_diff_total / len(group) if group else 0.0
        print(
            f"{title}: actual={actual_total:.2f} api={api_total:.2f} "
            f"netDiff={diff_total:.2f} absDiff={abs_diff_total:.2f} "
            f"meanAbsDiff={mean_abs_diff:.2f}"
        )

    print()
    print("Position Buckets")
    print("----------------")
    print(f"{'Pos':<8} {'Count':>5} {'NetDiff':>10} {'AbsDiff':>10} {'MeanAbs':>10}")
    bucket_rows: dict[str, list[dict]] = defaultdict(list)
    for row in hitters:
        for position in row["positions"]:
            bucket_rows[position].append(row)
    for position in sorted(bucket_rows):
        group = bucket_rows[position]
        net_diff = sum(row["difference"] for row in group)
        abs_diff = sum(row["absDifference"] for row in group)
        mean_abs = abs_diff / len(group) if group else 0.0
        print(
            f"{position:<8} {len(group):>5} {net_diff:>10.2f} "
            f"{abs_diff:>10.2f} {mean_abs:>10.2f}"
        )

    print()
    print(f"JSON: {OUTPUT_JSON_PATH}")
    print(f"CSV : {OUTPUT_CSV_PATH}")
    print(f"Skipped: {SKIPPED_JSON_PATH}")


def main() -> int:
    global BASE_URL
    global API_KEY

    BASE_URL = os.environ.get("API_BASE_URL", DEFAULT_BASE_URL)
    API_KEY = os.environ.get("API_KEY", DEFAULT_API_KEY)

    final_league = load_league(FINAL_JSON_PATH)
    workbook_rows = parse_final_roster_sheet(WORKBOOK_PATH)
    resolved_roster, skipped = resolve_full_roster(workbook_rows, final_league)
    comparisons, comparison_skipped = compare_values(final_league, resolved_roster)
    skipped.extend(comparison_skipped)
    SKIPPED_JSON_PATH.write_text(
        json.dumps(skipped, indent=2) + "\n",
        encoding="utf-8",
    )
    write_outputs(comparisons)
    print_summary(comparisons)
    print(f"Skipped Count: {len(skipped)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
