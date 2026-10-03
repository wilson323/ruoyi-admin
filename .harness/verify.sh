#!/usr/bin/env bash
# Existing project verification entry; no commits, database writes or deployment.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
PROFILE=${1:-frontend}
TASK=${2:?Pass the existing task/card identifier as the second argument}
exec python3 "$ROOT/scripts/engineering_harness.py" --root "$ROOT" verify --profile "$PROFILE" --task "$TASK"
