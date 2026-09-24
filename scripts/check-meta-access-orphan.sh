#!/usr/bin/env bash
# check-meta-access-orphan.sh — M-Root-11 配置存在但无消费者
#
# 元根因: M-Root-11 配置存在但无消费者（工具链假设漂移）
# 来源: docs/ipd-系统说明/门禁脚本骨架设计-20260923.md §二
# 修复卡: r211b-orphan-script（FAIL_SEED 真注入 / 孤儿 PAGE_PERMISSIONS / ??[] 漏键 / hasAccess 双锚）
#
# 检测逻辑:
#   1. 从 ipd-permission-codes.ts 提取 PAGE_PERMISSIONS 声明路径
#   2. 从 ipd.ts 提取 PAGE_PERMISSIONS['path'] 引用 + 校验键存在（禁止 ?? [] 静默空权限）
#   3. 声明无路由引用 → 孤悬配置；引用键不在声明表 → 错拼误放行
#   4. ipd-guard.ts 须同时有「function hasAccess」定义与调用点（注释骗不过）
#
# FAIL_SEED 双向触发:
#   FAIL_SEED=false (默认) — 正常扫描；无孤儿/错键且 hasAccess 双锚 → exit 0
#   FAIL_SEED=true        — 注入假孤儿路径走同一检测路径 → 必 exit 1
#
# 依赖: bash, grep, awk, sort, uniq
# 超时: 30s

set -euo pipefail

FAIL_SEED="${FAIL_SEED:-false}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROUTE_FILE="$ROOT/apps/web-antd/src/router/routes/modules/ipd.ts"
GUARD_FILE="$ROOT/apps/web-antd/src/router/ipd-guard.ts"
PERMISSION_CODES_FILE="$ROOT/apps/web-antd/src/views/ipd/_shared/ipd-permission-codes.ts"
# 刻意不设 meta.access / 仅用字面量权限码的 PAGE_PERMISSIONS 键（白名单，不算孤儿）
# 更新时与导航地图同步；禁止用注释「骗过」消费者检查。
INTENTIONAL_NO_ROUTE_CONSUMER_FILE="$ROOT/scripts/meta-access-intentional-orphans.txt"

echo "[check-meta-access-orphan] 开始扫描 meta.access / PAGE_PERMISSIONS 孤悬配置 (M-Root-11)..."

for f in "$ROUTE_FILE" "$GUARD_FILE" "$PERMISSION_CODES_FILE"; do
  if [ ! -f "$f" ]; then
    echo "[check-meta-access-orphan] ❌ FAIL: 文件不存在: $f"
    exit 1
  fi
done

# --- hasAccess 双锚：定义 + 调用（注释中的 hasAccess 不算定义）---
HAS_DEF=$(grep -cE '^export function hasAccess\(' "$GUARD_FILE" || true)
HAS_CALL=$(grep -cE '[^a-zA-Z]hasAccess\(' "$GUARD_FILE" || true)
# 调用点至少应多于定义本身（守卫主体调用）
if [ "$HAS_DEF" -lt 1 ] || [ "$HAS_CALL" -lt 2 ]; then
  echo "[check-meta-access-orphan] ❌ FAIL: ipd-guard.ts 缺少 hasAccess 定义或调用双锚 (def=$HAS_DEF call=$HAS_CALL)"
  exit 1
fi

# --- PAGE_PERMISSIONS 声明路径 ---
DECLARED=$(grep -oE "'/ipd/[^']+':" "$PERMISSION_CODES_FILE" | sed "s/'//g;s/://g" | sort -u)
DECLARED_COUNT=$(printf '%s\n' "$DECLARED" | grep -c . || true)
echo "[check-meta-access-orphan] PAGE_PERMISSIONS 声明路径数: $DECLARED_COUNT"

# --- 路由对 PAGE_PERMISSIONS['...'] 的引用 ---
REFERENCED=$(grep -oE "PAGE_PERMISSIONS\['/ipd/[^']+'\]" "$ROUTE_FILE" | sed "s/PAGE_PERMISSIONS\['//;s/'\]//" | sort -u)
REF_COUNT=$(printf '%s\n' "$REFERENCED" | grep -c . || true)
echo "[check-meta-access-orphan] 路由 PAGE_PERMISSIONS 引用数: $REF_COUNT"

# --- 错拼：引用了不存在的键（?? [] 会静默变空权限）---
MISSING_KEYS=""
while IFS= read -r key; do
  [ -z "$key" ] && continue
  if ! printf '%s\n' "$DECLARED" | grep -qxF "$key"; then
    MISSING_KEYS="${MISSING_KEYS}${key}"$'\n'
  fi
done <<< "$REFERENCED"

# --- 孤悬：声明了但路由从未 PAGE_PERMISSIONS['path'] 引用 ---
# 允许白名单（字面量 meta.access 消费同一权限语义，或刻意未挂路由）
INTENTIONAL=""
if [ -f "$INTENTIONAL_NO_ROUTE_CONSUMER_FILE" ]; then
  INTENTIONAL=$(grep -vE '^\s*(#|$)' "$INTENTIONAL_NO_ROUTE_CONSUMER_FILE" | sort -u || true)
fi

ORPHANS=""
while IFS= read -r key; do
  [ -z "$key" ] && continue
  if printf '%s\n' "$REFERENCED" | grep -qxF "$key"; then
    continue
  fi
  if [ -n "$INTENTIONAL" ] && printf '%s\n' "$INTENTIONAL" | grep -qxF "$key"; then
    continue
  fi
  # 字面量权限码路由：若 ipd.ts 中出现该 path 字符串则视为已挂路由（非 PAGE_PERMISSIONS 引用）
  if grep -qE "path:\s*'$key'|path:\s*\"$key\"" "$ROUTE_FILE"; then
    continue
  fi
  ORPHANS="${ORPHANS}${key}"$'\n'
done <<< "$DECLARED"

# FAIL_SEED：注入假孤儿，走同一判定路径
if [ "$FAIL_SEED" = "true" ]; then
  ORPHANS="${ORPHANS}/ipd/__fail_seed_orphan__"$'\n'
  echo "[check-meta-access-orphan] FAIL_SEED=true: 已注入假孤儿 /ipd/__fail_seed_orphan__"
fi

ORPHAN_COUNT=$(printf '%s\n' "$ORPHANS" | grep -c . || true)
MISSING_COUNT=$(printf '%s\n' "$MISSING_KEYS" | grep -c . || true)

if [ "$MISSING_COUNT" -gt 0 ]; then
  echo "[check-meta-access-orphan] ❌ FAIL: 路由引用了不存在的 PAGE_PERMISSIONS 键（?? [] 会误放行）:"
  printf '%s\n' "$MISSING_KEYS" | sed '/^$/d' | sed 's/^/  - /'
  exit 1
fi

if [ "$ORPHAN_COUNT" -gt 0 ]; then
  echo "[check-meta-access-orphan] ❌ FAIL: PAGE_PERMISSIONS 孤悬声明（无路由消费者）:"
  printf '%s\n' "$ORPHANS" | sed '/^$/d' | sed 's/^/  - /'
  echo "[check-meta-access-orphan]        若属刻意不设码/字面量消费，请登记 scripts/meta-access-intentional-orphans.txt"
  exit 1
fi

echo "[check-meta-access-orphan] hasAccess 双锚 OK (def=$HAS_DEF call=$HAS_CALL)"
echo "[check-meta-access-orphan] ✅ PASS: 无孤悬 PAGE_PERMISSIONS / 无错拼键 (声明 $DECLARED_COUNT / 引用 $REF_COUNT)"
exit 0
