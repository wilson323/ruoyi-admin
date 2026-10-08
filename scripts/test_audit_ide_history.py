#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("ide_history", Path(__file__).with_name("audit-ide-history.py"))
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


class EnvelopeCases(unittest.TestCase):
    def test_claude_message_role(self):
        self.assertEqual(history.user_text({"message": {"role": "user", "content": "你确定"}}), "你确定")

    def test_codex_payload_role(self):
        self.assertEqual(history.user_text({"payload": {"role": "user", "content": [{"type": "input_text", "text": "漂移"}]}}), "漂移")

    def test_cursor_top_level_role(self):
        self.assertEqual(history.user_text({"role": "user", "message": {"content": [{"type": "text", "text": "双轨"}]}}), "双轨")

    def test_assistant_and_tool_results_excluded(self):
        self.assertEqual(history.user_text({"message": {"role": "assistant", "content": "你确定"}}), "")
        self.assertEqual(history.user_text({"message": {"role": "user", "content": [{"type": "tool_result", "content": "你确定"}]}}), "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
