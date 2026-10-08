#!/usr/bin/python3
"""拒绝没有唯一下一刀终态的执行计划画布写入。"""

import json
import os
import sys
import importlib.util
from pathlib import Path

CANVAS_NAME = "ipd-execution-plan.canvas.tsx"


def problems(text):
    """Use the existing context verifier, never maintain a parallel contract."""
    path = Path(__file__).resolve().parents[2] / 'scripts/check-ipd-plan-context.py'
    spec = importlib.util.spec_from_file_location('ipd_plan_context', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.execution_problems(text or '')


def allow():
    print(json.dumps({"permission": "allow"}))
    raise SystemExit(0)


def deny(message):
    print(json.dumps({
        "permission": "deny",
        "user_message": message,
        "agent_message": message,
    }))
    raise SystemExit(2)


def tool_payload(payload):
    """取出工具参数。参数可能在 tool_input，也可能是 JSON 字符串。"""
    raw = payload.get("tool_input")
    if raw is None:
        raw = payload.get("toolInput") or payload.get("input") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = {}
    return raw if isinstance(raw, dict) else {}


def first_present(source, names):
    """按顺序返回第一个存在的字段。"""
    for name in names:
        if name in source and source.get(name) is not None:
            return source.get(name)
    return None


def proposed_text(payload):
    """从写入工具参数得到写完之后的正文。"""
    tool_input = tool_payload(payload)
    path = first_present(tool_input, ("path", "file_path", "filePath")) or ""
    if CANVAS_NAME not in str(path).replace("\\", "/"):
        return None
    contents = first_present(tool_input, ("contents", "content"))
    if isinstance(contents, str):
        return contents
    edits = tool_input.get("edits")
    if isinstance(edits, list) and edits:
        with open(path, encoding="utf-8") as handle:
            current = handle.read()
        for edit in edits:
            if not isinstance(edit, dict):
                deny("执行计划画布的写入结果无法计算，拒绝写入")
            old = first_present(edit, ("old_string", "oldString", "old_str"))
            new = first_present(edit, ("new_string", "newString", "new_str"))
            if not isinstance(old, str) or not isinstance(new, str):
                deny("执行计划画布的写入结果无法计算，拒绝写入")
            count = current.count(old)
            if count != 1:
                deny("执行计划画布的替换不是唯一一处，拒绝写入")
            current = current.replace(old, new, 1)
        return current
    old = first_present(tool_input, ("old_string", "oldString", "old_str"))
    new = first_present(tool_input, ("new_string", "newString", "new_str"))
    if not isinstance(old, str) or not isinstance(new, str):
        deny("执行计划画布的写入结果无法计算，拒绝写入")
    with open(path, encoding="utf-8") as handle:
        current = handle.read()
    count = current.count(old)
    if count != 1:
        deny("执行计划画布的替换不是唯一一处，拒绝写入")
    return current.replace(old, new, 1)


def main():
    if "--stdin-text" in sys.argv:
        text = sys.stdin.read()
        found = problems(text)
        if os.environ.get("FAIL_SEED") == "1":
            sys.stderr.write("FAIL_SEED\n")
            raise SystemExit(1)
        if found:
            sys.stderr.write("\n".join(found) + "\n")
            raise SystemExit(2)
        raise SystemExit(0)
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        deny("画布检查输入不是有效 JSON，不能证明安全，拒绝放行")
    if not isinstance(payload, dict):
        deny("画布检查输入必须是对象，拒绝放行")
    tool = payload.get("tool_name") or payload.get("tool") or ""
    if tool not in ("Write", "StrReplace", "Edit", "MultiEdit"):
        allow()
    text = proposed_text(payload)
    if text is None:
        allow()
    if os.environ.get("FAIL_SEED") == "1":
        deny("FAIL_SEED：下一刀检查被强制打红")
    found = problems(text)
    if found:
        deny("执行计划画布被拒绝：" + "；".join(found))
    allow()


if __name__ == "__main__":
    main()
