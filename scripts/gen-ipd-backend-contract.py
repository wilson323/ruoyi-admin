#!/usr/bin/env python3
"""从后端仓 Controller 注解生成 IPD API 契约清单（前端仓 CI 对账用）。

用法:
    python3 scripts/gen-ipd-backend-contract.py /path/to/ruoyi-ai > scripts/ipd-backend-contract.json

规则:
- 类级 @RequestMapping("prefix") + 方法级 @GetMapping/@PostMapping/@PutMapping/@DeleteMapping
- 路径参数 {id} 等保留原样（对照时两端归一化）
- 输出含 generated_from，便于对账
"""
import json
import re
import subprocess
import sys
from pathlib import Path

# 方法级注解：@XxxMapping 后可带括号参数（含跨行）；路径取括号内「第一个字符串字面量」，
# 取不到就回落到类前缀（bare @GetMapping / @GetMapping() 的语义）。
#
# 为什么不用旧写法 `@XxxMapping\s*(?:\(\s*(?:value\s*=\s*)?"([^"]*)"\s*\))?`：
# 它要求引号后**紧跟右括号**，于是 @PostMapping(value = "/x", produces = ...) 这类带尾随属性的
# 写法整段匹配失败 → group(2) 为 None → 产出「只有类前缀」的**幻影端点**，
# 同时真实端点被丢掉。2026-10-03 实测：6 条幻影 + 7 条真端点丢失
# （如 GET /api/v1/resource/sse 丢失、幻影 GET /api/v1/resource 混入）。
# 幻影会让门禁**假绿**（前端调到不存在的路径也能过），比漏报更危险。
METHOD_MAPPING_RE = re.compile(r'@(Get|Post|Put|Delete|Patch)Mapping\b(?:\s*\(([^)]*)\))?')
PATH_LITERAL_RE = re.compile(r'"([^"]*)"')
CLASS_PREFIX_RE = re.compile(r'@RequestMapping\s*\(\s*(?:value\s*=\s*)?"([^"]*)"')
# 类级 @RequestMapping 的「全仓普查」用（只看路径以 /api/v1 开头的那些），用来兜住漏扫目录。
API_PREFIX = '/api/v1'

# IPD 端点分散在两个模块，两个都必须扫：
#   - ruoyi-modules/ruoyi-ipd : 66 个业务控制器
#   - ruoyi-admin             : IpdPlatformAuthController（提供 POST /api/v1/auth/platform-token）
# 2026-10-03：漏了 ruoyi-admin 这一处，导致 platform-token 被判成「前端调用了不存在的端点」。
# 同一个洞在 docs/ipd-系统说明/验收/D轮-.../D1-...md:105 就记录过一次——说明光靠人记目录记不住，
# 所以下面加了「全仓普查」守卫，任何新的 /api/v1 控制器跑到名单外都会直接 fail。
CONTROLLER_DIRS = [
    'ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller',
    'ruoyi-admin/src/main/java/org/ruoyi/ipd/controller',
]


def _is_commented(line: str) -> bool:
    s = line.lstrip()
    return s.startswith('//') or s.startswith('*') or s.startswith('/*')


def audit_scan_roots(backend_root: str):
    """全仓普查：所有类级 @RequestMapping("/api/v1...") 的 .java 必须落在 CONTROLLER_DIRS 内。

    这是对「漏扫目录」的 fail-closed 守卫：新增 /api/v1 控制器若放进未登记的目录，
    生成的清单会静默缺端点 → 门禁把真端点误报成断裂。宁可 fail 也不能静默。

    只管真正参与构建的源码树：跳过隐藏目录（.codex/.harness/.claude 下的历史备份与
    worktree 副本）和 target/。否则备份里的同名控制器会被当成「跑到名单外」，守卫天天误报。
    """
    root = Path(backend_root)
    allowed = {(root / d).resolve() for d in CONTROLLER_DIRS}
    stray = []
    for java in sorted(root.rglob('*.java')):
        rel_parts = java.relative_to(root).parts
        if any(p.startswith('.') for p in rel_parts) or 'target' in rel_parts:
            continue
        if '/src/main/java/' not in str(java):
            continue
        try:
            txt = java.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        for line in txt.split('\n'):
            if '@RequestMapping' in line and API_PREFIX in line and not _is_commented(line):
                if java.resolve().parent not in allowed:
                    stray.append(str(java.relative_to(root)))
                break
    return stray


def extract(backend_root: str):
    root = Path(backend_root)
    endpoints = []
    for rel in CONTROLLER_DIRS:
        ctrl_dir = root / rel
        if not ctrl_dir.is_dir():
            raise SystemExit(f'::error::扫描根不存在：{rel}（目录被移动/改名了？改 CONTROLLER_DIRS 后重跑）')
        for java in sorted(ctrl_dir.glob('*.java')):
            txt = java.read_text(encoding='utf-8')
            pm = CLASS_PREFIX_RE.search(txt)
            prefix = pm.group(1) if pm else ''
            for m in METHOD_MAPPING_RE.finditer(txt):
                verb, args = m.group(1).upper(), m.group(2)
                sub = ''
                if args:
                    sm = PATH_LITERAL_RE.search(args)
                    if sm:
                        sub = sm.group(1)
                endpoints.append({'method': verb, 'path': prefix + sub})
    # 去重排序
    seen = set()
    uniq = []
    for ep in sorted(endpoints, key=lambda e: (e['path'], e['method'])):
        key = (ep['method'], ep['path'])
        if key not in seen:
            seen.add(key)
            uniq.append(ep)
    # 畸形路径守卫：类级 @RequestMapping 若被方法级正则二次拼接，会产出 /api/v1/x/api/v1/x。
    # 当前 METHOD_MAPPING_RE 只认 @XxxMapping、不认 @RequestMapping，结构上拼不出来；
    # 这条守卫是防止后人把 @RequestMapping 也塞进方法正则时重演 D 轮记录的畸形路径问题。
    malformed = [f"{e['method']} {e['path']}" for e in uniq if e['path'].count(API_PREFIX) > 1]
    if malformed:
        raise SystemExit('::error::检出畸形路径（前缀被重复拼接）：\n  ' + '\n  '.join(malformed))
    return uniq


def main():
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    backend = sys.argv[1]
    try:
        head = subprocess.run(['git', '-C', backend, 'rev-parse', '--short', 'HEAD'],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        head = 'unknown'
    stray = audit_scan_roots(backend)
    if stray:
        raise SystemExit(
            '::error::以下文件定义了 /api/v1 类级 @RequestMapping，但不在 CONTROLLER_DIRS 里——'
            '生成的清单会缺这些端点，门禁会把它们误报成断裂。请把它加进 CONTROLLER_DIRS：\n  '
            + '\n  '.join(stray))
    endpoints = extract(backend)
    doc = {
        'generated_from': f'ruoyi-ai@{head}',
        'note': '由 gen-ipd-backend-contract.py 从后端 Controller 注解生成；后端接口变更后须重新生成并提交',
        'endpoints': endpoints,
    }
    json.dump(doc, sys.stdout, ensure_ascii=False, indent=2)
    print()
    print(f'共 {len(endpoints)} 个端点（from {head}）', file=sys.stderr)


if __name__ == '__main__':
    main()
