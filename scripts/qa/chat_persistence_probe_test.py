"""Behavioral negative controls for the shared desktop/Android persistence probe."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("persistence_probe", Path(__file__).with_name("chat-persistence-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ChatPersistenceProbeTests(unittest.TestCase):
    def setUp(self):
        self.proof = {"schemaVersion": 1, "fixtureCount": 1,
                      "expectedRooms": {"group": [{"id": "fixture", "text": "PRIVATE_FIXTURE_DO_NOT_LOG", "quoted": {"id": "old"}}],
                                        "direct_budi": [], "direct_rian": []},
                      "untouchedRooms": {"custom_room": [{"id": "unrelated"}]}}
        self.snapshot = {"chats": copy.deepcopy({**self.proof["expectedRooms"], **self.proof["untouchedRooms"]})}

    def rejected(self):
        with self.assertRaises(probe.ProbeFailure) as error:
            probe.validate_snapshot(self.proof, self.snapshot)
        self.assertNotIn("PRIVATE_FIXTURE", str(error.exception))

    def test_exact_snapshot_is_accepted(self):
        probe.validate_snapshot(self.proof, self.snapshot)

    def test_lost_message_is_rejected(self):
        self.snapshot["chats"]["group"].clear()
        self.rejected()

    def test_duplicate_message_is_rejected(self):
        self.snapshot["chats"]["group"] *= 2
        self.rejected()

    def test_cross_room_move_is_rejected(self):
        self.snapshot["chats"]["direct_budi"] = self.snapshot["chats"]["group"]
        self.snapshot["chats"]["group"] = []
        self.rejected()

    def test_changed_quote_or_message_is_rejected(self):
        self.snapshot["chats"]["group"][0]["quoted"]["id"] = "wrong"
        self.rejected()

    def test_unrelated_room_is_preserved(self):
        self.snapshot["chats"]["custom_room"] = []
        self.rejected()

    def test_unexpected_private_room_is_rejected(self):
        self.snapshot["chats"]["direct_zovia"] = []
        self.rejected()

    def test_only_explicit_loopback_urls_are_allowed(self):
        self.assertEqual(probe.loopback_url("http://127.0.0.1:33000/"), "http://127.0.0.1:33000")
        for value in ["http://example.org:3000", "http://0.0.0.0:3000", "http://127.0.0.1:3000@evil.test", "http://127.0.0.1:3000/api", "http://127.0.0.1", "https://127.0.0.1:3000", "http://127.0.0.1:abc"]:
            with self.subTest(value=value), self.assertRaises(probe.ProbeFailure):
                probe.loopback_url(value)


if __name__ == "__main__":
    unittest.main()
