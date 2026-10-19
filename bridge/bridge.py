"""F1 live timing -> local WebSocket bridge for the dashboard.

Receives the official timing feed through FastF1's SignalR client
(``fastf1.livetiming.client.SignalRClient``), translates it into
OpenF1-shaped records and serves them on ``ws://localhost:8765`` as
``{"topic": "...", "data": {...}}`` messages.

Usage:
    python bridge.py                       # live, during a session
    python bridge.py --record session.txt  # live, and keep the raw feed
    python bridge.py --replay-file session.txt --speed 5   # re-play a recording
"""

from __future__ import annotations

import argparse
import ast
import asyncio
import json
import logging
import os
import signal
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

from websockets.asyncio.server import ServerConnection, broadcast, serve

from translator import FeedTranslator

log = logging.getLogger("f1-bridge")

# Topics whose records describe a single driver; the newest one is cached per driver.
PER_DRIVER = {"drivers", "position", "intervals", "laps", "stints", "driver_status", "car_data", "location"}
# Topics kept as a short history for clients that connect mid-session.
HISTORY = {"team_radio": 40, "race_control": 40}


class Hub:
    """Fans translated records out to every connected browser."""

    def __init__(self) -> None:
        self.clients: set[ServerConnection] = set()
        self.translator = FeedTranslator()
        self.latest: dict[tuple[str, Any], dict] = {}
        self.history: dict[str, deque] = {t: deque(maxlen=n) for t, n in HISTORY.items()}
        self.messages = 0

    def _remember(self, topic: str, record: dict) -> None:
        if topic in HISTORY:
            self.history[topic].append(record)
        elif topic in PER_DRIVER:
            key = (topic, record.get("driver_number"))
            # Merge partial updates (e.g. one sector) so a late joiner gets the full row.
            self.latest[key] = {**self.latest.get(key, {}), **record}
        else:
            self.latest[(topic, None)] = record

    def ingest(self, topic: str, data: Any, timestamp: str | None) -> None:
        try:
            outputs = self.translator.translate(topic, data, timestamp)
        except Exception:  # a malformed message must never kill the bridge
            log.exception("could not translate %s", topic)
            return
        for out_topic, record in outputs:
            self._remember(out_topic, record)
            self.messages += 1
            if self.clients:
                broadcast(self.clients, json.dumps({"topic": out_topic, "data": record}, default=str))

    def snapshot_messages(self) -> list[str]:
        """Everything a newly connected client needs to render the current state."""
        order = ["session", "lap_count", "drivers", "stints", "laps", "position", "intervals",
                 "driver_status", "weather", "car_data", "location"]
        rank = {t: i for i, t in enumerate(order)}
        msgs = sorted(self.latest.items(), key=lambda kv: rank.get(kv[0][0], len(order)))
        out = [json.dumps({"topic": topic, "data": rec}, default=str) for (topic, _), rec in msgs]
        for topic, items in self.history.items():
            out.extend(json.dumps({"topic": topic, "data": rec}, default=str) for rec in items)
        return out

    async def handler(self, ws: ServerConnection) -> None:
        self.clients.add(ws)
        log.info("client connected (%d total)", len(self.clients))
        try:
            for msg in self.snapshot_messages():
                await ws.send(msg)
            await ws.wait_closed()
        finally:
            self.clients.discard(ws)
            log.info("client disconnected (%d total)", len(self.clients))


# --- live feed via FastF1 --------------------------------------------------------


def start_live_client(hub: Hub, loop: asyncio.AbstractEventLoop, args: argparse.Namespace):
    """Run FastF1's SignalR client in a background thread and forward its messages."""
    from fastf1.livetiming.client import SignalRClient
    from signalrcore.messages.completion_message import CompletionMessage

    def forward(topic: str, data: Any, ts: str | None) -> None:
        loop.call_soon_threadsafe(hub.ingest, topic, data, ts)

    class BridgeClient(SignalRClient):
        def _on_message(self, msg):  # noqa: D401 - overrides FastF1 internals
            # Keep FastF1's behaviour (writes the raw feed to `filename`) ...
            super()._on_message(msg)
            # ... and also forward each message to the browser.
            try:
                if isinstance(msg, CompletionMessage):
                    # Reply to "Subscribe": the full current state, keyed by topic.
                    for topic, data in (msg.result or {}).items():
                        forward(topic, data, None)
                elif isinstance(msg, list) and len(msg) >= 2:
                    forward(msg[0], msg[1], msg[2] if len(msg) > 2 else None)
            except Exception:
                log.exception("failed to forward message")

    client = BridgeClient(
        filename=args.record or os.devnull,
        filemode="a" if args.record else "w",
        timeout=args.timeout,
        no_auth=args.no_auth,
    )

    def run() -> None:
        try:
            client.start()
        except Exception:
            log.exception("live timing client stopped with an error")
        log.warning("live timing client exited")

    threading.Thread(target=run, name="fastf1-signalr", daemon=True).start()
    return client


