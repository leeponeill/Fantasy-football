#!/usr/bin/env python3
import json
import re
import unicodedata
from pathlib import Path

TARGETS = {
    "Colombia vs Congo DR",
    "Panama vs Croatia",
    "Portugal vs Uzbekistan",
    "Jordan vs Algeria",
    "Norway vs Senegal",
    "France vs Iraq",
    "Argentina vs Austria",
    "New Zealand vs Egypt",
    "Uruguay vs Cabo Verde",
    "Spain vs Saudi Arabia",
    "Tunisia vs Japan",
    "Germany vs Côte d'Ivoire",
}

ALIASES = {
    "drcongo": "congodr",
    "democraticrepublicofcongo": "congodr",
    "democraticrepublicofthecongo": "congodr",
    "republicofthecongo": "congodr",
    "congodr": "congodr",
    "capeverde": "caboverde",
    "caboverde": "caboverde",
    "ivorycoast": "cotedivoire",
    "coteivoire": "cotedivoire",
    "cotedivoire": "cotedivoire",
}


def normalize(value: str) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^a-z0-9]", "", text.lower())
    if text.endswith("nationalteam"):
        text = text[: -len("nationalteam")]
    if text.endswith("mens"):
        text = text[: -len("mens")]
    if text.endswith("womens"):
        text = text[: -len("womens")]
    return ALIASES.get(text, text)


def infer_score(match: str, scorers: list[dict]) -> tuple[int, int, int] | None:
    parts = str(match or "").split(" vs ")
    home = parts[0].strip() if len(parts) > 0 else ""
    away = parts[1].strip() if len(parts) > 1 else ""
    home_token = normalize(home)
    away_token = normalize(away)
    if not home_token or not away_token:
        return None

    home_goals = 0
    away_goals = 0
    unknown = 0
    for scorer in scorers:
        team_token = normalize((scorer or {}).get("team", ""))
        if team_token == home_token:
            home_goals += 1
        elif team_token == away_token:
            away_goals += 1
        else:
            unknown += 1

    return home_goals, away_goals, unknown


def update_records(records: list[dict], source_label: str) -> list[tuple[str, str, str, str]]:
    changes: list[tuple[str, str, str, str]] = []
    for rec in records:
        match = rec.get("match", "")
        if match not in TARGETS:
            continue

        scorers = rec.get("scorers") if isinstance(rec.get("scorers"), list) else []
        if not scorers:
            continue

        inferred = infer_score(match, scorers)
        if not inferred:
            continue

        home_goals, away_goals, unknown = inferred
        if unknown != 0 or (home_goals + away_goals) == 0:
            continue

        old_home = str(rec.get("homeScore", "")).strip()
        old_away = str(rec.get("awayScore", "")).strip()

        # Only fix the requested inconsistency pattern.
        if old_home == "0" and old_away == "0":
            rec["homeScore"] = str(home_goals)
            rec["awayScore"] = str(away_goals)
            changes.append((source_label, match, f"{old_home}-{old_away}", f"{home_goals}-{away_goals}"))

    return changes


def main() -> int:
    wc_path = Path("data/WCfixtures.json")
    wc_data = json.loads(wc_path.read_text(encoding="utf-8"))
    wc_games = [game for matchday in wc_data for game in matchday.get("games", [])]
    wc_changes = update_records(wc_games, "WC")
    if wc_changes:
        wc_path.write_text(json.dumps(wc_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    state_path = Path("data/league-state.json")
    state_data = json.loads(state_path.read_text(encoding="utf-8"))
    raw_results = state_data.get("storage", {}).get("fantasy-football-fixture-results")
    state_changes: list[tuple[str, str, str, str]] = []

    if isinstance(raw_results, str):
        try:
            results = json.loads(raw_results)
        except Exception:
            results = []

        if isinstance(results, list):
            state_changes = update_records(results, "STATE")
            if state_changes:
                state_data.setdefault("storage", {})["fantasy-football-fixture-results"] = json.dumps(results, ensure_ascii=False)
                state_path.write_text(json.dumps(state_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    all_changes = wc_changes + state_changes
    if not all_changes:
        print("NO_CHANGES_APPLIED")
        return 0

    for src, match, old_score, new_score in all_changes:
        print(f"{src} | {match} | {old_score} -> {new_score}")
    print(f"TOTAL_CHANGES={len(all_changes)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
