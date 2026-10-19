"""Translate the official F1 live timing feed into OpenF1-shaped records.

The dashboard already understands OpenF1's schema (it uses it for replays), so
the bridge emits the same field names. Every output is a ``(topic, record)``
pair that is sent to the browser as ``{"topic": ..., "data": record}``.

The feed sends a full state once, followed by partial updates that must be
deep-merged. Lists in the initial state (e.g. ``Sectors``) are later updated
as dicts keyed by index, so lists are normalised to index-keyed dicts.
"""

from __future__ import annotations

import base64
import json
import zlib
from datetime import datetime
from typing import Any, Iterator

STATIC_BASE = "https://livetiming.formula1.com/static/"

Record = dict[str, Any]
Output = tuple[str, Record]


def decode_z(payload: Any) -> Any:
    """Decode a compressed ``.z`` topic (base64 + raw deflate) into JSON."""
    if not isinstance(payload, str):
        return payload
    raw = zlib.decompress(base64.b64decode(payload), -zlib.MAX_WBITS)
    return json.loads(raw.decode("utf-8-sig"))


def _indexed(value: Any) -> Any:
    """Turn lists into ``{"0": ..., "1": ...}`` so updates can merge into them."""
    if isinstance(value, list):
        return {str(i): _indexed(v) for i, v in enumerate(value)}
    if isinstance(value, dict):
        return {str(k): _indexed(v) for k, v in value.items()}
    return value


def deep_merge(dst: dict, src: Any) -> dict:
    src = _indexed(src)
    if not isinstance(src, dict):
        return dst
    for key, value in src.items():
        if isinstance(value, dict) and isinstance(dst.get(key), dict):
            deep_merge(dst[key], value)
        else:
            dst[key] = value
    return dst


def _num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    n = _num(value)
    return int(n) if n is not None else None


def parse_laptime(value: Any) -> float | None:
    """'1:32.456' or '28.123' -> seconds."""
    if not isinstance(value, str) or not value.strip():
        return _num(value)
    parts = value.strip().split(":")
    try:
        secs = 0.0
        for p in parts:
            secs = secs * 60 + float(p)
        return secs
    except ValueError:
        return None