# --- replay of a recorded raw feed -----------------------------------------------


def parse_recording_line(line: str) -> tuple[str, Any, str | None] | None:
    """Lines saved by SignalRClient are Python reprs: [topic, data, timestamp]."""
    line = line.strip()
    if not line:
        return None
    try:
        item = ast.literal_eval(line)
    except (ValueError, SyntaxError):
        try:
            item = json.loads(line)
        except ValueError:
            return None
    if not isinstance(item, (list, tuple)) or len(item) < 2:
        return None
    ts = item[2] if len(item) > 2 and item[2] else None
    return str(item[0]), item[1], ts


def _ts_seconds(ts: str | None) -> float | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


async def replay_file(hub: Hub, path: str, speed: float, loop_forever: bool) -> None:
    while True:
        log.info("replaying %s at %.1fx", path, speed)
        prev_ts: float | None = None
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                parsed = parse_recording_line(line)
                if not parsed:
                    continue
                topic, data, ts = parsed
                t = _ts_seconds(ts)
                if t is not None and prev_ts is not None and t > prev_ts:
                    await asyncio.sleep(min(5.0, (t - prev_ts) / speed))
                if t is not None:
                    prev_ts = t
                # Re-stamp so the dashboard treats the replay as "now".
                hub.ingest(topic, data, datetime.now(timezone.utc).isoformat() if ts else None)
        if not loop_forever:
            log.info("replay finished; still serving the last state (Ctrl+C to stop)")
            return


# --- main ------------------------------------------------------------------------


async def main(args: argparse.Namespace) -> None:
    hub = Hub()
    loop = asyncio.get_running_loop()
    stop = loop.create_future()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda: stop.done() or stop.set_result(None))
        except NotImplementedError:  # Windows
            pass

    async with serve(hub.handler, args.host, args.port, max_size=2**22) as server:
        log.info("serving on ws://%s:%d", args.host, args.port)
        client = None
        if args.replay_file:
            loop.create_task(replay_file(hub, args.replay_file, args.speed, args.loop))
        else:
            client = start_live_client(hub, loop, args)

        async def stats() -> None:
            last = 0
            while True:
                await asyncio.sleep(30)
                log.info("%d clients, %d records forwarded (+%d)", len(hub.clients), hub.messages, hub.messages - last)
                last = hub.messages

        stats_task = loop.create_task(stats())
        try:
            await stop
        finally:
            stats_task.cancel()
            log.info("shutting down")
            if client is not None and getattr(client, "_connection", None) is not None:
                try:
                    client._connection.stop()
                except Exception:
                    pass
            server.close()


def cli() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Forward F1 live timing to the dashboard over WebSocket.")
    p.add_argument("--host", default="127.0.0.1", help="interface to bind (default 127.0.0.1)")
    p.add_argument("--port", type=int, default=8765, help="WebSocket port (default 8765)")
    p.add_argument("--record", metavar="FILE", help="also append the raw feed to FILE (replayable later)")
    p.add_argument("--no-auth", action="store_true", help="connect without F1TV authentication (may give partial data)")
    p.add_argument("--timeout", type=int, default=0,
                   help="exit the feed client after N seconds without data (0 = never, default)")
    p.add_argument("--replay-file", metavar="FILE", help="replay a raw feed saved with --record or "
                   "`python -m fastf1.livetiming save` instead of connecting live")
    p.add_argument("--speed", type=float, default=1.0, help="replay speed multiplier (default 1)")
    p.add_argument("--loop", action="store_true", help="restart the replay file when it ends")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


if __name__ == "__main__":
    args = cli()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    started = time.time()
    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        pass
    log.info("stopped after %.0fs", time.time() - started)
