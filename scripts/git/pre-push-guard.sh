#!/bin/sh
# pre-push 守卫：owner 账号 + 目标 ref 双白名单
#
# 目的
#   推送前解析【目标 remote URL】与【目标 ref】，任一不满足白名单立即拒绝，
#   防止代码被推到非 owner 账号仓库或非约定分支。
#
# 设计契约（改动前必读）
#   1. fail-closed：任何一步解析不出结果都拒绝，不放行「拿不准」的目标。
#   2. 判定输入取自 git 传入的 $2（remote location，即 pushurl 解析后的真实推送地址），
#      $2 缺失时回落 `git remote get-url --push <name>`，再失败即拒绝。
#   3. URL 模式（http/ssh/scp-like）：host 必须精确等于 github.com，
#      且路径必须恰好两段（owner/repo）—— 锁 host + 限段数共同防 impersonation，
#      参见 .claude/hooks/block-dangerous-git.sh 2026-10-07 自测注释里的对抗用例。
#   4. 本地路径模式：把「文件系统实验室根」当作 URL 里的 host 锚点。
#      路径必须位于 <git-dir>/prepush-lab/ 之下且相对该根恰好两段，
#      从而与 URL 模式获得等价的 impersonation 防护（多一层 attacker/ 会被段数判掉）。
#      本地模式仅用于验证与本地裸仓，不替代对真实远端 URL 的校验。
#   5. 本脚本是唯一实现；两仓必须逐字节相同（由 scripts/git/pre-push-guard.sh 自检）。
#
# 白名单条目格式：<owner>/<repo>:<refs/heads/...>
# 维护口径：owner GitHub 账号 = wilson323（2026-10-08 owner 本人确认）。
#   前端 ruoyi-ipd-web → origin=wilson323/ruoyi-admin，最终分支 teardown/incentive-removal
#   后端 ruoyi-ai      → origin=wilson323/ruoyi-ai-private，最终分支 baseline/pre-teardown
ALLOW_LIST='wilson323/ruoyi-admin:refs/heads/teardown/incentive-removal
wilson323/ruoyi-ai-private:refs/heads/baseline/pre-teardown'

ALLOWED_HOST='github.com'

