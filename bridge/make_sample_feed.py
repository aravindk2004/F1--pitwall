"""Write a small synthetic raw feed in FastF1's recording format.

Lets you exercise the whole live path (bridge -> WebSocket -> dashboard)
without a real session:

    python make_sample_feed.py sample_feed.txt
    python bridge.py --replay-file sample_feed.txt --loop
"""

import base64
import json
import math
import sys
import zlib
from datetime import datetime, timedelta, timezone

DRIVERS = [
    ("1", "VER", "Max VERSTAPPEN", "Red Bull Racing", "3671C6"),
    ("4", "NOR", "Lando NORRIS", "McLaren", "FF8000"),
    ("16", "LEC", "Charles LECLERC", "Ferrari", "E8002D"),
    ("44", "HAM", "Lewis HAMILTON", "Ferrari", "E8002D"),
    ("63", "RUS", "George RUSSELL", "Mercedes", "27F4D2"),
    ("81", "PIA", "Oscar PIASTRI", "McLaren", "FF8000"),
]
LAP_S = 40.0
LAPS = 4


def z(obj) -> str:
    c = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    return base64.b64encode(c.compress(json.dumps(obj).encode()) + c.flush()).decode()


def iso(t: datetime) -> str:
    return t.isoformat().replace("+00:00", "Z")


def pos(i: int, t: float):
    lap_s = LAP_S * (1 + i * 0.01)
    u = (t - i * 0.4) / lap_s
    th = 2 * math.pi * u
    r = 1 + 0.25 * math.sin(3 * th)
    return u, int(5000 * r * math.cos(th)), int(3000 * r * math.sin(th)), 300 - 120 * abs(math.sin(3 * th))


def main(path: str) -> None:
    t0 = datetime(2025, 7, 6, 14, 0, tzinfo=timezone.utc)
    lines = []
    init = {
        "SessionInfo": {"Key": 9999, "Name": "Race", "Type": "Race", "StartDate": "2025-07-06T15:00:00",
                        "Path": "2025/sample/", "Meeting": {"Name": "Sample Grand Prix", "Location": "Sampleton",
                        "Country": {"Name": "Nowhere"}, "Circuit": {"ShortName": "Sample Ring"}}},
        "DriverList": {n: {"RacingNumber": n, "Tla": tla, "FullName": full, "TeamName": team, "TeamColour": col}
                       for n, tla, full, team, col in DRIVERS},
        "LapCount": {"CurrentLap": 1, "TotalLaps": LAPS},
        "TimingAppData": {"Lines": {n: {"Stints": [{"Compound": "MEDIUM", "New": "true", "TotalLaps": 0}]}
                                    for n, *_ in DRIVERS}},
        "WeatherData": {"AirTemp": "24.1", "TrackTemp": "38.0", "Humidity": "51.0", "Rainfall": "0",
                        "WindSpeed": "1.4", "WindDirection": "210", "Pressure": "1012.0"},
        "TimingData": {"Lines": {n: {"Position": str(i + 1), "NumberOfLaps": 0, "GapToLeader": "",
                                     "IntervalToPositionAhead": {"Value": ""}, "Retired": False,
                                     "InPit": False, "NumberOfPitStops": 0,
                                     "Sectors": [{"Value": ""}, {"Value": ""}, {"Value": ""}]}
                                 for i, (n, *_) in enumerate(DRIVERS)}},
    }
    for topic, data in init.items():
        lines.append(str([topic, json.dumps(data), ""]))

    laps_done = {n: 0 for n, *_ in DRIVERS}
    sector_done = {n: -1 for n, *_ in DRIVERS}
    steps = int(LAP_S * LAPS / 0.25)
    for k in range(steps):
        t = k * 0.25
        now = t0 + timedelta(seconds=t)
        if k % 4 == 0:
            entries = {n: {"Status": "OnTrack", "X": x, "Y": y, "Z": 0}
                       for i, (n, *_) in enumerate(DRIVERS) for _, x, y, _ in [pos(i, t)]}
            lines.append(str(["Position.z", z({"Position": [{"Timestamp": iso(now), "Entries": entries}]}), iso(now)]))
        cars = {}
        for i, (n, *_) in enumerate(DRIVERS):
            u, _, _, v = pos(i, t)
            gear = max(1, min(8, int(v / 40)))
            cars[n] = {"Channels": {"0": int(9000 + v * 10), "2": int(v), "3": gear, "4": 100 if v > 250 else 40,
                                    "5": 1 if v < 200 else 0, "45": 12 if v > 290 and u > 1 else 8}}
            done = int(u)
            sec = int((u - math.floor(u)) * 3)
            timing = {}
            if done > laps_done[n] and u > 0:
                laps_done[n] = done
                timing.update({"NumberOfLaps": done, "LastLapTime": {"Value": f"0:{LAP_S * (1 + i * 0.01):06.3f}"}})
            if sec != sector_done[n] and u > 0:
                finished = (sec - 1) % 3
                sector_done[n] = sec
                timing["Sectors"] = {str(finished): {"Value": f"{LAP_S / 3 * (1 + i * 0.01):.3f}",
                                                     "OverallFastest": i == 0, "PersonalFastest": i < 3}}
            if timing:
                if i > 0:
                    timing["GapToLeader"] = f"+{i * 0.45:.3f}"
                    timing["IntervalToPositionAhead"] = {"Value": "+0.450"}
                else:
                    timing["GapToLeader"] = f"LAP {done + 1}"
                lines.append(str(["TimingData", {"Lines": {n: timing}}, iso(now)]))
        lines.append(str(["CarData.z", z({"Entries": [{"Utc": iso(now), "Cars": cars}]}), iso(now)]))
        if k % 160 == 40:
            lines.append(str(["RaceControlMessages", {"Messages": {str(k): {"Utc": iso(now), "Category": "Other",
                              "Message": f"SAMPLE MESSAGE {k // 160 + 1}", "Lap": k // 160 + 1}}}, iso(now)]))
        if k % 200 == 100:
            lines.append(str(["TeamRadio", {"Captures": {str(k): {"Utc": iso(now), "RacingNumber": "4",
                              "Path": "TeamRadio/sample.mp3"}}}, iso(now)]))
        if k % 40 == 0:
            lines.append(str(["Heartbeat", {"Utc": iso(now)}, iso(now)]))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"wrote {len(lines)} messages to {path}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "sample_feed.txt")