def parse_gap(value: Any) -> float | str | None:
    """Gap strings: '+1.234' -> 1.234, 'LAP 23' (leader) -> 0, '1L' -> '+1 LAP'."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    if text.upper().startswith("LAP"):
        return 0.0
    if text.upper().endswith("L") and text[:-1].lstrip("+").isdigit():
        laps = int(text[:-1].lstrip("+"))
        return f"+{laps} LAP{'S' if laps > 1 else ''}"
    n = _num(text.lstrip("+"))
    return n if n is not None else text


def _bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() == "true"
    return None


def _year(date: Any) -> int | None:
    try:
        return datetime.fromisoformat(str(date).replace("Z", "+00:00")).year
    except ValueError:
        return None


def _value(entry: Any) -> Any:
    return entry.get("Value") if isinstance(entry, dict) else entry


def _sector_flag(sector: dict) -> str | None:
    if not isinstance(sector, dict) or not sector.get("Value"):
        return None
    if sector.get("OverallFastest"):
        return "purple"
    if sector.get("PersonalFastest"):
        return "green"
    return "yellow"


class FeedTranslator:
    """Stateful translator: call :meth:`translate` with each feed message."""

    def __init__(self) -> None:
        self.state: dict[str, dict] = {}

    def _merge(self, topic: str, data: Any) -> dict:
        return deep_merge(self.state.setdefault(topic, {}), data)

    def translate(self, topic: str, data: Any, timestamp: str | None = None) -> list[Output]:
        if topic.endswith(".z"):
            data = decode_z(data)
            topic = topic[:-2]
        elif isinstance(data, str):
            try:
                data = json.loads(data)
            except ValueError:
                return []
        handler = getattr(self, f"_on_{topic}", None)
        if handler is None or not isinstance(data, dict):
            return []
        return list(handler(data, timestamp))

    # --- per-topic handlers ---------------------------------------------------

    def _on_Heartbeat(self, data: dict, ts: str | None) -> Iterator[Output]:
        yield "heartbeat", {"date": data.get("Utc") or ts}

    def _on_SessionInfo(self, data: dict, ts: str | None) -> Iterator[Output]:
        s = self._merge("SessionInfo", data)
        meeting = s.get("Meeting") or {}
        yield "session", {
            "session_key": s.get("Key"),
            "session_name": s.get("Name"),
            "session_type": s.get("Type"),
            "date_start": s.get("StartDate"),
            "location": meeting.get("Location"),
            "country_name": (meeting.get("Country") or {}).get("Name"),
            "circuit_short_name": (meeting.get("Circuit") or {}).get("ShortName"),
            "meeting_name": meeting.get("Name"),
            "year": _year(s.get("StartDate")),
        }

    def _on_LapCount(self, data: dict, ts: str | None) -> Iterator[Output]:
        s = self._merge("LapCount", data)
        yield "lap_count", {"current_lap": _int(s.get("CurrentLap")), "total_laps": _int(s.get("TotalLaps"))}

    def _on_DriverList(self, data: dict, ts: str | None) -> Iterator[Output]:
        merged = self._merge("DriverList", data)
        for num, update in data.items():
            if not isinstance(update, dict) or not ({"Tla", "FullName", "TeamName", "TeamColour"} & update.keys()):
                continue
            d = merged.get(str(num), {})
            number = _int(d.get("RacingNumber") or num)
            if number is None:
                continue
            yield "drivers", {
                "driver_number": number,
                "name_acronym": d.get("Tla"),
                "full_name": d.get("FullName"),
                "broadcast_name": d.get("BroadcastName"),
                "team_name": d.get("TeamName"),
                "team_colour": d.get("TeamColour"),
            }

    def _on_TimingData(self, data: dict, ts: str | None) -> Iterator[Output]:
        updates = _indexed(data.get("Lines") or {})
        merged_lines = self._merge("TimingData", data).get("Lines", {})
        for num, upd in updates.items():
            number = _int(num)
            if number is None or not isinstance(upd, dict):
                continue
            line = merged_lines.get(num, {})
            if "Position" in upd:
                yield "position", {"driver_number": number, "date": ts, "position": _int(line.get("Position"))}
            if "GapToLeader" in upd or "IntervalToPositionAhead" in upd:
                yield "intervals", {
                    "driver_number": number,
                    "date": ts,
                    "gap_to_leader": parse_gap(line.get("GapToLeader")),
                    "interval": parse_gap(_value(line.get("IntervalToPositionAhead"))),
                }
            if {"NumberOfLaps", "LastLapTime", "Sectors"} & upd.keys():
                rec: Record = {"driver_number": number, "date": ts}
                if "NumberOfLaps" in upd:
                    rec["lap_number"] = _int(line.get("NumberOfLaps"))
                if "LastLapTime" in upd and _value(upd["LastLapTime"]) is not None:
                    rec["lap_duration"] = parse_laptime(_value(line.get("LastLapTime")))
                sectors = line.get("Sectors") or {}
                for idx, sec_upd in (upd.get("Sectors") or {}).items():
                    if isinstance(sec_upd, dict) and "Value" in sec_upd and idx in ("0", "1", "2"):
                        rec[f"duration_sector_{int(idx) + 1}"] = parse_laptime(sectors.get(idx, {}).get("Value"))
                if "Sectors" in upd:
                    rec["sector_flags"] = [_sector_flag(sectors.get(str(i), {})) for i in range(3)]
                yield "laps", rec
            if {"Retired", "InPit", "NumberOfPitStops", "Stopped"} & upd.keys():
                yield "driver_status", {
                    "driver_number": number,
                    "date": ts,
                    "retired": bool(_bool(line.get("Retired"))),
                    "in_pit": bool(_bool(line.get("InPit"))),
                    "pit_stops": _int(line.get("NumberOfPitStops")),
                }

    def _on_TimingAppData(self, data: dict, ts: str | None) -> Iterator[Output]:
        updates = _indexed(data.get("Lines") or {})
        merged_lines = self._merge("TimingAppData", data).get("Lines", {})
        for num, upd in updates.items():
            number = _int(num)
            if number is None or not isinstance(upd, dict) or "Stints" not in upd:
                continue
            stints = merged_lines.get(num, {}).get("Stints") or {}
            for idx in (upd.get("Stints") or {}):
                stint = stints.get(idx) or {}
                yield "stints", {
                    "driver_number": number,
                    "stint_number": int(idx) + 1,
                    "compound": stint.get("Compound"),
                    # TotalLaps is the tyre's running age, so no lap_start offset is needed.
                    "tyre_age_at_start": _int(stint.get("TotalLaps")),
                    "lap_start": None,
                    "lap_end": None,
                    "new": _bool(stint.get("New")),
                }

    def _on_CarData(self, data: dict, ts: str | None) -> Iterator[Output]:
        entries = data.get("Entries") or []
        if not entries:
            return
        latest = entries[-1]  # newest sample per car is enough for the gauges
        for num, car in (latest.get("Cars") or {}).items():
            ch = (car or {}).get("Channels") or {}
            brake = _num(ch.get("5"))
            yield "car_data", {
                "driver_number": _int(num),
                "date": latest.get("Utc") or ts,
                "rpm": _num(ch.get("0")),
                "speed": _num(ch.get("2")),
                "n_gear": _int(ch.get("3")),
                "throttle": _num(ch.get("4")),
                "brake": brake * 100 if brake is not None and brake <= 1 else brake,
                "drs": _int(ch.get("45")),
            }

    def _on_Position(self, data: dict, ts: str | None) -> Iterator[Output]:
        # Forward every sample (not just the newest) so the map can interpolate.
        for entry in data.get("Position") or []:
            stamp = entry.get("Timestamp") or ts
            for num, pos in (entry.get("Entries") or {}).items():
                if not isinstance(pos, dict) or pos.get("X") is None:
                    continue
                yield "location", {
                    "driver_number": _int(num),
                    "date": stamp,
                    "x": _num(pos.get("X")),
                    "y": _num(pos.get("Y")),
                    "z": _num(pos.get("Z")),
                }

    def _on_TeamRadio(self, data: dict, ts: str | None) -> Iterator[Output]:
        path = (self.state.get("SessionInfo") or {}).get("Path") or ""
        for cap in _indexed(data.get("Captures") or {}).values():
            if not isinstance(cap, dict) or not cap.get("Path"):
                continue
            yield "team_radio", {
                "driver_number": _int(cap.get("RacingNumber")),
                "date": cap.get("Utc") or ts,
                "recording_url": f"{STATIC_BASE}{path}{cap['Path']}",
            }

    def _on_RaceControlMessages(self, data: dict, ts: str | None) -> Iterator[Output]:
        for msg in _indexed(data.get("Messages") or {}).values():
            if not isinstance(msg, dict):
                continue
            yield "race_control", {
                "date": msg.get("Utc") or ts,
                "category": msg.get("Category"),
                "flag": msg.get("Flag"),
                "message": msg.get("Message"),
                "lap_number": _int(msg.get("Lap")),
                "driver_number": _int(msg.get("RacingNumber")),
                "scope": msg.get("Scope"),
            }

    def _on_WeatherData(self, data: dict, ts: str | None) -> Iterator[Output]:
        w = self._merge("WeatherData", data)
        yield "weather", {
            "date": ts,
            "air_temperature": _num(w.get("AirTemp")),
            "track_temperature": _num(w.get("TrackTemp")),
            "humidity": _num(w.get("Humidity")),
            "pressure": _num(w.get("Pressure")),
            "rainfall": _num(w.get("Rainfall")),
            "wind_speed": _num(w.get("WindSpeed")),
            "wind_direction": _num(w.get("WindDirection")),
        }
