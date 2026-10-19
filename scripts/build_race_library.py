"""Build the offline race library used by Replay mode's "Race library" backend.

Downloads real race data and writes compact JSON files the dashboard can
replay without any API access:

  * Timing, tyres, telemetry, race control, weather and team radio come from
    TracingInsights/2025 (FastF1-derived, Apache-2.0):
    https://github.com/TracingInsights/2025
  * Circuit details and official results come from F1DB (CC BY 4.0):
    https://github.com/f1db/f1db

Usage (needs numpy and pyyaml):
    python scripts/build_race_library.py                  # every race of every season listed below
    python scripts/build_race_library.py --season 2026    # one season
    python scripts/build_race_library.py british monaco   # races whose name contains a word
    python scripts/build_race_library.py --out public/races

Output layout:
    <out>/index.json                  list of races (for the race picker)
    <out>/<season>/<slug>/race.json            timing, positions, gaps, tyres, pits, track...
    <out>/<season>/<slug>/tel.json             1 Hz telemetry, split into fixed time chunks
    <out>/<season>/<slug>/radio/*.mp3          a selection of team radio clips
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import yaml

TI_BASE = "https://raw.githubusercontent.com/TracingInsights/{season}/main/"
F1DB_BASE = "https://raw.githubusercontent.com/f1db/f1db/main/src/data/"
# TracingInsights event folder -> F1DB race folder, per season
RACES_2025 = [
    ("Australian Grand Prix", "01-australia"),
    ("Chinese Grand Prix", "02-china"),
    ("Japanese Grand Prix", "03-japan"),
    ("Bahrain Grand Prix", "04-bahrain"),
    ("Saudi Arabian Grand Prix", "05-saudi-arabia"),
    ("Miami Grand Prix", "06-miami"),
    ("Emilia Romagna Grand Prix", "07-emilia-romagna"),
    ("Monaco Grand Prix", "08-monaco"),
    ("Spanish Grand Prix", "09-spain"),
    ("Canadian Grand Prix", "10-canada"),
    ("Austrian Grand Prix", "11-austria"),
    ("British Grand Prix", "12-great-britain"),
    ("Belgian Grand Prix", "13-belgium"),
    ("Hungarian Grand Prix", "14-hungary"),
    ("Dutch Grand Prix", "15-netherlands"),
    ("Italian Grand Prix", "16-italy"),
    ("Azerbaijan Grand Prix", "17-azerbaijan"),
    ("Singapore Grand Prix", "18-singapore"),
    ("United States Grand Prix", "19-united-states"),
    ("Mexico City Grand Prix", "20-mexico"),
    ("São Paulo Grand Prix", "21-sao-paulo"),
    ("Las Vegas Grand Prix", "22-las-vegas"),
    ("Qatar Grand Prix", "23-qatar"),
    ("Abu Dhabi Grand Prix", "24-abu-dhabi"),
]

RACES_2026 = [
    ("Australian Grand Prix", "01-australia"),
    ("Chinese Grand Prix", "02-china"),
    ("Japanese Grand Prix", "03-japan"),
    ("Miami Grand Prix", "04-miami"),
    ("Canadian Grand Prix", "05-canada"),
    ("Monaco Grand Prix", "06-monaco"),
    ("Barcelona Grand Prix", "07-barcelona-catalunya"),
    ("Austrian Grand Prix", "08-austria"),
    ("British Grand Prix", "09-great-britain"),
    ("Belgian Grand Prix", "10-belgium"),
    ("Hungarian Grand Prix", "11-hungary"),
    ("Dutch Grand Prix", "12-netherlands"),
    ("Italian Grand Prix", "13-italy"),
    ("Spanish Grand Prix", "14-spain"),
    ("Azerbaijan Grand Prix", "15-azerbaijan"),
    ("Bahrain Grand Prix", "16-bahrain"),
    ("Singapore Grand Prix", "17-singapore"),
    ("United States Grand Prix", "18-united-states"),
    ("Mexico City Grand Prix", "19-mexico"),
    ("São Paulo Grand Prix", "20-sao-paulo"),
    ("Las Vegas Grand Prix", "21-las-vegas"),
    ("Qatar Grand Prix", "22-qatar"),
    ("Abu Dhabi Grand Prix", "23-abu-dhabi"),
]

RACES = {2025: RACES_2025, 2026: RACES_2026}
# DRS was abolished from 2026; the channel is always 0 there.
FIRST_SEASON_WITHOUT_DRS = 2026

GRID_MS = 1000          # telemetry resolution stored on disk
CHUNK_MS = 120_000      # telemetry file length
POSITION_EVERY_MS = 2000
INTERVAL_EVERY_MS = 4000
MAX_RADIO = 10
TRACK_POINTS = 500
OUTLINE_POINTS = 90


# --- helpers ------------------------------------------------------------------


def fetch(url: str, retries: int = 4) -> bytes | None:
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = e
        except Exception as e:  # network hiccup
            err = e
        time.sleep(1.5 * 2**attempt)
    print(f"  ! giving up on {url}: {err}", file=sys.stderr)
    return None


def fetch_json(url: str):
    raw = fetch(url)
    return json.loads(raw) if raw else None


def fetch_yaml(url: str):
    raw = fetch(url)
    return yaml.safe_load(raw) if raw else None


def ti_url(season: int, event: str, path: str) -> str:
    return TI_BASE.format(season=season) + urllib.parse.quote(f"{event}/Race/{path}")


def clean(v):
    if v is None or v == "None" or v == "NaN":
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def ts_ms(value) -> int | None:
    """'2025-07-06T14:03:49.616000000' (UTC, ns) -> epoch ms."""
    value = clean(value)
    if value is None:
        return None
    s = str(value).replace("Z", "+00:00")
    s = re.sub(r"(\.\d{6})\d+", r"\1", s)
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def iso(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def columns_to_rows(cols: dict) -> list[dict]:
    keys = [k for k, v in cols.items() if isinstance(v, list)]
    n = max((len(cols[k]) for k in keys), default=0)
    return [{k: clean(cols[k][i]) if i < len(cols[k]) else None for k in keys} for i in range(n)]


def rotate(x: np.ndarray, y: np.ndarray, deg: float):
    a = math.radians(deg)
    return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)


def parse_gap(text):
    text = clean(text)
    if text is None:
        return None
    t = str(text).strip()
    m = re.match(r"^\+?(\d+)\s*laps?$", t, re.I)
    if m:
        n = int(m.group(1))
        return f"+{n} LAP{'S' if n > 1 else ''}"
    try:
        return float(t.lstrip("+"))
    except ValueError:
        return t


def hhmm(value) -> str:
    """YAML 1.1 reads an unquoted 15:00 as the base-60 integer 900."""
    if value is None:
        return ""
    if isinstance(value, int):
        return f"{value // 60:02d}:{value % 60:02d}"
    return str(value)


def round_list(values, nd=0):
    return [None if v is None else (int(round(v)) if nd == 0 else round(float(v), nd)) for v in values]


# --- one race -----------------------------------------------------------------


def build_race(season: int, event: str, f1db_dir: str, out_root: Path) -> dict | None:
    slug = f1db_dir.split("-", 1)[1]
    race_path = f"{season}/{slug}"
    out = out_root / race_path
    print(f"== {event} -> {out}")
    race_dir = f"seasons/{season}/races/{f1db_dir}/"
    meta = fetch_yaml(F1DB_BASE + race_dir + "race.yml")
    results = fetch_yaml(F1DB_BASE + race_dir + "race-results.yml") or []
    grid = fetch_yaml(F1DB_BASE + race_dir + "starting-grid-positions.yml") or []
    if not meta:
        print("  ! no F1DB race entry; skipping")
        return None
    circuit = fetch_yaml(F1DB_BASE + f"circuits/{meta['circuitId']}.yml") or {}
    country = fetch_yaml(F1DB_BASE + f"countries/{circuit.get('countryId', '')}.yml") or {}

    drivers_json = fetch_json(ti_url(season, event, "drivers.json"))
    if not drivers_json:
        print("  ! no driver list; skipping")
        return None
    drivers = drivers_json["drivers"]

    # Lap tables per driver.
    with ThreadPoolExecutor(16) as pool:
        lap_tables = dict(zip([d["driver"] for d in drivers],
                              pool.map(lambda d: fetch_json(ti_url(season, event, f"{d['driver']}/laptimes.json")), drivers)))
    laps_by_code: dict[str, list[dict]] = {}
    offset = None  # epoch ms of session time 0
    for code, table in lap_tables.items():
        if not table:
            continue
        rows = [r for r in columns_to_rows(table) if r.get("lap") is not None]
        if not rows:
            continue
        laps_by_code[code] = rows
        for r in rows:
            if offset is None and r.get("lSD") and r.get("lST") is not None:
                offset = ts_ms(r["lSD"]) - float(r["lST"]) * 1000
    if offset is None:
        print("  ! no lap timing; skipping")
        return None
    sess = lambda s: None if clean(s) is None else offset + float(s) * 1000  # noqa: E731

    # Absolute lap start times (fall back to session time).
    for rows in laps_by_code.values():
        for r in rows:
            r["_start"] = ts_ms(r.get("lSD")) or sess(r.get("lST"))

    # Telemetry, every lap of every driver.
    tasks = [(code, r) for code, rows in laps_by_code.items() for r in rows if r["_start"] is not None]
    print(f"  downloading {len(tasks)} laps of telemetry…")

    def load(task):
        code, r = task
        data = fetch_json(ti_url(season, event, f"{code}/{int(r['lap'])}_tel.json"))
        return code, r, (data or {}).get("tel")

    series: dict[str, list[np.ndarray]] = {}
    partial: list[tuple[str, int, int, np.ndarray]] = []
    lap_lengths: list[float] = []
    ref_candidates: dict[str, dict] = {}
    with ThreadPoolExecutor(32) as pool:
        for code, r, tel in pool.map(load, tasks):
            if not tel or not tel.get("time"):
                continue
            n = len(tel["time"])
            get = lambda k: np.array([np.nan if clean(v) is None else float(v) for v in (tel.get(k) or [None] * n)])  # noqa: E731
            t = r["_start"] + get("time") * 1000
            dist = get("distance")
            rel = get("rel_distance")
            # FastF1 measures rel_distance against the distance covered in that lap, which is
            # wrong for laps a car never finished; those are rescaled below with the typical lap length.
            prog = (int(r["lap"]) - 1) + np.clip(rel, 0, 1)
            arr = np.vstack([t, prog, get("speed"), get("rpm"), get("gear"), get("throttle"), get("brake"), get("drs")])
            series.setdefault(code, []).append(arr)
            if r.get("time") is None:
                partial.append((code, len(series[code]) - 1, int(r["lap"]), dist))
            elif np.isfinite(dist).any():
                lap_lengths.append(float(np.nanmax(dist)))
            # Keep x/y of clean green-flag laps as candidates for the track outline.
            if r.get("pin") is None and r.get("pout") is None and r.get("time") and int(r["lap"]) >= 2 \
                    and str(r.get("status") or "1") == "1":
                ref_candidates.setdefault(code, {})[int(r["lap"])] = {
                    "duration": float(r["time"]), "x": get("x"), "y": get("y"), "rel": rel, "drs": get("drs")}

    if not series:
        print("  ! no telemetry; skipping")
        return None
    if lap_lengths:
        typical = float(np.median(lap_lengths))
        for code, i, lap, dist in partial:
            series[code][i][1] = (lap - 1) + np.clip(dist / typical, 0, 1)

    race_start = min(rows[0]["_start"] for rows in laps_by_code.values() if rows[0]["_start"])
    last_sample = max(np.concatenate(s, axis=1)[0].max() for s in series.values())
    start = int(race_start - 90_000)
    end = int(last_sample + 60_000)
    n_grid = (end - start) // GRID_MS + 1
    grid_t = start + np.arange(n_grid) * GRID_MS

    # Resample every driver onto the shared 1 Hz grid.
    num_by_code = {d["driver"]: int(d["dn"]) for d in drivers}
    resampled: dict[int, dict[str, np.ndarray]] = {}
    for code, parts in series.items():
        a = np.concatenate(parts, axis=1)
        a = a[:, np.argsort(a[0])]
        a = a[:, ~np.isnan(a[0]) & ~np.isnan(a[1])]
        if a.shape[1] < 2:
            continue
        a[1] = np.maximum.accumulate(a[1])
        t = a[0]
        idx = np.searchsorted(t, grid_t, side="right") - 1
        valid = (idx >= 0) & (grid_t <= t[-1])
        idx_c = np.clip(idx, 0, len(t) - 1)
        nxt = np.clip(idx_c + 1, 0, len(t) - 1)
        near = np.minimum(np.abs(grid_t - t[idx_c]), np.abs(t[nxt] - grid_t))
        valid &= near <= 5000
        prog = np.interp(grid_t, t, a[1])
        speed = np.interp(grid_t, t, np.nan_to_num(a[2]))
        rpm = np.interp(grid_t, t, np.nan_to_num(a[3]))
        pick = lambda row: a[row][idx_c]  # noqa: E731
        resampled[num_by_code[code]] = {
            "valid": valid, "prog": np.where(valid, prog, np.nan), "speed": speed, "rpm": rpm,
            "gear": pick(4), "throttle": np.clip(np.nan_to_num(pick(5)), 0, 100),
            "brake": np.nan_to_num(pick(6)), "drs": np.nan_to_num(pick(7)),
        }

    # --- track outline from the winner's most typical clean lap -------------------
    winner_num = next((int(r["driverNumber"]) for r in results if r.get("position") == 1), None)
    code_by_num = {v: k for k, v in num_by_code.items()}
    corners_json = fetch_json(ti_url(season, event, "corners.json")) or {}
    rotation = float(corners_json.get("Rotation") or 0)
    pool_codes = [code_by_num.get(winner_num)] + list(ref_candidates)
    ref = None
    def usable(c):  # some laps have no position trace at all
        return int((~np.isnan(c["x"]) & ~np.isnan(c["y"]) & (c["rel"] >= 0) & (c["rel"] <= 1)).sum()) >= 100

    for code in pool_codes:
        cands = [c for c in ref_candidates.get(code or "", {}).values() if usable(c)]
        if len(cands) >= 3:
            med = np.median([c["duration"] for c in cands])
            ref = min(cands, key=lambda c: abs(c["duration"] - med))
            break
    track = None
    outline = []
    if ref is not None:
        ok = ~np.isnan(ref["x"]) & ~np.isnan(ref["y"]) & (ref["rel"] >= 0) & (ref["rel"] <= 1)
        x, y = rotate(ref["x"][ok], ref["y"][ok], rotation)
        rel, drs = ref["rel"][ok], ref["drs"][ok]
        order = np.argsort(rel)
        x, y, rel, drs = x[order], y[order], rel[order], drs[order]
        keep = np.linspace(0, len(x) - 1, min(TRACK_POINTS, len(x))).astype(int)
        x, y, rel, drs = x[keep], y[keep], rel[keep], drs[keep]
        # DRS zones: where cars actually opened DRS during the race (the reference lap
        # alone can miss them, e.g. when DRS was disabled in the wet).
        bins = np.zeros(200)
        for d in resampled.values():
            on = d["valid"] & (d["drs"] >= 10)
            if on.any():
                frac = np.mod(d["prog"][on], 1)
                bins += np.bincount(np.clip((frac * 200).astype(int), 0, 199), minlength=200)
        zones = []
        if bins.max() >= 10:
            hot = bins >= max(10, bins.max() * 0.25)
            open_ = hot[np.clip((rel * 200).astype(int), 0, 199)]
            s = None
            for i, o in enumerate(open_):
                if o and s is None:
                    s = i
                if (not o or i == len(open_) - 1) and s is not None:
                    e = i if o else i - 1
                    if e - s >= 2:
                        zones.append([s, e])
                    s = None
        corners = []
        if corners_json.get("X"):
            cx, cy = rotate(np.array(corners_json["X"], float), np.array(corners_json["Y"], float), rotation)
            letters = corners_json.get("CornerLetter") or [""] * len(cx)
            for i in range(len(cx)):
                label = f"{corners_json['CornerNumber'][i]}{letters[i] or ''}"
                corners.append({"x": round(float(cx[i])), "y": round(float(cy[i])), "label": label})
        track = {
            "points": [{"x": round(float(a)), "y": round(float(b))} for a, b in zip(x, y)],
            "rel": [round(float(r), 5) for r in rel],
            "drsZones": zones,
            "corners": corners,
        }
        k = np.linspace(0, len(x) - 1, OUTLINE_POINTS).astype(int)
        outline = [[round(float(x[i])), round(float(y[i]))] for i in k]

    # --- drivers, laps, stints, pits ---------------------------------------------
    raw_drivers = [{
        "driver_number": int(d["dn"]), "name_acronym": d["driver"],
        "full_name": f"{d.get('fn', '')} {d.get('ln', '')}".strip(),
        "team_name": d.get("team"), "team_colour": d.get("tc"),
    } for d in drivers]

    laps, stints, pits = [], [], []
    for code, rows in laps_by_code.items():
        n = num_by_code[code]
        for r in rows:
            laps.append({
                "driver_number": n, "lap_number": int(r["lap"]),
                "date_start": iso(r["_start"]) if r["_start"] else None,
                "lap_duration": r.get("time"), "duration_sector_1": r.get("s1"),
                "duration_sector_2": r.get("s2"), "duration_sector_3": r.get("s3"),
                "is_pit_out_lap": r.get("pout") is not None,
            })
        by_stint: dict[int, list[dict]] = {}
        for r in rows:
            if r.get("stint") is not None:
                by_stint.setdefault(int(r["stint"]), []).append(r)
        for sn, srows in sorted(by_stint.items()):
            stints.append({
                "driver_number": n, "stint_number": sn, "compound": srows[0].get("compound"),
                "lap_start": int(srows[0]["lap"]), "lap_end": int(srows[-1]["lap"]),
                "tyre_age_at_start": int(srows[0]["life"]) if srows[0].get("life") is not None else None,
            })
        for i, r in enumerate(rows):
            if r.get("pin") is None:
                continue
            out_t = rows[i + 1].get("pout") if i + 1 < len(rows) else None
            pits.append({
                "driver_number": n, "lap_number": int(r["lap"]), "date": iso(sess(r["pin"])),
                "pit_duration": round(float(out_t) - float(r["pin"]), 1) if out_t is not None else None,
            })

    # --- positions and gaps from track progress ------------------------------------
    result_by_num = {int(r["driverNumber"]): r for r in results}
    finish_ms = None
    win_code = code_by_num.get(winner_num)
    if win_code and win_code in laps_by_code:
        last = laps_by_code[win_code][-1]
        if last.get("time") and last["_start"]:
            finish_ms = last["_start"] + float(last["time"]) * 1000
    finish_ms = finish_ms or (end - 120_000)

    def last_valid_t(n):
        v = resampled[n]["valid"]
        return grid_t[np.nonzero(v)[0][-1]] if v.any() else None

    retired = {}
    for n, r in result_by_num.items():
        if clean(r.get("reasonRetired")) and n in resampled:
            lt = last_valid_t(n)
            retired[n] = (lt + 5000) if lt is not None else race_start

    # Starting grid ("PL" = pit-lane start, so use the display order).
    positions = [{"driver_number": int(g["driverNumber"]), "date": iso(start),
                  "position": int(g.get("positionDisplayOrder") or i + 1)} for i, g in enumerate(grid)]
    last_pos = {p["driver_number"]: p["position"] for p in positions}
    intervals = []
    nums = sorted(resampled)

    def progress_at(k):
        return {n: resampled[n]["prog"][k] for n in nums}

    def time_at_progress(n, p):
        d = resampled[n]
        ok = d["valid"]
        return float(np.interp(p, d["prog"][ok], grid_t[ok]))

    for k, t in enumerate(grid_t):
        if t < race_start or t > finish_ms:
            continue
        rel_t = t - race_start
        do_pos = rel_t % POSITION_EVERY_MS < GRID_MS
        do_int = rel_t % INTERVAL_EVERY_MS < GRID_MS and rel_t > 20_000
        if not (do_pos or do_int):
            continue
        prog = progress_at(k)
        held = {n: (prog[n] if not np.isnan(prog[n]) else np.nanmax(resampled[n]["prog"][:k + 1]) if k else -1)
                for n in nums}
        active = [n for n in nums if not (n in retired and t >= retired[n]) and not np.isnan(held[n])]
        stopped = [n for n in nums if n not in active]
        order = sorted(active, key=lambda n: -held[n]) + sorted(stopped, key=lambda n: -np.nan_to_num(held[n], nan=-1))
        if do_pos:
            for i, n in enumerate(order):
                if last_pos.get(n) != i + 1:
                    positions.append({"driver_number": n, "date": iso(t), "position": i + 1})
                    last_pos[n] = i + 1
        if do_int and active:
            leader = order[0]
            for i, n in enumerate(order[:len(active)]):
                if np.isnan(prog[n]):
                    continue
                def gap_to(other):
                    if held[n] < np.nanmin(resampled[other]["prog"]):
                        return None
                    diff = held[other] - held[n]
                    if diff >= 1:
                        laps_down = int(diff)
                        return f"+{laps_down} LAP{'S' if laps_down > 1 else ''}"
                    return round((t - time_at_progress(other, held[n])) / 1000, 3)
                intervals.append({
                    "driver_number": n, "date": iso(t),
                    "gap_to_leader": 0 if i == 0 else gap_to(leader),
                    "interval": 0 if i == 0 else gap_to(order[i - 1]),
                })

    # Official classification once the chequered flag falls.
    final_t = iso(finish_ms + 2000)
    for r in results:
        n = int(r["driverNumber"])
        if not isinstance(r.get("position"), int):
            continue
        positions.append({"driver_number": n, "date": final_t, "position": r["position"]})
        if not clean(r.get("reasonRetired")):
            intervals.append({"driver_number": n, "date": final_t,
                              "gap_to_leader": 0 if r["position"] == 1 else parse_gap(r.get("gap")),
                              "interval": 0 if r["position"] == 1 else parse_gap(r.get("interval"))})

    driver_status = [{"driver_number": n, "date": iso(t), "retired": True} for n, t in retired.items()]

    # --- race control, weather, radio ------------------------------------------------
    rcm = fetch_json(ti_url(season, event, "rcm.json")) or {}
    race_control = [{
        "date": iso(ts_ms(r["time"])), "category": r.get("cat"), "flag": r.get("flag"),
        "message": r.get("msg"), "lap_number": int(r["lap"]) if r.get("lap") is not None else None,
        "driver_number": int(float(r["dNum"])) if r.get("dNum") is not None else None,
    } for r in columns_to_rows(rcm) if r.get("time") and start <= ts_ms(r["time"]) <= end]

    w = fetch_json(ti_url(season, event, "weather.json")) or {}
    weather = [{
        "date": iso(sess(r["wT"])), "air_temperature": r.get("wAT"), "track_temperature": r.get("wTT"),
        "humidity": r.get("wH"), "rainfall": 1 if r.get("wR") else 0, "wind_speed": r.get("wWS"),
        "wind_direction": r.get("wWD"), "pressure": r.get("wP"),
    } for r in columns_to_rows(w) if r.get("wT") is not None and start <= sess(r["wT"]) <= end]

    radio_rows = [r for r in columns_to_rows(fetch_json(ti_url(season, event, "team_radio.json")) or {})
                  if r.get("file") and r.get("date") and race_start - 60_000 <= ts_ms(r["date"]) <= end]
    if len(radio_rows) > MAX_RADIO:
        pick = np.linspace(0, len(radio_rows) - 1, MAX_RADIO).astype(int)
        radio_rows = [radio_rows[i] for i in pick]
    (out / "radio").mkdir(parents=True, exist_ok=True)
    radio = []
    with ThreadPoolExecutor(8) as pool:
        blobs = list(pool.map(lambda r: fetch(ti_url(season, event, r["file"])), radio_rows))
    for r, blob in zip(radio_rows, blobs):
        if not blob:
            continue
        name = Path(r["file"]).name
        (out / "radio" / name).write_bytes(blob)
        radio.append({"driver_number": int(r["dNum"]), "date": iso(ts_ms(r["date"])),
                      "recording_url": f"radio/{name}"})

    # --- telemetry chunks --------------------------------------------------------------
    per_chunk = CHUNK_MS // GRID_MS
    n_chunks = math.ceil(n_grid / per_chunk)
    chunks = []
    for c in range(n_chunks):
        lo, hi = c * per_chunk, min(n_grid, (c + 1) * per_chunk)
        cars = {}
        for n, d in resampled.items():
            v = d["valid"][lo:hi]
            if not v.any():
                continue
            first = int(np.argmax(v))
            last = len(v) - int(np.argmax(v[::-1]))
            sl = slice(lo + first, lo + last)
            ok = d["valid"][sl]
            prog = np.round(d["prog"][sl] * 10000)
            p_enc, prev = [], None
            for good, p in zip(ok, prog):
                if not good:
                    p_enc.append(None)
                    continue
                p_enc.append(int(p) if prev is None else int(p - prev))
                prev = p
            mask = lambda arr: [None if not g else val for g, val in zip(ok, arr)]  # noqa: E731
            cars[str(n)] = {
                "o": first, "p": p_enc,
                "v": mask(round_list(d["speed"][sl])),
                "r": mask(round_list(d["rpm"][sl] / 10)),
                "g": mask(round_list(d["gear"][sl])),
                "t": mask(round_list(d["throttle"][sl])),
                "b": mask([1 if b else 0 for b in d["brake"][sl]]),
            }
            if season < FIRST_SEASON_WITHOUT_DRS:
                cars[str(n)]["d"] = mask(round_list(d["drs"][sl]))
        chunks.append({"t0": int(grid_t[lo]), "step": GRID_MS, "cars": cars})
    (out / "tel.json").write_text(json.dumps({"chunkMs": CHUNK_MS, "chunks": chunks}, separators=(",", ":")))

    circuit_info = {
        "name": circuit.get("name"), "fullName": circuit.get("fullName"), "place": circuit.get("placeName"),
        "country": country.get("name"), "countryCode": country.get("alpha2Code"),
        "lengthKm": meta.get("courseLength") or circuit.get("length"), "turns": meta.get("turns"),
        "direction": meta.get("direction"),
    }
    winner = None
    if winner_num is not None:
        d = next((x for x in raw_drivers if x["driver_number"] == winner_num), None)
        if d:
            winner = {"number": winner_num, "code": d["name_acronym"], "name": d["full_name"],
                      "team": d["team_name"], "color": d["team_colour"]}
    podium = [code_by_num.get(int(r["driverNumber"])) for r in sorted(
        (r for r in results if isinstance(r.get("position"), int)), key=lambda r: r["position"])[:3]]

    summary = {
        "slug": slug, "season": season, "dir": race_path, "round": meta.get("round"), "name": event, "officialName": meta.get("officialName"),
        "date": str(meta.get("date")), "time": hhmm(meta.get("time")), "totalLaps": meta.get("laps"),
        "distanceKm": meta.get("distance"), "circuit": circuit_info, "winner": winner, "podium": podium,
        "outline": outline,
    }
    race = {
        **summary, "start": start, "end": end, "raceStart": race_start, "finish": finish_ms,
        "chunkMs": CHUNK_MS, "chunks": n_chunks, "drivers": raw_drivers, "laps": laps,
        # Packed as [seconds since start, driver, ...] to keep the file small.
        "positionsPacked": [[round((ts_ms(p["date"]) - start) / 1000, 1), p["driver_number"], p["position"]]
                            for p in positions],
        "intervalsPacked": [[round((ts_ms(i["date"]) - start) / 1000, 1), i["driver_number"], i["gap_to_leader"],
                             i["interval"]] for i in intervals], "stints": stints, "pits": pits,
        "driverStatus": driver_status, "raceControl": race_control, "weather": weather,
        "radio": radio, "track": track,
    }
    (out / "race.json").write_text(json.dumps(race, separators=(",", ":"), default=float))
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"  ok: {len(laps)} laps, {n_chunks} telemetry chunks, {len(radio)} radio clips, {size / 1e6:.1f} MB")
    return summary


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("filters", nargs="*", help="only races whose name contains one of these words")
    p.add_argument("--out", default="public/races", help="output folder (default public/races)")
    p.add_argument("--season", type=int, action="append", choices=sorted(RACES),
                   help="season to build; repeat for several (default: all)")
    args = p.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    index_path = out / "index.json"
    existing = json.loads(index_path.read_text())["races"] if index_path.exists() else []
    # Entries from older builds carry no season/dir; they were 2025 races at <out>/<slug>.
    index = {r.get("dir") or r["slug"]: r for r in existing}

    for season in args.season or sorted(RACES):
        for event, f1db_dir in RACES[season]:
            if args.filters and not any(f.lower() in event.lower() for f in args.filters):
                continue
            summary = build_race(season, event, f1db_dir, out)
            if not summary:
                continue
            index[summary["dir"]] = summary
            ordered = sorted(index.values(), key=lambda r: (r.get("season") or 0, r.get("round") or 0))
            index_path.write_text(json.dumps({
                "sources": [
                    {"name": "TracingInsights (FastF1 data)", "url": "https://github.com/TracingInsights",
                     "license": "Apache-2.0"},
                    {"name": "F1DB", "url": "https://github.com/f1db/f1db", "license": "CC BY 4.0"},
                ],
                "races": ordered,
            }, separators=(",", ":")))

if __name__ == "__main__":
    main()
