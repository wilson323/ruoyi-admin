#!/usr/bin/env python3
"""Read-only correction candidate inventory, not an error classifier or task tracker.

Only user-role text is inspected. Output contains locations and fixed category
labels, never conversation text, tool output, credentials or model reasoning.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import time

CATEGORIES = {
    "drift": re.compile(r"漂移|飘移|双轨"),
    "unsupported_claim": re.compile(r"幻觉|你确定|你.{0,8}搞错"),
    "recurrence": re.compile(r"又.{0,8}(?:错|问题)|重复.{0,8}(?:错|问题)"),
    "wrong_entry": re.compile(r"本项目.{0,12}ruoyi-ai|不是.{0,15}副驾"),
}
INJECTED = ("AGENTS.md", "<INSTRUCTIONS>", "<environment_context>",
            "<openviking", "<system-reminder>", "<skills_instructions>")


def user_text(record):
    """Normalize observed Claude, Codex and Cursor record envelopes."""
    if not isinstance(record, dict):
        return ""
    message = record.get("message")
    if not isinstance(message, dict):
        message = record.get("payload", {})
    if not isinstance(message, dict) or message.get("role", record.get("role")) != "user":
        return ""
    content = message.get("content", [])
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "\n".join(x.get("text", "") for x in content if isinstance(x, dict)
                     and x.get("type") in ("text", "input_text") and isinstance(x.get("text"), str))


def scan(sources):
    counts, candidates, errors, changed, fingerprints = Counter(), [], [], [], []
    for ide, root in sources:
        if not root.is_dir():
            errors.append({"path": str(root), "error_type": "MissingSourceDirectory"})
            continue
        for path in sorted(root.rglob("*.jsonl")):
            if ide == "Cursor" and "agent-transcripts" not in path.parts:
                continue
            counts[ide + ":files"] += 1
            digest = hashlib.sha256()
            try:
                before = path.stat()
                with path.open("rb") as handle:
                    for number, raw in enumerate(handle, 1):
                        digest.update(raw)
                        try:
                            record = json.loads(raw)
                        except (ValueError, UnicodeError):
                            counts[ide + ":invalid_json_lines"] += 1
                            continue
                        text = user_text(record)
                        if not text:
                            continue
                        counts[ide + ":user_text_messages"] += 1
                        if len(text) > 2000 or any(marker in text for marker in INJECTED):
                            continue
                        labels = [name for name, pattern in CATEGORIES.items() if pattern.search(text)]
                        if labels:
                            counts[ide + ":candidate_messages"] += 1
                            candidates.append({"ide": ide, "path": str(path), "line": number,
                                               "characters": len(text), "categories": labels})
                after = path.stat()
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    changed.append(str(path))
                fingerprints.append({"path": str(path), "sha256": digest.hexdigest()})
            except OSError as error:
                errors.append({"path": str(path), "error_type": type(error).__name__})
        print(ide, "files", counts[ide + ":files"], "candidates", counts[ide + ":candidate_messages"], flush=True)
    return {"scope": "Accessible JSONL at scan time; short user-text keyword candidates only. "
            "Not semantic review, unique failures, or an atomic snapshot; sidechains may duplicate events.",
            "counts": dict(counts), "errors": errors, "changed_during_scan": changed,
            "candidate_locations": candidates, "source_fingerprints": fingerprints}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    started = time.time()
    result = scan([(name, args.home / relative) for name, relative in
                   (("Codex", ".codex/sessions"), ("Claude", ".claude/projects"), ("Cursor", ".cursor/projects"))])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    output = args.root / f".harness/audit/ide-history-correction-index-{stamp}.json"
    if not output.resolve().is_relative_to(args.root.resolve()):
        raise ValueError("Audit output must stay in the existing project evidence directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    result["duration_seconds"] = round(time.time() - started, 2)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    print(json.dumps({"counts": result["counts"], "errors": len(result["errors"]),
                      "changed_during_scan": len(result["changed_during_scan"]), "output": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
