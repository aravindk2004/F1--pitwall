"""Live data from OpenF1's real-time API (needs a paid OpenF1 account).

An alternative to FastF1's connection: the bridge polls OpenF1 every few
seconds during a session and forwards each new record unchanged, since the
dashboard already speaks OpenF1's schema.

Authentication: POST username and password to https://api.openf1.org/token
and send the returned access token as a Bearer token. OpenF1 notes that some
feeds (car data, location, intervals) may not be available in real time;
missing feeds simply show "--" in the dashboard.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

log = logging.getLogger("f1-bridge.openf1")

BASE = "https://api.openf1.org/v1"
TOKEN_URL = "https://api.openf1.org/token"

# Endpoint -> (dashboard topic, field used to fetch only new rows)
TIME_SERIES = {
    "position": ("position", "date"),
    "intervals": ("intervals", "date"),
    "car_data": ("car_data", "date"),
    "location": ("location", "date"),
    "team_radio": ("team_radio", "date"),
    "race_control": ("race_control", "date"),
    "weather": ("weather", "date"),
    "pit": ("pit", "date"),
}
# Small tables that change in place: refetched and de-duplicated.
SNAPSHOTS = {"drivers": "drivers", "stints": "stints"}


class OpenF1Live:
    def __init__(self, username: str, password: str, publish: Callable[[str, dict], None], interval: float = 3.0):
        self.username = username
        self.password = password
        self.publish = publish
        self.interval = interval
        self.token: str | None = None
        self.token_expires = 0.0
        self.last_date: dict[str, str] = {}
        self.seen: set[str] = set()
        self.max_lap = 0
        self.session_key: int | None = None

    # --- HTTP (blocking; run in a worker thread) ---------------------------------

    def _login(self) -> None:
        body = urllib.parse.urlencode({"username": self.username, "password": self.password}).encode()
        req = urllib.request.Request(TOKEN_URL, data=body, method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
        self.token = data.get("access_token")
        if not self.token:
            raise RuntimeError(f"OpenF1 login returned no access_token (fields: {sorted(data)})")
        self.token_expires = time.time() + float(data.get("expires_in") or 3600) - 60
        log.info("logged in to OpenF1 (token valid for ~%d min)", (self.token_expires - time.time()) // 60)

    def _get(self, endpoint: str, query: str) -> list[dict]:
        if not self.token or time.time() > self.token_expires:
            self._login()
        req = urllib.request.Request(f"{BASE}/{endpoint}?{query}",
                                     headers={"Authorization": f"Bearer {self.token}", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:  # OpenF1's "no results"
                return []
            if e.code == 401:
                self.token = None
            raise
        return data if isinstance(data, list) else []

    # --- polling ---------------------------------------------------------------------

    def _emit_new(self, topic: str, rows: list[dict]) -> None:
        for row in rows:
            key = topic + json.dumps(row, sort_keys=True, default=str)
            if key in self.seen:
                continue
            self.seen.add(key)
            self.publish(topic, row)
        if len(self.seen) > 200_000:  # keep memory bounded on long sessions
            self.seen.clear()

    def _poll_once(self) -> None:
        if self.session_key is None:
            sessions = self._get("sessions", "session_key=latest")
            if not sessions:
                log.info("no session yet")
                return
            s = sessions[0]
            self.session_key = s["session_key"]
            meeting = self._get("meetings", f"meeting_key={s.get('meeting_key')}") if s.get("meeting_key") else []
            self.publish("session", {**s, "meeting_name": meeting[0].get("meeting_name") if meeting else None})
            log.info("following session %s (%s %s)", self.session_key, s.get("location"), s.get("session_name"))

        sk = f"session_key={self.session_key}"
        for endpoint, topic in SNAPSHOTS.items():
            self._emit_new(topic, self._get(endpoint, sk))
        for endpoint, (topic, field) in TIME_SERIES.items():
            since = self.last_date.get(endpoint)
            q = sk + (f"&{field}%3E{urllib.parse.quote(since)}" if since else "")
            rows = self._get(endpoint, q)
            if rows:
                self.last_date[endpoint] = max(str(r.get(field) or "") for r in rows)
                for r in rows:
                    self.publish(topic, r)
        # Laps are updated in place when they finish, so re-read the last two.
        laps = self._get("laps", sk + f"&lap_number%3E={max(1, self.max_lap - 1)}")
        if laps:
            self.max_lap = max(self.max_lap, *(int(r.get("lap_number") or 0) for r in laps))
            self._emit_new("laps", laps)

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        backoff = self.interval
        while True:
            try:
                await loop.run_in_executor(None, self._poll_once)
                backoff = self.interval
            except Exception as e:  # network, auth or API errors: keep trying
                log.warning("OpenF1 poll failed: %s", e)
                backoff = min(60.0, backoff * 2)
            await asyncio.sleep(backoff)
