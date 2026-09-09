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

MAPPING_RE = re.compile(
    r'@(Get|Post|Put|Delete|Patch)Mapping\s*(?:\(\s*(?:value\s*=\s*)?"([^"]*)"|\(\s*\))?')
BARE_RE = re.compile(r'@(Get|Post|Put|Delete|Patch)Mapping\s*(?=\s|\n|$)')
CLASS_PREFIX_RE = re.compile(r'@RequestMapping\s*\(\s*(?:value\s*=\s*)?"([^"]*)"')
# @GetMapping("/x") 与 bare @GetMapping（无括号）都要认


def extract(backend_root: str):
    ctrl_dir = Path(backend_root) / 'ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller'
    endpoints = []
    for java in sorted(ctrl_dir.glob('*.java')):
        txt = java.read_text(encoding='utf-8')
        pm = CLASS_PREFIX_RE.search(txt)
        prefix = pm.group(1) if pm else ''
        # 方法级注解：带路径参数形式
        for m in re.finditer(r'@(Get|Post|Put|Delete|Patch)Mapping\s*(?:\(\s*(?:value\s*=\s*)?"([^"]*)"\s*\))?', txt):
            verb, sub = m.group(1).upper(), m.group(2) or ''
            endpoints.append({'method': verb, 'path': prefix + sub})
        # bare 形式（无括号、无参数）
        for m in re.finditer(r'@(Get|Post|Put|Delete|Patch)Mapping(?![\w(\[])', txt):
            verb = m.group(1).upper()
            ep = {'method': verb, 'path': prefix}
            if ep not in endpoints:
                endpoints.append(ep)
    # 去重排序
    seen = set()
    uniq = []
    for ep in sorted(endpoints, key=lambda e: (e['path'], e['method'])):
        key = (ep['method'], ep['path'])
        if key not in seen:
            seen.add(key)
            uniq.append(ep)
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
