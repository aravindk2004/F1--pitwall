"""Run with: python -m unittest test_openf1_live.py"""

import unittest

from openf1_live import OpenF1Live


class FakeOpenF1(OpenF1Live):
    """Answers from canned rows instead of the network."""

    def __init__(self, rows):
        self.published = []
        super().__init__("user", "pass", lambda t, r: self.published.append((t, r)))
        self.rows = rows
        self.queries = []

    def _get(self, endpoint, query):
        self.queries.append((endpoint, query))
        return list(self.rows.get(endpoint, []))


class OpenF1LiveTest(unittest.TestCase):
    def test_follows_latest_session_and_only_sends_new_rows(self):
        f = FakeOpenF1({
            "sessions": [{"session_key": 9999, "meeting_key": 1, "session_name": "Race", "location": "Monza"}],
            "meetings": [{"meeting_name": "Italian Grand Prix"}],
            "drivers": [{"driver_number": 1, "name_acronym": "VER"}],
            "position": [{"driver_number": 1, "date": "2026-09-06T13:05:00", "position": 1}],
            "laps": [{"driver_number": 1, "lap_number": 3, "lap_duration": None}],
        })
        f._poll_once()
        topics = [t for t, _ in f.published]
        self.assertEqual(topics[0], "session")
        self.assertEqual(f.published[0][1]["meeting_name"], "Italian Grand Prix")
        self.assertIn("drivers", topics)
        self.assertIn("position", topics)
        self.assertEqual(f.max_lap, 3)

        # Second poll: position asks only for newer rows; unchanged snapshots are not re-sent.
        f.published.clear()
        f.rows["position"] = []
        f.rows["laps"] = [{"driver_number": 1, "lap_number": 3, "lap_duration": 81.2}]
        f._poll_once()
        position_query = [q for e, q in f.queries if e == "position"][-1]
        self.assertIn("date%3E2026-09-06T13%3A05%3A00", position_query)
        self.assertEqual([t for t, _ in f.published], ["laps"])  # the lap, now with its time
        laps_query = [q for e, q in f.queries if e == "laps"][-1]
        self.assertIn("lap_number%3E=2", laps_query)


if __name__ == "__main__":
    unittest.main()