# 报错文案要指名「本人账号」，但账号名单只有 ALLOW_LIST 一处事实源：
# 这里从清单动态提取 owner 拼成 wilson323 形式，避免文案与清单各写一份而漂移。
ALLOW_OWNERS="$(printf '%s\n' "$ALLOW_LIST" | while IFS= read -r e; do printf '%s\n' "${e%%/*}"; done | sort -u | tr '\n' ' ' | sed 's/ *$//')"

# 审计日志写在 git 私有目录，不进版本库、不污染工作树。
git_dir_abs="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
AUDIT_LOG="${git_dir_abs:+$git_dir_abs/}prepush-guard-blocked.log"

# 拒绝时必须输出可定位信息并留痕；AUDIT_LOG 不可写时只降级为不落盘，不影响拦截。
audit() {
    line="$(date '+%Y-%m-%dT%H:%M:%S%z') $*"
    printf '%s\n' "$line" >&2
    if [ -n "$git_dir_abs" ]; then
        printf '%s\n' "$line" >>"$AUDIT_LOG" 2>/dev/null || true
    fi
}

die() {
    audit "BLOCKED: $1"
    audit "  允许清单："
    printf '%s\n' "$ALLOW_LIST" | while IFS= read -r e; do
        audit "    $e"
    done
    audit "  如确需放行，请由 owner 更新本脚本 ALLOW_LIST 后再推。"
    exit 1
}

# 白名单命中判定：仓库 + ref 必须同时精确匹配。
allow_hit() {
    _repo="$1"
    _ref="$2"
    for _entry in $ALLOW_LIST; do
        _r="${_entry%%:*}"
        _b="${_entry#*:}"
        if [ "$_r" = "$_repo" ] && [ "$_b" = "$_ref" ]; then
            return 0
        fi
    done
    return 1
}

# 仓库维度单独判定：只认清单里 owner/repo 整串相等的条目。
# 2026-10-08 owner 明令「只能是我自己账号下的」。拆出本函数是为了让拒绝理由
# 指向真正的失败维度：owner 不是本人时若报「ref 不在清单」，分支其实是对的，
# 会把人引去改分支名单，而真正该改的是仓库/账号。
repo_hit() {
    _repo="$1"
    for _entry in $ALLOW_LIST; do
        _r="${_entry%%:*}"
        if [ "$_r" = "$_repo" ]; then
            return 0
        fi
    done
    return 1
}

remote_name="${1:-}"
remote_url="${2:-}"

if [ -z "$remote_url" ] && [ -n "$remote_name" ]; then
    remote_url="$(git remote get-url --push "$remote_name" 2>/dev/null || true)"
fi
[ -n "$remote_url" ] || die "解析不到推送目标 URL（remote='${remote_name:-<空>}'）"

# ---- URL 归一化：产出 path（去掉 .git 后缀）与 is_local ----
is_local=0
case "$remote_url" in
    file://*)
        path="${remote_url#file://}"
        is_local=1
        ;;
    /*|./*|../*|~*)
        path="$remote_url"
        is_local=1
        ;;
    ssh://*|git://*|http://*|https://*)
        rest="${remote_url#*://}"
        rest="${rest#*@}"                       # 去 user@ 前缀
        host="${rest%%/*}"
        path="${rest#"$host"}"
        host="${host%%:*}"                      # 去端口
        ;;
    *:*)
        # scp-like：git@github.com:owner/repo.git
        host="${remote_url%%:*}"
        host="${host#*@}"
        path="${remote_url#*:}"
        ;;
    *)
        path="$remote_url"
        is_local=1
        ;;
esac

# 路径归一化必须分模式做，不能在 if/else 之前统一做。
# 「去前导 /」和「剥 .git 后缀」都是 URL 语义（把 /owner/repo.git 收成 owner/repo）。
# 本地绝对路径 /a/b/repo.git 同样处理后会变成相对路径 a/b/repo，
# 再去做 -d 存在性判断必然报「本地推送目标不存在」。
# 2026-10-08 实跑验证矩阵踩到两次（S1/S2 放行场景被假拦截），已固定为分支内各自归一化。
repo=''

if [ "$is_local" = '1' ]; then
    # 本地模式：以实验室根为 host 锚，要求相对根恰好两段。
    # 本地分支只能去尾斜杠：前导 / 是文件系统路径的本体，不能碰；
    # .git 后缀也不能提前剥——实验室裸仓目录本身就叫 <repo>.git，
    # 先剥会拿 <repo> 去判存在从而误报「目标不存在」；须在算完 rel 之后再剥。
    path="${path%/}"
    [ -d "$path" ] || die "本地推送目标不存在：$remote_url"
    abs="$(cd "$path" 2>/dev/null && pwd -P)" || die "无法解析本地推送目标：$remote_url"
    [ -n "$git_dir_abs" ] || die "本地模式需要 git-dir 锚点，但 git rev-parse 失败"
    lab_root="$git_dir_abs/prepush-lab"
    case "$abs" in
        "$lab_root"/*) rel="${abs#"$lab_root"/}" ;;
        *) die "本地推送目标不在实验室根 <git-dir>/prepush-lab/ 之下：$remote_url" ;;
    esac
    rel="${rel%.git}"
    segs="$(printf '%s' "$rel" | tr '/' '\n' | grep -c . || true)"
    [ "$segs" = '2' ] || die "本地推送目标相对实验室根必须恰好两段（owner/repo），实际 ${segs} 段：$remote_url"
    repo="$rel"
else
    path="${path#/}"
    path="${path%/}"
    path="${path%.git}"
    path="${path%/}"
    [ "$host" = "$ALLOWED_HOST" ] || die "主机不在允许范围（仅 ${ALLOWED_HOST}）：$remote_url"
    segs="$(printf '%s' "$path" | tr '/' '\n' | grep -c . || true)"
    [ "$segs" = '2' ] || die "仓库路径必须恰好两段（owner/repo），实际 ${segs} 段：$remote_url"
    repo="$path"
fi

[ -n "$repo" ] || die "无法从推送目标解析 owner/repo：$remote_url"

# ---- 逐 ref 判定 ----
# stdin 每行：<本地ref> <本地sha> <远端ref> <远端sha>
checked=0
while read -r _lref _lsha rref _rsha; do
    [ -n "${rref:-}" ] || continue
    checked=1
    # 先判仓库（账号）：命中不了就直接拒，不再往下看 ref——
    # 否则账号不对会被误报成「目标 ref 不在允许清单」。
    if ! repo_hit "$repo"; then
        die "目标仓库不在允许清单（只放行本人账号 $ALLOW_OWNERS 下的仓库，且 owner/repo 整串须精确相等）：remote='$remote_name' repo='$repo' ref='$rref'"
    fi
    if ! allow_hit "$repo" "$rref"; then
        die "目标 ref 不在允许清单：remote='$remote_name' repo='$repo' ref='$rref'"
    fi
done

# 没有待推 ref（stdin 为空）不属于越权目标，放行给 git 自己处理。
if [ "$checked" = '0' ]; then
    audit "ALLOW(no-ref): remote='$remote_name' repo='$repo' —— 本次推送无待推 ref，转交 git 处理"
fi

exit 0
