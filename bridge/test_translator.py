"""Run with: python -m unittest test_translator.py"""

import base64
import json
import unittest
import zlib

from translator import FeedTranslator, parse_gap, parse_laptime


def z(obj) -> str:
    c = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    return base64.b64encode(c.compress(json.dumps(obj).encode()) + c.flush()).decode()


class TranslatorTest(unittest.TestCase):
    def test_parsers(self):
        self.assertAlmostEqual(parse_laptime("1:32.456"), 92.456)
        self.assertEqual(parse_gap("LAP 12"), 0.0)
        self.assertEqual(parse_gap("+1.234"), 1.234)
        self.assertEqual(parse_gap("1L"), "+1 LAP")
        self.assertEqual(parse_gap("3L"), "+3 LAPS")
        self.assertIsNone(parse_gap(""))

    def test_timing_data_merges_partial_updates(self):
        tr = FeedTranslator()
        tr.translate("TimingData", {"Lines": {"1": {"Position": "1", "NumberOfLaps": 3,
                     "Sectors": [{"Value": "28.1"}, {"Value": "30.2"}, {"Value": "29.9"}]}}})
        out = tr.translate("TimingData", {"Lines": {"1": {"Sectors": {"1": {"Value": "29.5",
                           "OverallFastest": True}}}}}, "2025-01-01T00:00:00Z")
        laps = [r for t, r in out if t == "laps"]
        self.assertEqual(len(laps), 1)
        self.assertEqual(laps[0]["duration_sector_2"], 29.5)
        self.assertNotIn("duration_sector_1", laps[0])
        self.assertEqual(laps[0]["sector_flags"], ["yellow", "purple", "yellow"])

    def test_compressed_topics(self):
        tr = FeedTranslator()
        car = tr.translate("CarData.z", z({"Entries": [{"Utc": "t", "Cars": {"44": {"Channels":
                           {"0": 11000, "2": 301, "3": 7, "4": 100, "5": 0, "45": 12}}}}]}))
        self.assertEqual(car, [("car_data", {"driver_number": 44, "date": "t", "rpm": 11000.0, "speed": 301.0,
                                             "n_gear": 7, "throttle": 100.0, "brake": 0.0, "drs": 12})])
        loc = tr.translate("Position.z", z({"Position": [{"Timestamp": "a", "Entries": {"1": {"X": 1, "Y": 2, "Z": 3}}},
                                                         {"Timestamp": "b", "Entries": {"1": {"X": 4, "Y": 5, "Z": 6}}}]}))
        self.assertEqual([r["x"] for _, r in loc], [1.0, 4.0])

    def test_radio_url_uses_session_path(self):
        tr = FeedTranslator()
        tr.translate("SessionInfo", {"Path": "2025/x/", "Name": "Race"})
        out = tr.translate("TeamRadio", {"Captures": [{"Utc": "u", "RacingNumber": "4", "Path": "TeamRadio/a.mp3"}]})
        self.assertEqual(out[0][1]["recording_url"], "https://livetiming.formula1.com/static/2025/x/TeamRadio/a.mp3")

    def test_bad_input_is_ignored(self):
        tr = FeedTranslator()
        self.assertEqual(tr.translate("TimingData", "not json"), [])
        self.assertEqual(tr.translate("UnknownTopic", {"a": 1}), [])


if __name__ == "__main__":
    unittest.main()
