#!/usr/bin/env python3
"""只读检查 IPD 当前指令和总计划的已知冲突，不验证业务完成。"""
import argparse
from pathlib import Path
import re
import sys


def validate(front, back, canvases):
    failures = []

    def read(path):
        if not path.is_file():
            failures.append(f"缺少入口：{path}")
            return ""
        return path.read_text(encoding="utf-8")

    for root in (front, back):
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
    states = re.findall(r'const CUT_STATE\s*=\s*"([^"]+)"', master)
    if len(states) != 1 or states[0] not in ("OPEN", "BLOCKED"):
        failures.append("总画布必须恰好有一个 OPEN/BLOCKED CUT_STATE")
    if states == ["OPEN"] and not re.search(r'const CUT_ACTION\s*=\s*"[^"\s][^"]*"', master):
        failures.append("OPEN 下一刀缺少动作")
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
