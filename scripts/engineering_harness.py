#!/usr/bin/env python3
"""IPD existing .harness adapter: real execution, evidence and bounded learning.

Not an OS sandbox, business executor, model trainer or second task tracker.
All runtime records are private, local evidence under the existing .harness.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

VERSION = "1.0.0"
PROCEDURES = {
    "PROCESS_FAILED": "检查原始退出码与日志；不能根据 PASS 文本放行。",
    "TIMEOUT": "先查目标状态再重试；不得重复不确定的副作用。",
    "MISSING_TOOL": "核实命令与依赖存在；缺失不能跳过必需检查。",
    "EMPTY_EVIDENCE": "检查实际执行和非空测试/产物；禁止零样本验收。",
    "DIAGNOSTICS": "核对完整诊断；不得用旧错误数量抵消新错误。",
    "STALE_INPUT": "输入发生变化；重新冻结候选并运行受影响检查。",
}
IGNORED_RUNTIME = (".harness/runs/", ".harness/evolve/", ".harness/audit/")
SENSITIVE = re.compile(r"(?i)(authorization\s*[:=]\s*(?:bearer\s+)?|(?:api[_-]?key|password|secret|token)\s*[:=]\s*)[^\s,;]+")


class HarnessError(Exception):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    result = subprocess.run(["git", "-C", str(root), *args], env=env,
                            capture_output=True, check=False)
    if result.returncode:
        raise HarnessError("Git inspection failed; root must be a real checkout")
    return result.stdout


def project(root):
    root = root.resolve(strict=True)
    if Path(git(root, "rev-parse", "--show-toplevel").decode().strip()).resolve() != root:
        raise HarnessError("Use the exact repository root, not a subdirectory")
    if (root / "README-IPD.md").is_file() and (root / "apps/web-antd").is_dir():
        return "ipd-frontend"
    if (root / "ruoyi-modules/ruoyi-ipd").is_dir() and (root / "pom.xml").is_file():
        return "ipd-backend"
    raise HarnessError("Unsupported project; do not inherit another project's commands")


def snapshot(root, manifest=None):
    root = root.resolve(strict=True)
    # Include dirty/deleted/untracked inputs, not only HEAD. Never dereference
    # tracked external skill symlinks. Local config is hashed, never printed.
    names = set(git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard").decode().split("\0"))
    # pnpm-lock.yaml is historically ignored here but is a build input.
    for extra in ("pnpm-lock.yaml", ".nvmrc", ".node-version", ".env.local",
                  ".env.production.local", "apps/web-antd/.env.local",
                  "apps/web-antd/.env.production.local", ".claude/settings.json"):
        if (root / extra).is_file():
            names.add(extra)
    entries = []
    for name in sorted(names - {""}):
        if name.startswith(IGNORED_RUNTIME):
            continue
        p = root / name
        if p.parent.resolve() != p.parent.absolute() or not p.parent.resolve().is_relative_to(root):
            raise HarnessError("Input parent symlink is not an isolated candidate")
        if p.is_symlink():
            value = "link:" + os.readlink(p)
        elif p.is_file():
            value = digest(p.read_bytes())
        elif not p.exists():
            value = "deleted"
        else:
            raise HarnessError(f"Unsupported input: {name}")
        entries.append([name, value])
    if manifest is not None:
        write_json(manifest, {"files": entries, "scope": "tracked/untracked nonignored inputs plus explicit local build inputs; not a complete environment attestation"})
    return {"head": git(root, "rev-parse", "HEAD").decode().strip(),
            "input_hash": digest(json.dumps(entries, ensure_ascii=False).encode()),
            "input_count": len(entries), "authority_hash": authority_hash(root)}


def authority_paths(root):
    """Hash existing authority/config, never copy secrets or create another registry."""
    backend = root if project(root) == "ipd-backend" else Path("/Users/mac/Documents/ruoyi-ai")
    canvases = Path("/Users/mac/.cursor/projects/Users-mac-Documents-ruoyi-ipd-web/canvases")
    paths = [backend / "docs/ipd-系统说明/开发计划-看板镜像.md",
             canvases / "ipd-execution-plan.canvas.tsx",
             root / "AGENTS.md", root / "CLAUDE.md",
             root / ".cursor/hooks.json", root / ".cursor/hooks/check-execution-cut.py",
             root / ".claude/settings.json", root / ".codex/hooks.json",
             Path.home() / ".claude/settings.json", Path.home() / ".codex/AGENTS.md",
             Path.home() / ".codex/config.toml", Path.home() / ".cursor/hooks.json"]
    master = paths[1]
    if master.is_file():
        for name in set(re.findall(r'"(ipd-[\w-]+\.canvas\.tsx)"', master.read_text())):
            paths.append(canvases / name)
    return paths


def authority_hash(root):
    return digest(json.dumps([[str(p), digest(p.read_bytes()) if p.is_file() else "missing"]
                              for p in sorted(set(authority_paths(root)))], ensure_ascii=False).encode())


def task_registry(root):
    backend = root if project(root) == "ipd-backend" else Path("/Users/mac/Documents/ruoyi-ai")
    return (backend / "docs/ipd-系统说明/开发计划-看板镜像.md").read_text()


def validate_task(root, task):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", task):
        raise HarnessError("Task must reference existing plan/card using a safe identifier")
    if not re.search(r"(?<![A-Za-z0-9_.-])" + re.escape(task) + r"(?![A-Za-z0-9_.-])", task_registry(root)):
        raise HarnessError("Task is not recorded in the existing authoritative mirror; no invented card")


def foreign_validator_bytes(path):
    """Fingerprint a foreign repository's validator at its committed state.

    A sibling session editing another checkout's working tree must not decide
    whether this repository's verification stands; a committed change still
    moves that HEAD and still invalidates identity. Paths outside an exact
    checkout root (fixtures, untracked additions) keep reading the working tree
    so a newly added validator is still covered.
    """
    probe = path.resolve()
    try:
        top = Path(git(probe.parent, "rev-parse", "--show-toplevel").decode().strip()).resolve()
        if probe.is_relative_to(top):
            env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
            out = subprocess.run(["git", "-C", str(top), "show", f"HEAD:{probe.relative_to(top).as_posix()}"],
                                 env=env, capture_output=True, check=False)
            if out.returncode == 0:
                return out.stdout
    except HarnessError:
        pass
    return path.read_bytes()


def validator_hash(root=None):
    here = Path(__file__).resolve().parent
    local = [here / name for name in ("engineering_harness.py", "test_engineering_harness.py",
             "typecheck-error-count.mjs", "typecheck-error-count.test.mjs", "check-ipd-plan-context.py")]
    local += [here.parent / ".harness/verify.sh",
              here.parent / ".harness/skills/ipd-engineering-feedback/SKILL.md"]
    backend = (root if root is not None and project(root) == "ipd-backend"
               else Path("/Users/mac/Documents/ruoyi-ai"))
    foreign = [backend / ".harness" / name for name in ("gate.sh", "loop.sh", "verify.sh")
               if (backend / ".harness" / name).is_file()]
    foreign += [backend / name for name in ("scripts/check-best-practices-coverage.sh",
              ".github/workflows/r25-root-cause-lint.yml") if (backend / name).is_file()]
    foreign += [backend / name for name in (
        "scripts/check-engineering-evidence.sh", "scripts/lib/gate-wiring-detect.py",
        "scripts/lib/gate-wiring-detect-test.py", ".claude/hooks/evolver-session-end.js",
        ".claude/hooks/evolver-session-end.test.cjs", ".claude/hooks/_memoryFiltering.js",
        ".claude/hooks/evolver-session-start.js", "scripts/test-vibe-kanban-manage.py",
        "docs/ipd-系统说明/vibe-kanban/manage.py", "scripts/check-gate-wiring.sh",
        "scripts/gate-manual-registry.txt", "scripts/ci/check-no-async-configurer.sh",
        ".github/workflows/gate-wiring-meta.yml", "scripts/check-untracked-references.py",
        "scripts/test-untracked-references.py", ".claude/hooks/post-commit-update-kanban.cjs",
        ".claude/hooks/post-commit-update-kanban.test.cjs",
        ".codex/hooks/post-commit-update-kanban.cjs") if (backend / name).is_file()]
    parts = [[str(p), digest(p.read_bytes())] for p in local]
    parts += [[str(p), digest(foreign_validator_bytes(p))] for p in foreign]
    return digest(json.dumps(parts).encode())


def local(root, relative):
    path = root / relative
    # Runtime directories must not redirect evidence out of the checkout.
    if not path.resolve().is_relative_to(root.resolve()):
        raise HarnessError("Runtime path escapes project root")
    return path


def write_json(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(temp, path)


@contextmanager
def lease(root):
    # Git common dir is shared across worktrees. flock is released on crashes.
    common = Path(git(root, "rev-parse", "--git-common-dir").decode().strip())
    if not common.is_absolute():
        common = root / common
    with (common.resolve() / "ipd-engineering-harness.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise HarnessError("RESOURCE_BUSY: another worktree is verifying; no lock stealing")
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def execute(root, argv, logfile, timeout=900):
    """No eval/shell. Private redacted log; capture true exit even if it prints PASS."""
    start = time.monotonic()
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update({"NO_COLOR": "1", "TURBO_FORCE": "true"})
    reason = None
    returncode = None
    try:
        proc = subprocess.Popen(argv, cwd=root, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, start_new_session=True)
        try:
            output, _ = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            output, _ = proc.communicate()
            reason = "TIMEOUT"
        returncode = proc.returncode
        text = output.decode("utf-8", "replace")
    except OSError:
        reason, text = "MISSING_TOOL", "Required executable could not start"
    if reason is None and returncode != 0:
        reason = "PROCESS_FAILED"
    if reason is None and not text.strip():
        reason = "EMPTY_EVIDENCE"
    logfile.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with os.fdopen(os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as f:
        f.write(SENSITIVE.sub(r"\1[REDACTED]", text))
    return {"argv": argv, "exit_code": returncode, "reason": reason,
            "log": str(logfile), "log_hash": digest(logfile.read_bytes()),
            "duration_seconds": round(time.monotonic() - start, 3)}


def diagnostics(text):
    # Build tools sometimes exit 0 while declaration generation reports TS errors.
    return bool(re.search(r"\berror\s+TS\d+\b|FATAL ERROR|heap out of memory|ERR_PNPM|No test files found", text, re.I))


def validate_vitest(path):
    try:
        report = json.loads(path.read_text())
        if (report.get("success") is not True or type(report.get("numTotalTests")) is not int
                or report["numTotalTests"] <= 0 or report.get("numPassedTests", 0) <= 0
                or report.get("numFailedTests") != 0
                or report.get("numFailedTestSuites") != 0):
            return False
        results = report.get("testResults")
        return isinstance(results, list) and bool(results)
    except (OSError, ValueError, TypeError):
        return False


def artifact(root):
    dist = local(root, "apps/web-antd/dist")
    if not (dist / "index.html").is_file():
        raise HarnessError("EMPTY_EVIDENCE: production index.html missing")
    files = sorted(p for p in dist.rglob("*") if p.is_file())
    if len(files) < 2:
        raise HarnessError("EMPTY_EVIDENCE: production output incomplete")
    for p in files:
        if not p.resolve().is_relative_to(dist.resolve()):
            raise HarnessError("Artifact symlink escapes output")
    return {"path": str(dist), "hash": digest(json.dumps([
        [str(p.relative_to(dist)), digest(p.read_bytes())] for p in files]).encode()),
        "file_count": len(files)}


def profiles(root, profile, run_dir):
    kind = project(root)
    here = Path(__file__).resolve().parent
    backend_root = root if kind == "ipd-backend" else Path("/Users/mac/Documents/ruoyi-ai")
    common = [("harness-regression", [sys.executable, str(here / "test_engineering_harness.py"), "--backend-root", str(backend_root)], 120),
              ("typecheck-regression", ["node", "--test", str(here / "typecheck-error-count.test.mjs")], 120),
              ("context", [sys.executable, str(here / "check-ipd-plan-context.py"), "--front", str(root if project(root) == "ipd-frontend" else here.parent), "--back", str(root if project(root) == "ipd-backend" else Path("/Users/mac/Documents/ruoyi-ai"))], 60)]
    if profile == "governance":
        return common + [("engineering-evidence", ["bash", str(backend_root / "scripts/check-engineering-evidence.sh")], 120)]
    if profile != "frontend" or kind != "ipd-frontend":
        raise HarnessError("Unsupported profile for this repository")
    if not (root / "node_modules").is_dir():
        raise HarnessError("Frontend dependencies missing; do not silently verify a different worktree")
    return common + [
        ("typecheck", ["pnpm", "run", "check:type"], 1200),
        ("vitest", ["pnpm", "exec", "vitest", "run", "--config", "vitest.ipd.config.mts", "--reporter=json", "--outputFile=" + str(run_dir / "vitest.json")], 1200),
        ("build", ["pnpm", "run", "build:antd"], 1200),
    ]


def reflect(root, receipt):
    reasons = sorted({s["reason"] for s in receipt["steps"] if s.get("reason")})
    if receipt["status"] == "STALE_INPUT":
        reasons.append("STALE_INPUT")
    packet = {"schema": 1, "run_id": receipt["run_id"], "task": receipt["task"],
              "root": str(root), "input": receipt["before"], "status": receipt["status"],
              "observed_failures": reasons, "root_cause": "UNCONFIRMED",
              "evidence": [{"id": s["id"], "exit_code": s["exit_code"], "log": s["log"],
                            "log_hash": s["log_hash"]} for s in receipt["steps"]],
              "questions": ["哪个原始结果推翻了完成声明？", "根因属于代码、环境、权限还是未确定？",
                            "什么正反例能证明修复而不是掩盖？", "新经验是否越过原业务或安全边界？"],
              "candidate_checks": [p for p in reasons if p in PROCEDURES],
              "state": "PENDING_REFLECTION", "automatic_model_reflection": False}
    write_json(local(root, f".harness/evolve/{receipt['run_id']}.json"), packet)


def verify(root, profile, task):
    validate_task(root, task)
    kind = project(root)
    feedback = intake(root)
    print(json.dumps({"known_checks": feedback["checks"], "pending_reflections": feedback["pending_reflections"],
                      "stale_learning": feedback["stale_learning"]}, ensure_ascii=False), flush=True)
    with lease(root):
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:12]
        run_dir = local(root, ".harness/runs/" + run_id)
        run_dir.mkdir(parents=True, mode=0o700)
        before = snapshot(root, run_dir / "before-inputs.json")
        receipt = {"schema": 1, "harness_version": VERSION, "run_id": run_id,
                   "root": str(root), "project": kind, "profile": profile, "task": task,
                   "started_at": now(), "before": before, "validator_hash": validator_hash(root), "steps": [],
                   "known_checks": [x["id"] for x in feedback["checks"]],
                   "status": "RUNNING", "validation_level": "ENGINEERING_ONLY",
                   "runtime_loaded": "NOT_VERIFIED", "business_acceptance": "NOT_VERIFIED"}
        try:
            steps = profiles(root, profile, run_dir)
            if not steps:
                raise HarnessError("Required verification profile is empty")
        except HarnessError as exc:
            log = run_dir / "preflight.log"
            with os.fdopen(os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as f:
                f.write(str(exc) + "\n")
            receipt.update({"status": "FAILED", "after": snapshot(root), "ended_at": now(),
                            "steps": [{"id": "preflight", "argv": [], "exit_code": 2,
                                       "reason": "MISSING_TOOL", "log": str(log), "log_hash": digest(log.read_bytes())}]})
            write_json(run_dir / "receipt.json", receipt)
            snapshot(root, run_dir / "after-inputs.json")
            reflect(root, receipt)
            print(json.dumps({"status": "FAILED", "receipt": str(run_dir / "receipt.json"), "reason": "preflight refused"}))
            return receipt
        for name, argv, timeout in steps:
            print(f"RUN {name}", flush=True)
            step = execute(root, argv, run_dir / (name + ".log"), timeout)
            step["id"] = name
            log_text = Path(step["log"]).read_text()
            if name == "harness-regression" and step["reason"] is None:
                count = re.search(r"Ran (\d+) tests?", log_text)
                if not count or int(count[1]) < 58:
                    step["reason"] = "EMPTY_EVIDENCE"
                ids = {int(x) for x in re.findall(r"test_C(\d\d)_", log_text)}
                if not set(range(1, 59)).issubset(ids):
                    step["reason"] = "EMPTY_EVIDENCE"
                step["case_ids"] = sorted(ids)
            if name == "typecheck-regression" and step["reason"] is None:
                count = re.search(r"# tests (\d+)", log_text)
                if not count or int(count[1]) < 15:
                    step["reason"] = "EMPTY_EVIDENCE"
            if step["reason"] is None and diagnostics(Path(step["log"]).read_text()):
                step["reason"] = "DIAGNOSTICS"
            if name == "vitest" and step["reason"] is None and not validate_vitest(run_dir / "vitest.json"):
                step["reason"] = "EMPTY_EVIDENCE"
            if name == "vitest" and step["reason"] is None:
                test_report = json.loads((run_dir / "vitest.json").read_text())
                step["tests"] = {k: test_report.get(k) for k in ("numTotalTests", "numPassedTests", "numPendingTests", "numFailedTests")}
            receipt["steps"].append(step)
            if step["reason"]:
                break
        receipt["after"] = snapshot(root, run_dir / "after-inputs.json")
        if receipt["before"] != receipt["after"] or receipt["validator_hash"] != validator_hash(root):
            receipt["status"] = "STALE_INPUT"
        elif any(s["reason"] for s in receipt["steps"]):
            receipt["status"] = "FAILED"
        elif len(receipt["steps"]) != len(steps):
            receipt["status"] = "FAILED"
        else:
            receipt["status"] = "PASSED"
        if receipt["status"] == "PASSED" and profile == "frontend":
            try:
                receipt["artifact"] = artifact(root)
            except HarnessError:
                receipt["status"] = "FAILED"
                receipt["steps"][-1]["reason"] = "EMPTY_EVIDENCE"
        receipt["ended_at"] = now()
        write_json(run_dir / "receipt.json", receipt)
        if receipt["status"] != "PASSED":
            reflect(root, receipt)
        print(json.dumps({"status": receipt["status"], "receipt": str(run_dir / "receipt.json"),
                          "scope": "engineering checks only; no runtime/business claim"}, ensure_ascii=False))
    # After releasing the execution lease, recover only fixed checklist items
    # from prior observed failures of this same task/profile. No arbitrary edits.
    if receipt["status"] == "PASSED":
        receipt["learned_from"] = []
        for packet_path in sorted(local(root, ".harness/evolve").glob("*.json")):
            if packet_path.name.startswith("learned-"):
                continue
            packet = json.loads(packet_path.read_text())
            if packet.get("state") != "PENDING_REFLECTION" or packet.get("task") != task:
                continue
            try:
                lesson = learn(root, local(root, f".harness/runs/{packet['run_id']}/receipt.json"), run_dir / "receipt.json")
                receipt["learned_from"].append(lesson["failure"])
            except (HarnessError, OSError, ValueError, KeyError, TypeError):
                # Learning failure cannot silently claim promotion. The packet
                # remains pending and is presented by the next intake.
                continue
        write_json(run_dir / "receipt.json", receipt)
    return receipt


def checked_receipt(root, path, require_pass=True, fresh=True, *, expected_task=None, expected_profile=None):
    path = path.resolve(strict=True)
    if not path.is_relative_to(local(root, ".harness/runs").resolve()) or path.name != "receipt.json":
        raise HarnessError("Receipt must be an existing local harness record")
    r = json.loads(path.read_text())
    if r.get("root") != str(root) or r.get("schema") != 1:
        raise HarnessError("Receipt belongs to a different root or schema")
    # Completion callers bind the current task/profile explicitly. Internal
    # historical learning may omit these while retaining all existing checks.
    if expected_task is not None and r.get("task") != expected_task:
        raise HarnessError("Receipt belongs to a different task; verify the current task")
    if expected_profile is not None and r.get("profile") != expected_profile:
        raise HarnessError("Receipt belongs to a different verification profile; run the required checks")
    if r.get("harness_version") != VERSION or not r.get("validator_hash") or not r.get("steps"):
        raise HarnessError("Receipt is incomplete or belongs to another verifier version")
    for phase in ("before", "after"):
        manifest = json.loads((path.parent / (phase + "-inputs.json")).read_text())
        files = manifest.get("files")
        if (not isinstance(files, list) or len(files) != r[phase]["input_count"]
                or digest(json.dumps(files, ensure_ascii=False).encode()) != r[phase]["input_hash"]):
            raise HarnessError("Input manifest is missing or altered")
    if require_pass:
        if (r.get("status") != "PASSED" or r.get("before") != r.get("after")
                or (fresh and (r.get("after") != snapshot(root) or r["validator_hash"] != validator_hash(root)))):
            raise HarnessError("Receipt failed or inputs have changed; rerun validation")
        # Historical records retain their own logs/manifest checks below. An
        # evolved verifier's required steps cannot describe that old execution;
        # intake marks it stale and never enables its learned checks.
        if fresh or r["validator_hash"] == validator_hash(root):
            expected = [x[0] for x in profiles(root, r["profile"], path.parent)]
            if [s.get("id") for s in r.get("steps", [])] != expected:
                raise HarnessError("Required checks missing or reordered")
    elif (r.get("status") == "FAILED" and not any(s.get("reason") for s in r["steps"])) or (
            r.get("status") == "STALE_INPUT" and r.get("before") == r.get("after")):
        raise HarnessError("Failed receipt has no observed failure")
    for s in r["steps"]:
        log = Path(s["log"])
        if not log.resolve().is_relative_to(path.parent) or digest(log.read_bytes()) != s["log_hash"]:
            raise HarnessError("Evidence missing or modified")
        if require_pass and (s["exit_code"] != 0 or s.get("reason") or not log.read_text().strip()):
            raise HarnessError("Required check did not actually pass")
    if require_pass and r["profile"] == "frontend" and fresh:
        if not validate_vitest(path.parent / "vitest.json") or r.get("artifact") != artifact(root):
            raise HarnessError("Tests/output missing, stale or invalid")
    return r


def learn(root, failure_path, success_path):
    """Automatically enable ONLY fixed procedural checks, never free-form rules.

    A resolved failure + fresh complete passing run of the same profile/task are
    required. The governance profile always executes independent counterexamples.
    This is bounded procedural adaptation, not proof of a inferred root cause.
    """
    with lease(root):
        failed = checked_receipt(root, failure_path, False)
        passed = checked_receipt(root, success_path, True)
        if failed["status"] not in ("FAILED", "STALE_INPUT") or any(
                failed.get(k) != passed.get(k) for k in ("task", "profile", "project")):
            raise HarnessError("Learning requires a resolved failure from the same task/profile")
        if failed["ended_at"] >= passed["started_at"]:
            raise HarnessError("Passing verification must occur after the failed attempt")
        if failed["validator_hash"] != passed["validator_hash"]:
            raise HarnessError("Different regression/verifier versions require a new controlled baseline")
        packet_path = local(root, f".harness/evolve/{failed['run_id']}.json")
        packet = json.loads(packet_path.read_text())
        # Derive checks again from actual receipt; never trust edited draft checks.
        checks = {s.get("reason") for s in failed["steps"]} & PROCEDURES.keys()
        if failed["status"] == "STALE_INPUT":
            checks.add("STALE_INPUT")
        if not checks:
            raise HarnessError("No supported procedural learning; requires new reviewed regression")
        lesson = {"schema": 1, "harness_version": VERSION, "checks": sorted(checks), "failure": failed["run_id"],
                  "verified": passed["run_id"], "task": passed["task"], "enabled_at": now(),
                  "scope": "fixed engineering checklist only", "root_cause": "UNCONFIRMED"}
        write_json(local(root, f".harness/evolve/learned-{failed['run_id']}.json"), lesson)
        packet["state"] = "CHECKLIST_ENABLED"
        packet["verified_by"] = passed["run_id"]
        write_json(packet_path, packet)
        return lesson


def intake(root):
    kind = project(root)
    items, pending, stale = set(), [], []
    evolve = local(root, ".harness/evolve")
    if evolve.exists():
        for p in sorted(evolve.glob("*.json")):
            data = json.loads(p.read_text())
            if p.name.startswith("learned-"):
                checks = data.get("checks")
                if (data.get("schema") != 1 or data.get("harness_version") != VERSION
                        or not isinstance(checks, list) or not checks or any(x not in PROCEDURES for x in checks)):
                    raise HarnessError("Invalid procedural registry; do not inject arbitrary text")
                if not all(re.fullmatch(r"[A-Za-z0-9-]+", str(data.get(k, ""))) for k in ("failure", "verified")):
                    raise HarnessError("Procedural registry lacks verified evidence")
                failure = checked_receipt(root, local(root, f".harness/runs/{data['failure']}/receipt.json"), False)
                passed = checked_receipt(root, local(root, f".harness/runs/{data['verified']}/receipt.json"), True, False)
                derived = {s.get("reason") for s in failure["steps"]} & PROCEDURES.keys()
                if failure["status"] == "STALE_INPUT":
                    derived.add("STALE_INPUT")
                if (sorted(derived) != checks or failure["task"] != passed["task"]
                        or failure["profile"] != passed["profile"]
                        or failure["validator_hash"] != passed["validator_hash"]
                        or failure["ended_at"] >= passed["started_at"]):
                    raise HarnessError("Learning is not supported by its evidence")
                if passed["validator_hash"] != validator_hash(root):
                    stale.append(data["failure"])
                    continue
                items.update(checks)
            elif data.get("state") == "PENDING_REFLECTION":
                run_id = str(data.get("run_id", ""))
                if not re.fullmatch(r"[A-Za-z0-9-]+", run_id):
                    raise HarnessError("Invalid reflection evidence identity")
                original = checked_receipt(root, local(root, f".harness/runs/{run_id}/receipt.json"), False)
                if original["status"] not in ("FAILED", "STALE_INPUT"):
                    raise HarnessError("Reflection has no failed execution evidence")
                observed = {s.get("reason") for s in original["steps"]} & PROCEDURES.keys()
                if original["status"] == "STALE_INPUT":
                    observed.add("STALE_INPUT")
                pending.append({"run_id": run_id, "observed_failures": sorted(observed)})
    return {"root": str(root), "project": kind, "baseline": snapshot(root),
            "checks": [{"id": x, "procedure": PROCEDURES[x]} for x in sorted(items)],
            "pending_reflections": pending, "authority": "existing IPD master canvas and kanban mirror",
            "stale_learning": stale,
            "boundary": "guidance and this runner only; not all IDE tool calls are intercepted"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("intake")
    run = sub.add_parser("verify")
    run.add_argument("--profile", choices=("governance", "frontend"), required=True)
    run.add_argument("--task", required=True)
    check = sub.add_parser("check")
    check.add_argument("--receipt", type=Path, required=True)
    check.add_argument("--task", help="Current task for completion evidence binding")
    check.add_argument("--profile", choices=("governance", "frontend"), help="Required verification profile")
    evolution = sub.add_parser("learn")
    evolution.add_argument("--failure", type=Path, required=True)
    evolution.add_argument("--verified", type=Path, required=True)
    args = parser.parse_args()
    try:
        root = args.root.resolve(strict=True)
        project(root)
        if args.action == "verify":
            return 0 if verify(root, args.profile, args.task)["status"] == "PASSED" else 1
        if args.action == "check":
            result = checked_receipt(root, args.receipt, expected_task=args.task, expected_profile=args.profile)
        elif args.action == "learn":
            result = learn(root, args.failure, args.verified)
        else:
            result = intake(root)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (HarnessError, OSError, ValueError, KeyError, TypeError) as exc:
        print(f"HARNESS_REFUSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
