#!/usr/bin/env python3
"""前后端契约一致性核对（v3：跨模块扫描 controller）"""
import re
from pathlib import Path

api_dir = Path('/Users/mac/Documents/ruoyi-ipd-integrated/apps/web-antd/src/api/ipd')
# 跨模块: ruoyi-ipd + ruoyi-admin
cd_dirs = [
    Path('/Users/mac/Documents/ruoyi-ai/ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller'),
    Path('/Users/mac/Documents/ruoyi-ai/ruoyi-admin/src/main/java/org/ruoyi/ipd/controller'),
]

# ============ 前端调用点 ============
fe_calls = set()
pat_fn = re.compile(r'\b(ipdGet|ipdPost|ipdPut|ipdDelete)\s*(?:<[^>]*>)?\s*\(\s*([\'"`])([^\'"`]+)\2')
# requestIpd('/xxx', { method: 'POST', ... })
pat_req = re.compile(r'\brequestIpd\s*\(\s*([\'"`])([^\'"`]+)\1\s*,\s*\{\s*method\s*:\s*[\'"`]([A-Z]+)[\'"`]')

for f in sorted(api_dir.glob('*.ts')):
    if '.test.' in f.name or '.bak' in f.name:
        continue
    text = f.read_text(encoding='utf-8')
    for m in pat_fn.finditer(text):
        fn = m.group(1)
        path = m.group(3)
        verb = {'ipdGet':'Get','ipdPost':'Post','ipdPut':'Put','ipdDelete':'Delete'}[fn]
        p = re.sub(r'\$\{encodeURIComponent\(([^)]+)\)\}', r'{\1}', path)
        p = re.sub(r'\$\{[^}]+\}', '{id}', p)
        p = p.split('?')[0]
        if p.startswith('/'):
            p = '/api/v1' + p if not p.startswith('/api/v1') else p
        fe_calls.add((verb, p))
    for m in pat_req.finditer(text):
        path = m.group(2)
        verb = m.group(3).title()
        p = re.sub(r'\$\{encodeURIComponent\(([^)]+)\)\}', r'{\1}', path)
        p = re.sub(r'\$\{[^}]+\}', '{id}', p)
        p = p.split('?')[0]
        if p.startswith('/'):
            p = '/api/v1' + p if not p.startswith('/api/v1') else p
        fe_calls.add((verb, p))

# ============ 后端端点（跨模块） ============
be_eps = set()
pat_method_with = re.compile(r'@(Get|Post|Put|Delete|Patch)Mapping\([\"\']([^\"\']*)[\"\']\)')
pat_method_empty = re.compile(r'@(Get|Post|Put|Delete|Patch)Mapping\s*(?=\(|\n|$)')

for cd in cd_dirs:
    if not cd.exists():
        continue
    for f in sorted(cd.glob('*.java')):
        if 'Controller' not in f.name:
            continue
        text = f.read_text(encoding='utf-8')
        rm = re.search(r'@RequestMapping\([\"\']([^\"\']*)[\"\']\)', text)
        base = (rm.group(1) if rm else '/api/v1').rstrip('/')
        for m in pat_method_with.finditer(text):
            verb = m.group(1).title()
            path = m.group(2)
            if path.startswith('/api/v1'):
                full = path
            elif path.startswith('/'):
                full = base + path
            else:
                full = base + '/' + path
            full = re.sub(r'\{[^}]+\}', '{id}', full)
            be_eps.add((verb, full))
        for m in pat_method_empty.finditer(text):
            verb = m.group(1).title()
            be_eps.add((verb, base))


def path_match(fe_p: str, be_p: str) -> bool:
    fe_p_norm = re.sub(r'\{[^}]+\}', '{id}', fe_p)
    be_p_norm = re.sub(r'\{[^}]+\}', '{id}', be_p)
    if fe_p_norm == be_p_norm:
        return True
    fe_re = re.compile('^' + fe_p_norm.replace('{id}', '[^/]+') + '$')
    be_re = re.compile('^' + be_p_norm.replace('{id}', '[^/]+') + '$')
    return bool(fe_re.match(be_p) or be_re.match(fe_p))


fe_only = []
for (fv, fp) in sorted(fe_calls):
    found = False
    for (bv, bp) in be_eps:
        if bv == fv and path_match(fp, bp):
            found = True
            break
    if not found:
        for (bv, bp) in be_eps:
            if path_match(fp, bp):
                found = True
                break
    if not found:
        fe_only.append((fv, fp))

be_only = []
for (bv, bp) in sorted(be_eps):
    found = False
    for (fv, fp) in fe_calls:
        if path_match(fp, bp):
            found = True
            break
    if not found:
        be_only.append((bv, bp))

both = len(be_eps) - len(be_only)
print(f'后端端点（跨模块扫描）: {len(be_eps)}')
print(f'前端调用点: {len(fe_calls)}')
print(f'前后端覆盖: {both}')
print(f'⚠️  FE-only (前端调了后端没有): {len(fe_only)}')
print(f'ℹ️  BE-only (后端有前端没调, 非错): {len(be_only)}')

print()
if fe_only:
    print('=== ⚠️ FE-only (前端调用无后端实现) ===')
    for v, p in fe_only:
        print(f'  ❌  {v:7s} {p}')
else:
    print('=== ✅ FE-only 为空, 前后端路径完全一致 ===')

# 写入文件
with open('/tmp/fe_only.txt', 'w') as out:
    out.write(f'后端(跨模块)={len(be_eps)} 前端={len(fe_calls)} 覆盖={both} FE-only={len(fe_only)} BE-only={len(be_only)}\n\n')
    out.write('=== FE-only ===\n')
    for v, p in fe_only:
        out.write(f'{v}\t{p}\n')
    out.write('\n=== BE-only (后端有但前端未用) ===\n')
    for v, p in be_only:
        out.write(f'{v}\t{p}\n')
