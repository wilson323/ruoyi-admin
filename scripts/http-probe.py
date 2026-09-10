"""HTTP 真活验证：把前端所有 ipd/*.ts 调用点打到后端。

关键点：
1. wecom mock login 的 token TTL 极短（<60s），所以每 25 个请求重新 login 一次
2. 串行调用，每个间隔 50ms，避免并发 throttle
3. {id} 通配替换为 900104（项目/人员通用 ID）
4. POST/PUT body 用 {}，GET/DELETE 无 body
5. 结果按 http code + biz code 分桶
6. 真业务成功 = http=200 AND biz=0
7. 真 FE-only = http=200 AND biz=404（wrapper 404：路由存在但资源不存在，且 caller 永远不可能用真 id 替换）
8. 真后端 bug = http=500（看后端 sys-error.log 找根因）

登录方式：
- python3 scripts/http-probe.py              # 默认 RD_PM（wecom mock login）
- python3 scripts/http-probe.py --user=ipd-market  # 用 username+password 登录 MARKET_PM
- python3 scripts/http-probe.py --user=ipd-rd --password=xxx
- python3 scripts/http-probe.py --wecom       # wecom mock login 模式

复测：
    python3 scripts/http-probe.py
    python3 scripts/http-probe.py --user=ipd-market
"""
import argparse
import re
import json
import urllib.request
import urllib.error
from pathlib import Path

API_DIR = Path('/Users/mac/Documents/ruoyi-ipd-integrated/apps/web-antd/src/api/ipd')
BASE_URL = 'http://127.0.0.1:16039'
DEFAULT_PASSWORD = 'Ipd@123456'
WECOM_USER_ID = 'wecom_R29_4_test_001'
RELOGIN_EVERY = 25


def login(username='ipd-rd', password=DEFAULT_PASSWORD, wecom=False) -> str:
    """登录拿 token。

    - wecom=True：wecom mock login（仅 ipd-rd 可用）
    - username/password：IPD /auth/login username+password

    当前 db 状态（2026-09-10）：
    - ipd-rd (900104): wecom_user_id='wecom_R29_4_test_001'，password_hash 默认
    - ipd-market (900103): password_hash 默认 Ipd@123456
    - ipd-admin (900101) / ipd-leader (900102): password_hash 已被兄弟会话改过
    """
    if wecom:
        body = json.dumps({"wecomUserId": WECOM_USER_ID}).encode()
        url = f"{BASE_URL}/api/v1/auth/wecom/qr-login"
    else:
        body = json.dumps({"username": username, "password": password}).encode()
        url = f"{BASE_URL}/api/v1/auth/login"
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as r:
        d = json.loads(r.read())
        if d.get("code") != 0:
            raise RuntimeError(f'login failed: {d.get("message")}')
        return d["data"]["token"]


def scan_fe_calls() -> set:
    """抓前端所有 ipd/*.ts 里的调用点。"""
    fe_calls = set()
    pat_fn = re.compile(
        r'\b(ipdGet|ipdPost|ipdPut|ipdDelete)\s*(?:<[^>]*>)?\s*\(\s*([\'"`])([^\'"`]+)\2')
    pat_req = re.compile(
        r'\brequestIpd\s*\(\s*([\'"`])([^\'"`]+)\1\s*,\s*\{\s*method\s*:\s*[\'"`]([A-Z]+)[\'"`]')

    for f in sorted(API_DIR.glob('*.ts')):
        if '.test.' in f.name or '.bak' in f.name:
            continue
        text = f.read_text(encoding='utf-8')

        for m in pat_fn.finditer(text):
            fn = m.group(1)
            path = m.group(3)
            verb = {'ipdGet': 'Get', 'ipdPost': 'Post',
                    'ipdPut': 'Put', 'ipdDelete': 'Delete'}[fn]
            p = re.sub(r'\$\{encodeURIComponent\(([^)]+)\)\}', r'{\1}', path)
            p = re.sub(r'\$\{[^}]+\}', '{id}', p)
            p = p.split('?')[0]
            if p.startswith('/') and not p.startswith('/api/v1'):
                p = '/api/v1' + p
            fe_calls.add((verb, p, f.name))

        for m in pat_req.finditer(text):
            path = m.group(2)
            verb = m.group(3).title()
            p = re.sub(r'\$\{encodeURIComponent\(([^)]+)\)\}', r'{\1}', path)
            p = re.sub(r'\$\{[^}]+\}', '{id}', p)
            p = p.split('?')[0]
            if p.startswith('/') and not p.startswith('/api/v1'):
                p = '/api/v1' + p
            fe_calls.add((verb, p, f.name))

    return fe_calls


