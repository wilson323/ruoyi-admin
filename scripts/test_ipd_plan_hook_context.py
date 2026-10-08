#!/usr/bin/env python3
"""Regression for executable IDE reminders that contradicted IPD authority."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("context_check", Path(__file__).with_name("check-ipd-plan-context.py"))
context = importlib.util.module_from_spec(spec)
spec.loader.exec_module(context)


class HookContextCases(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, relative, payload):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False))

    def test_old_claude_post_reminder_rejected(self):
        self.write(".claude/settings.json", {"hooks": {"PostToolUse": [{"hooks": [{"command": "echo '证据已写入 plan.md'; exit 0"}]}]}})
        self.assertEqual(len(context.ide_hook_problems(self.root)), 1)

    def test_old_codex_stop_reminder_rejected(self):
        self.write(".codex/hooks.json", {"hooks": {"Stop": [{"hooks": [{"command": "echo '证据已入 plan.md'; exit 0"}]}]}})
        self.assertEqual(len(context.ide_hook_problems(self.root)), 1)

    def test_existing_authority_reminder_allowed(self):
        self.write(".claude/settings.json", {"hooks": {"Stop": [{"hooks": [{"command": "echo '证据已回流原总画布、看板镜像及本次真实 receipt'; exit 0"}]}]}})
        self.assertEqual(context.ide_hook_problems(self.root), [])

    def test_direct_hook_shape_rejected(self):
        self.write(".codex/hooks.json", {"hooks": {"Stop": [{"command": "echo '证据已入 plan.md'"}]}})
        self.assertEqual(len(context.ide_hook_problems(self.root)), 1)

    def test_malformed_configuration_rejected(self):
        self.write(".claude/settings.json", {"hooks": {"Stop": [None]}})
        self.assertIn("无法完整解析", context.ide_hook_problems(self.root)[0])

    def test_negative_documentation_is_not_executable_reminder(self):
        self.write(".claude/settings.json", {"hooks": {}, "comment": "禁止将证据写入 plan.md"})
        self.assertEqual(context.ide_hook_problems(self.root), [])

    def test_optional_absent_configuration_allowed(self):
        self.assertEqual(context.ide_hook_problems(self.root), [])

    def test_relative_old_reminder_rejected(self):
        self.write(".codex/hooks.json", {"hooks": {"Stop": [{"command": "echo '证据已入 ./plan.md'"}]}})
        self.assertEqual(len(context.ide_hook_problems(self.root)), 1)

    def test_prohibition_in_executable_reminder_allowed(self):
        self.write(".claude/settings.json", {"hooks": {"Stop": [{"command": "echo '证据写入 plan.md 不允许'"}]}})
        self.assertEqual(context.ide_hook_problems(self.root), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
