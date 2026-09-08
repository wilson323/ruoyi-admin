#!/usr/bin/env node
/**
 * IPD 端到端冒烟测试（零依赖，Node >= 18）。
 *
 * 验的是「真实用户可见路径」，不是只看 status code：
 *   1. 前端 SPA 返回非空 HTML（此前曾用 -o /dev/null 只看 200 掩盖了 0 字节 body）
 *   2. POST /api/v1/auth/login 走 15666 前端代理 → code=0 + token + traceId
 *   3. GET  /api/v1/auth/me（带票）→ code=0
 *   4. GET  /api/v1/workbench/summary（带票）→ code=0   （真端点见 WorkbenchController）
 *
 * 用法（凭据不入库，从环境变量传入）：
 *   IPD_SMOKE_USER=ipd-admin IPD_SMOKE_PASS=xxx node scripts/ipd-smoke.mjs
 *   IPD_SMOKE_BASE=http://127.0.0.1:15666  （默认）
 *   IPD_SMOKE_BACKEND=1                    （改为直连后端 16039 验证，绕过代理）
 */
const BASE = process.env.IPD_SMOKE_BASE ?? 'http://127.0.0.1:15666';
const BACKEND_DIRECT = process.env.IPD_SMOKE_BACKEND === '1';
const API_BASE = BACKEND_DIRECT ? 'http://127.0.0.1:16039' : BASE;
const USER = process.env.IPD_SMOKE_USER;
const PASS = process.env.IPD_SMOKE_PASS;

if (!USER || !PASS) {
  console.error('缺少 IPD_SMOKE_USER / IPD_SMOKE_PASS 环境变量（凭据只从环境变量传入，不入库不打印）。');
  process.exit(2);
}

let failures = 0;
function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`${mark}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function main() {
  // 1. SPA 非空 HTML：必须看 body 内容，不接受仅 status 200
  const home = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(8000) });
  const homeBody = await home.text();
  check('前端 SPA /',
    home.status === 200 && homeBody.includes('<div id="app">') && homeBody.length > 1000,
    `status=${home.status} bytes=${homeBody.length}`);

  // 2. 登录（envelope: code/message/data + P0.7 traceId）
  const login = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
    signal: AbortSignal.timeout(8000),
  });
  const loginBody = await login.json().catch(() => ({}));
  const token = loginBody?.data?.token;
  check('POST /api/v1/auth/login',
    login.status === 200 && loginBody.code === 0 && typeof token === 'string' && token.length > 0,
    `status=${login.status} code=${loginBody.code} message=${loginBody.message ?? ''}`);
  check('envelope traceId (P0.7)',
    typeof loginBody.traceId === 'string' && loginBody.traceId.length > 0,
    `traceId=${loginBody.traceId ?? '(missing)'}`);
  if (!token) process.exit(1);

  // 3/4. 带票业务只读端点
  for (const path of ['/api/v1/auth/me', '/api/v1/workbench/summary']) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    check(`GET ${path}`,
      res.status === 200 && body.code === 0,
      `status=${res.status} code=${body.code} message=${body.message ?? ''}`);
  }

  if (failures > 0) {
    console.error(`\n冒烟未通过：${failures} 项失败。`);
    process.exit(1);
  }
  console.log('\n冒烟全过：真实用户路径（SPA → 登录 → 会话 → 业务端点）可用。');
}

main().catch((error) => {
  console.error('冒烟异常：', error?.cause?.code ?? error?.message ?? error);
  process.exit(1);
});