def call(verb: str, path: str, tok: str):
    real = re.sub(r'\{[^}]+\}', '900104', path)
    url = f"{BASE_URL}{real}"
    http_v = {'Get': 'GET', 'Post': 'POST', 'Put': 'PUT', 'Delete': 'DELETE'}[verb]
    headers = {"Authorization": f"Bearer {tok}"}
    if http_v in ('POST', 'PUT', 'DELETE'):
        headers["Content-Type"] = "application/json"
    body = b'{}' if http_v in ('POST', 'PUT') else None
    req = urllib.request.Request(url, data=body, headers=headers, method=http_v)
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status, r.read()[:400]
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:400]
    except Exception as e:
        return 0, str(e).encode()[:400]


def classify(results):
    """按 http code + biz code 分桶。"""
    buckets = {
        'ok_real': [],          # http=200, biz=0：真业务成功
        'biz_404': [],          # http=200, biz=404：wrapper 404（FE-only）
        'biz_other': [],        # http=200, biz≠0：业务异常（参数/状态）
        'http_400': [],         # 缺参 / 类型错
        'http_404': [],         # 资源不存在
        'http_401': [],         # 未认证
        'http_403': [],         # 权限不足
        'http_500': [],         # 后端 bug
        'http_other': [],       # 其它（HTML 页面/parse 失败）
    }
    for r in results:
        v, p, f, code, biz, msg = r
        if code == 200 and isinstance(biz, int) and biz == 0:
            buckets['ok_real'].append(r)
        elif code == 200 and isinstance(biz, int) and biz == 404:
            buckets['biz_404'].append(r)
        elif code == 200:
            buckets['biz_other'].append(r)
        elif code == 400:
            buckets['http_400'].append(r)
        elif code == 401:
            buckets['http_401'].append(r)
        elif code == 403:
            buckets['http_403'].append(r)
        elif code == 404:
            buckets['http_404'].append(r)
        elif code == 500:
            buckets['http_500'].append(r)
        else:
            buckets['http_other'].append(r)
    return buckets


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--user', default='ipd-rd', help='username (default ipd-rd)')
    parser.add_argument('--password', default=DEFAULT_PASSWORD, help='password')
    parser.add_argument('--wecom', action='store_true', help='use wecom mock login')
    parser.add_argument('--out', default='/tmp/http-probe-result.txt', help='result file')
    args = parser.parse_args()

    fe_calls = scan_fe_calls()
    print(f'distinct FE calls: {len(fe_calls)}')

    # 登录模式
    if args.wecom:
        login_mode = f'wecom mock ({WECOM_USER_ID})'
    else:
        login_mode = f'username={args.user}'

    print(f'login mode: {login_mode}')

    sorted_calls = sorted(fe_calls)
    results = []

    for batch_start in range(0, len(sorted_calls), RELOGIN_EVERY):
        tok = login(username=args.user, password=args.password, wecom=args.wecom)
        batch = sorted_calls[batch_start:batch_start + RELOGIN_EVERY]
        for v, p, f in batch:
            code, body = call(v, p, tok)
            try:
                d = json.loads(body)
                biz = d.get('code', '?')
                msg = d.get('message', d.get('msg', ''))[:80]
            except Exception:
                biz, msg = '?', body[:80].decode(errors='replace')
            results.append((v, p, f, code, biz, msg))
        print(f'  progress: {len(results)}/{len(sorted_calls)}')

    buckets = classify(results)
    print('\n=== 分桶汇总 ===')
    for k, v in buckets.items():
        print(f'  {k:12s}: {len(v):3d}')

    print('\n=== 真业务成功 (http=200, biz=0) ===')
    for r in buckets['ok_real']:
        print(f'  ✓ {r[0]:6s} {r[1]:55s} ({r[2]})')

    print('\n=== 业务 wrapper 404 (真 FE-only：路由不存在) ===')
    for r in buckets['biz_404']:
        print(f'  ✗ {r[0]:6s} {r[1]:55s} ({r[2]})')

    print('\n=== HTTP 500 (后端 bug，查 sys-error.log) ===')
    for r in buckets['http_500']:
        print(f'  ✗ {r[0]:6s} {r[1]:55s} ({r[2]}) → {r[4]} {r[5]}')

    print('\n=== HTTP 401 (凭证失效) ===')
    for r in buckets['http_401'][:10]:
        print(f'  · {r[0]:6s} {r[1]:55s} ({r[2]})')

    print('\n=== HTTP 403 (权限不足) ===')
    for r in buckets['http_403'][:10]:
        print(f'  · {r[0]:6s} {r[1]:55s} ({r[2]})')

    # 写结构化结果
    with open(args.out, 'w') as out:
        out.write(f'# login={login_mode} total={len(results)}')
        for k, v in buckets.items():
            out.write(f' {k}={len(v)}')
        out.write('\n\n')
        for k, items in buckets.items():
            if items:
                out.write(f'=== {k} ({len(items)}) ===\n')
                for r in items:
                    out.write(f'{r[0]}\t{r[1]}\t{r[2]}\thttp={r[3]}\tbiz={r[4]}\t{r[5]}\n')
                out.write('\n')
    print(f'\n结果写入 {args.out}')


if __name__ == '__main__':
    main()
