#!/usr/bin/env python3
"""只读检查 IPD 当前指令和总计划的已知冲突，不验证业务完成。"""
import argparse
import json
from pathlib import Path
import re
import sys


def ide_hook_problems(root):
    """Inspect executable reminders; configuration presence is not host coverage."""
    failures = []
    for relative in (".claude/settings.json", ".codex/hooks.json"):
        path = root / relative
        if not path.is_file():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            hooks = payload["hooks"]
            if not isinstance(hooks, dict):
                raise ValueError("hooks must be an object")
            for event, groups in hooks.items():
                if not isinstance(groups, list):
                    raise ValueError("event hooks must be a list")
                for group in groups:
                    entries = group.get("hooks", [group])
                    if not isinstance(entries, list):
                        raise ValueError("nested hooks must be a list")
                    for entry in entries:
                        command = entry.get("command", "")
                        if not isinstance(command, str):
                            raise ValueError("command must be text")
                        if re.search(r"证据已(?:写入|入)\s*(?:\./)?plan\.md", command):
                            failures.append(f"{root.name}/{relative} {event}: 提醒仍将证据写向第二份 plan.md")
        except (ValueError, KeyError, TypeError, AttributeError, OSError):
            failures.append(f"{root.name}/{relative}: IDE hook 配置无法完整解析")
    return failures


def execution_problems(text):
    """Current master contract; shared by context check and Cursor write hook."""
    states = re.findall(r'const CUT_STATE\s*=\s*"([^"]+)"', text)
    actions = re.findall(r'const CUT_ACTION\s*=\s*"([^"]*)"', text)
    unblocks = re.findall(r'const CUT_UNBLOCK\s*=\s*"([^"]*)"', text)
    if len(states) != 1 or states[0] not in ("OPEN", "BLOCKED"):
        return ["总画布必须恰好有一个 OPEN/BLOCKED CUT_STATE"]
    failures = []
    if states[0] == "OPEN":
        if len(actions) != 1 or not actions[0].strip() or unblocks:
            failures.append("OPEN 必须有唯一非空动作，不能同时有解除条件")
    elif len(unblocks) != 1 or not unblocks[0].strip() or actions:
        failures.append("BLOCKED 必须有唯一非空解除条件，不能同时有动作")
    # Old display widgets are optional in the current canvas. If retained,
    # they must agree with authority rather than create a second state.
    stats = re.findall(r'<Stat value="([^"]*)" label="全项目下一刀"', text)
    if stats and (len(stats) != 1 or not stats[0].startswith(states[0])):
        failures.append("下一刀展示与唯一 CUT_STATE 冲突")
    return failures


def validate(front, back, canvases):
    failures = []

    def read(path):
        if not path.is_file():
            failures.append(f"缺少入口：{path}")
            return ""
        return path.read_text(encoding="utf-8")

    for root in (front, back):
        failures.extend(ide_hook_problems(root))
        text = read(root / "AGENTS.md")
        if "## 当前任务范围与证据" not in text:
            failures.append(f"{root.name}: 缺少当前任务范围入口")
        if "②commit+push" in text or "Issue 流程：GitHub Issues" in text:
            failures.append(f"{root.name}: 历史发布或提交指令仍为默认入口")
    guide = read(back / "CLAUDE.md")
    if "GitHub Issues（gh CLI）—— origin" in guide:
        failures.append("CLAUDE.md 仍将 IPD 默认路由到 GitHub")
    tracker = read(back / "docs/agents/issue-tracker-github.md")
    if "Issues and specs for this repo live as GitHub issues" in tracker or re.search(r"^Create a GitHub issue\.$", tracker, re.M):
        failures.append("IPD 事项仍默认路由到 GitHub")

    master = read(canvases / "ipd-execution-plan.canvas.tsx")
    failures.extend(execution_problems(master))
    if "历史证据不能当当前状态" not in master:
        failures.append("总画布缺少历史运行记录的时效说明")
    sections = re.findall(r'"(ipd-[\w-]+\.canvas\.tsx)"', master)
    for filename in dict.fromkeys(sections):
        text = read(canvases / filename)
        if "以总计划为准" not in re.sub(r"\s+", "", text):
            failures.append(f"{filename}: 分节缺少总计划归属")
        if re.search(r"const CUT_STATE\s*=", text):
            failures.append(f"{filename}: 分节另设全项目下一刀")
        for stale in ("ProjectAgentPrompt 只拼用户句、动作码和技能正文", "向量化两键补到当前生效模型之后", "要限额就给这一个模型补预算行"):
            if stale in text:
                failures.append(f"{filename}: 过期指令仍可驱动执行：{stale}")
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--front", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--back", type=Path, default=Path("/Users/mac/Documents/ruoyi-ai"))
    parser.add_argument("--canvases", type=Path, default=Path("/Users/mac/.cursor/projects/Users-mac-Documents-ruoyi-ipd-web/canvases"))
    args = parser.parse_args()
    failures = validate(args.front.resolve(), args.back.resolve(), args.canvases.resolve())
    for failure in failures:
        print(f"FAIL: {failure}")
    if failures:
        return 1
    print("PASS: 当前入口的已知计划/范围冲突检查通过；未验证模型行为、运行包或业务验收。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
