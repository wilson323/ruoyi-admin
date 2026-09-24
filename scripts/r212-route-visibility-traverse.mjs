#!/usr/bin/env node
/**
 * r212-route-visibility-traverse.mjs — IPD 前端全量路由浏览器可见性遍历（R212，2026-09-24）
 *
 * 目标：补齐 R211 §4.4 T-V1「65+ 路由逐条可达」自动化遍历（R211b 只人工覆盖 14 页）。
 * 只读：不点任何写操作按钮；登录走 dev 演示账号（VITE 演示凭据，非生产）。
 *
 * 用法:
 *   R212_USER=ipd-admin R212_PASS=xxx node scripts/r212-route-visibility-traverse.mjs [--role rd]
 * 输出:
 *   scripts/r212-traverse-result.json（逐路由证据）
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const FRONTEND = process.env.R212_FRONTEND || 'http://127.0.0.1:15666';
const BACKEND = process.env.R212_BACKEND || 'http://127.0.0.1:15666'; // 走 vite 代理
const USER = process.env.R212_USER || 'ipd-admin';
const PASS = process.env.R212_PASS || (() => { console.error('R212_PASS required (见 .codex/ipd-dev/config/dev-accounts.yaml，勿入库)'); process.exit(2); })();

const RAW_ROUTES = JSON.parse(readFileSync('/tmp/r212_l3_routes.json', 'utf8'));
const ROUTES = RAW_ROUTES.map((r) => ({ ...r, path: r.full || r.path }));

async function api(path, token) {
  const r = await fetch(`${BACKEND}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return r.json().catch(() => null);
}

// 用真实数据填路由参数（拿不到则用 dev 种子常量兜底，来源 R211c 实拍项目池）
async function resolveParams(token) {
  const p = {};
  const projects = await api('/api/v1/projects', token);
  const lst = Array.isArray(projects?.data) ? projects.data : (projects?.data?.records || projects?.data?.list || []);
  const pr = (lst[0]?.project || lst[0] || {});
  console.log(`[resolveParams] projects code=${projects?.code} lst=${lst.length} firstId=${pr.id}`);
  p.projectId = process.env.R212_PROJECT_ID || pr.id || '9140004';
  p.projectCode = pr.code || '';
  p.changeId = '1';
  const products = await api('/api/v1/products', token);
  const plist = Array.isArray(products?.data) ? products.data : (products?.data?.records || []);
  p.productId = process.env.R212_PRODUCT_ID || (plist[0]?.product || plist[0] || {}).id || '1';
  p.id = p.projectId;
  p.actionId = '1';
  p.gateId = '1';
  p.requestId = '1';
  p.personId = '1';
  p.userId = '1';
  return p;
}

function fill(path, params) {
  return path.replace(/:(\w+)/g, (_m, k) => params[k] ?? params.id ?? '1');
}

const browser = await chromium.launch({ channel: process.env.R212_CHANNEL || 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// ---- 登录 ----
await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.fill('input[autocomplete="username"]', USER);
await page.fill('input[type="password"]', PASS);
await page.click('button:has-text("登录")');
await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 30_000 });
// 从 localStorage 取 token 给 HTTP 侧解析参数（失败则 HTTP 登录兑底）
let token = '';
for (const k of await page.evaluate(() => Object.keys(localStorage))) {
  const v = await page.evaluate((key) => localStorage.getItem(key) || '', k);
  const m = v.match(/"accessToken":"([^"]+)"/) || v.match(/"token":"([^"]+)"/);
  if (m) { token = m[1]; break; }
}
if (!token) {
  const lr = await fetch(`${BACKEND}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) });
  const lj = await lr.json();
  token = lj?.data?.token || '';
}
const params = await resolveParams(token);
console.log(`logged in as ${USER}, token=${token ? 'yes' : 'no'}, projectId=${params.projectId}`);

// ---- 遍历 ----
const results = [];
let consoles = [];
let netErrs = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoles.push(msg.text().slice(0, 200)); });
page.on('response', (res) => { if (res.status() >= 400 && !res.url().includes('favicon')) netErrs.push(`${res.status()} ${res.url().replace(FRONTEND, '')}`); });

for (const r of ROUTES) {
  if (r.path && r.path.includes('login') || r.path === '/ipd') continue;
  const url = `${FRONTEND}${fill(r.path, params)}`;
  consoles = []; netErrs = [];
  const t0 = Date.now();
  let finalUrl = url, textLen = 0, err = '';
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(1200); // SPA 渲染 + 首屏接口
    finalUrl = page.url();
    textLen = await page.evaluate(() => (document.querySelector('main')?.innerText || document.body.innerText || '').length);
  } catch (e) { err = String(e).slice(0, 150); }
  const blocked = finalUrl.includes('no-access');
  const notFound = finalUrl.includes('404') || textLen === 0;
  const whiteScreen = !blocked && !notFound && textLen < 60;
  results.push({
    route: r.path, title: r.title, access: r.access, url: fill(url, params).replace(FRONTEND, ''),
    finalUrl: finalUrl.replace(FRONTEND, ''), textLen, whiteScreen, blockedByGate: blocked, notFound,
    consoleErrors: consoles.slice(0, 5), httpErrors: netErrs.slice(0, 5), err, ms: Date.now() - t0,
  });
  const flag = whiteScreen ? '⚠️白屏' : blocked ? '🔒拦截' : notFound ? '❌404' : consoles.length || netErrs.length ? '🟡有错' : '✅';
  console.log(`${flag} ${r.path} → ${results.at(-1).finalUrl} len=${textLen} c=${consoles.length} h=${netErrs.length}`);
}

// 异常页截图存证
let shots = 0;
for (const item of results.filter((x) => x.whiteScreen || x.notFound)) {
  if (shots >= 10) break;
  try {
    await page.goto(item.url.startsWith('http') ? item.url : `${FRONTEND}${item.url}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `scripts/r212-shot-${++shots}-${item.route.replace(/\W+/g, '_').slice(-40)}.png` });
  } catch { /* ignore */ }
}

const summary = {
  user: USER, at: new Date().toISOString(), total: results.length,
  ok: results.filter((x) => !x.whiteScreen && !x.notFound && !x.blockedByGate && !x.consoleErrors.length && !x.httpErrors.length).length,
  whiteScreens: results.filter((x) => x.whiteScreen).map((x) => x.route),
  notFound: results.filter((x) => x.notFound).map((x) => x.route),
  blocked: results.filter((x) => x.blockedByGate).map((x) => x.route),
  withErrors: results.filter((x) => (x.consoleErrors.length || x.httpErrors.length) && !x.blockedByGate).map((x) => ({ r: x.route, c: x.consoleErrors[0], h: x.httpErrors[0] })),
};
writeFileSync('scripts/r212-traverse-result.json', JSON.stringify({ summary, results }, null, 1));
console.log('\n=== SUMMARY ===', JSON.stringify(summary, null, 1));
await browser.close();
