import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("http_probe", Path(__file__).with_name("loopback-http-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class HistoryBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.expected = {"group": [{"id": "message", "text": "PRIVATE_FIXTURE"}], "direct_budi": [], "direct_rian": []}
        self.payload = {"chats": copy.deepcopy(self.expected), "status": {"wakelock": {"uptimeSec": 5, "heartbeatAt": "old"}}}

    def test_live_telemetry_can_change_without_changing_history(self):
        self.payload["status"]["wakelock"] = {"uptimeSec": 99, "heartbeatAt": "new"}
        probe.assert_history_unchanged(self.expected, self.payload)

    def test_even_one_message_change_still_fails(self):
        self.payload["chats"]["group"][0]["text"] = "altered"
        with self.assertRaises(probe.BoundaryFailure) as error:
            probe.assert_history_unchanged(self.expected, self.payload)
        self.assertNotIn("PRIVATE_FIXTURE", str(error.exception))

    def test_room_add_remove_or_move_still_fails(self):
        for payload in [
            {"chats": {**copy.deepcopy(self.expected), "extra": []}},
            {"chats": {"group": self.expected["group"]}},
            {"chats": {"group": [], "direct_budi": self.expected["group"], "direct_rian": []}},
        ]:
            with self.assertRaises(probe.BoundaryFailure):
                probe.assert_history_unchanged(self.expected, payload)

    def test_missing_or_invalid_history_is_not_a_match(self):
        for payload in [None, {}, {"chats": []}, {"chats": {"group": "bad"}}]:
            with self.assertRaises(probe.BoundaryFailure):
                probe.assert_history_unchanged(self.expected, payload)

if __name__ == "__main__":
    unittest.main()
