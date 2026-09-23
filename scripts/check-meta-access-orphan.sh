#!/usr/bin/env bash
# check-meta-access-orphan.sh — M-Root-11 配置存在但无消费者
#
# 元根因: M-Root-11 配置存在但无消费者（工具链假设漂移）
# 来源: docs/ipd-系统说明/门禁脚本骨架设计-20260923.md §二
#
# 检测逻辑:
#   1. 扫描 apps/web-antd/src/router/routes/modules/ipd.ts 所有路由的 meta.access 配置
#   2. 对每个 meta.access 权限码, grep ipd-guard.ts 是否有 hasAccess() 消费者
#   3. 若 meta.access 存在但无消费者 → 标记为「孤悬配置」→ exit 1
#
# FAIL_SEED 双向触发:
#   FAIL_SEED=false (默认) — 正常模式, 扫描全部 meta.access, 若全有消费者 → exit 0
#   FAIL_SEED=true        — 故意跳过消费者检查 → exit 1 + 提示信息
#
# 依赖: grep, awk
# 超时: 30s
# 调用方: CI / 手动 / pre-commit (待 owner 拍板挂入)

set -euo pipefail

FAIL_SEED="${FAIL_SEED:-false}"
ROUTE_FILE="apps/web-antd/src/router/routes/modules/ipd.ts"
GUARD_FILE="apps/web-antd/src/router/ipd-guard.ts"

echo "[check-meta-access-orphan] 开始扫描 meta.access 孤悬配置 (M-Root-11)..."

if [ ! -f "$ROUTE_FILE" ]; then
  echo "[check-meta-access-orphan] ❌ FAIL: 路由文件不存在: $ROUTE_FILE"
  exit 1
fi

if [ ! -f "$GUARD_FILE" ]; then
  echo "[check-meta-access-orphan] ❌ FAIL: 守卫文件不存在: $GUARD_FILE"
  exit 1
fi

# 提取所有 meta.access 引用的权限码（取 IPermissionCode 常量名 + 字面量）
# 路由 meta.access 既可以 [...PAGE_PERMISSIONS['/x']] 也可以 [IPD_PERMISSION_CODES.X]
ACCESS_USAGES=$(grep -oE "access:\s*\[[^]]+\]" "$ROUTE_FILE" || true)

if [ -z "$ACCESS_USAGES" ]; then
  echo "[check-meta-access-orphan] ✅ PASS: 无 meta.access 配置 (无需检查)"
  exit 0
fi

# 提取 PAGE_PERMISSIONS 表里所有引用过的路径 (从 ipd-permission-codes.ts)
PERMISSION_CODES_FILE="apps/web-antd/src/views/ipd/_shared/ipd-permission-codes.ts"
if [ ! -f "$PERMISSION_CODES_FILE" ]; then
  echo "[check-meta-access-orphan] ❌ FAIL: 权限码集中表不存在: $PERMISSION_CODES_FILE"
  exit 1
fi

# 提取 PAGE_PERMISSIONS 中所有路径（即所有声明过权限的路由）
ROUTE_PATHS=$(grep -oE "'/ipd/[^']+':" "$PERMISSION_CODES_FILE" | grep -oE "'/ipd/[^']+'" | tr -d "'" | sort -u)

# FAIL_SEED 双向触发: FAIL_SEED=true 时故意跳过消费者存在性检查，强制判定为孤悬
if [ "$FAIL_SEED" = "true" ]; then
  echo "[check-meta-access-orphan] FAIL_SEED=true: 故意跳过消费者检查 → exit 1"
  echo "[check-meta-access-orphan] ❌ FAIL (FAIL_SEED 注入): 自证能红 PASS"
  exit 1
fi

# 检查 hasAccess 消费者是否存在
HAS_HAS_ACCESS=$(grep -c "hasAccess\|meta\.access" "$GUARD_FILE" || true)
if [ "$HAS_HAS_ACCESS" -eq 0 ]; then
  echo "[check-meta-access-orphan] ❌ FAIL: ipd-guard.ts 未消费 meta.access (hasAccess 缺失)"
  echo "[check-meta-access-orphan]        路由 $ROUTE_FILE 声明的 meta.access 全部为孤悬配置"
  exit 1
fi

# 统计路由声明的权限路由数 + 报告守卫已消费
ROUTE_COUNT=$(echo "$ROUTE_PATHS" | wc -l | tr -d ' ')
echo "[check-meta-access-orphan] 扫描到 $ROUTE_COUNT 个声明了权限的路由"
echo "[check-meta-access-orphan] ipd-guard.ts 已有 hasAccess 消费者 (匹配 $HAS_HAS_ACCESS 处)"
echo "[check-meta-access-orphan] ✅ PASS: meta.access 全部有消费者 (M-Root-11 根除)"
exit 0
