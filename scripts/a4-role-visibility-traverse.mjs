#!/usr/bin/env node
/**
 * a4-role-visibility-traverse.mjs — 任务A/A4 本轮角色可见性+七态+窄屏+键盘遍历（2026-09-29）
 *
 * 复用 r212 遍历骨架，差异：
 *  - 路由清单不再依赖 /tmp 旧文件：在浏览器内 dynamic import vite 源模块
 *    `/src/router/routes/modules/ipd.ts`，对当前工作树做递归扁平化（现查现用）。
 *  - 双角色（超管 vs 普通 RD）各遍历一遍，diff 拦截集合 = 角色可见性证据。
 *  - 窄屏：375x667 抽样检查横向溢出；键盘：Tab 焦点环抽样。
 * 只读：不点任何写操作按钮。口令仅经环境变量注入，不落盘不打印。
 *
 * 用法: A4_PASS=xxx node scripts/a4-role-visibility-traverse.mjs
 * 输出: scripts/a4-role-traverse-result.json
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const FRONTEND = process.env.A4_FRONTEND || 'http://127.0.0.1:15666';
const PASS = process.env.A4_PASS || (() => { console.error('A4_PASS required'); process.exit(2); })();
const ACCOUNTS = [
  { tag: 'admin', user: 'ipd-admin' },
  { tag: 'rd', user: 'ipd-rd' },
];

function fill(path, params) {
  return path.replace(/:(\w+)/g, (_m, k) => params[k] ?? params.id ?? '1');
}

async function login(page, user) {
  await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.fill('input[autocomplete="username"]', user);
  await page.fill('input[type="password"]', PASS);
  await page.click('button:has-text("登录")');
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 30_000 });
}

async function extractRoutes(page) {
  // vite dev 服务可直接 import TS 源模块，得到当前工作树真实路由定义
  return page.evaluate(async () => {
    const mod = await import('/src/router/routes/modules/ipd.ts');
    const flat = [];
    const walk = (rs, parentPath) => {
      for (const r of rs || []) {
        if (typeof r.path !== 'string') continue;
        const full = r.path.startsWith('/') ? r.path : `${parentPath}/${r.path}`.replace(/\/+/g, '/');
        const kids = r.children || [];
        if (kids.length) walk(kids, full);
        else if (r.component && !r.redirect) {
          flat.push({
            path: full, name: r.name || '', title: r.meta?.title || '',
            authority: r.meta?.authority || [], access: r.meta?.access || [],
          });
        } else if (r.redirect) {
          flat.push({ path: full, name: r.name || '', title: '(redirect)', authority: [], access: [], redirect: true });
        }
      }
    };
    walk(mod.default || [], '');
    return flat;
  });
}

async function resolveParams(page) {
  const api = async (path) => {
    const r = await page.evaluate(async (p) => {
      const res = await fetch(p, { headers: { Authorization: `Bearer ${sessionStorage.getItem('ruoyi-ipd-session-token') || ''}` } });
      return res.json().catch(() => null);
    }, path);
    return r;
  };
  // 页面内 fetch 无 token 也行（部分接口按 Cookie/会话）；失败则用种子常量兜底（与 r212 同源）
  let projectId = '9140004', productId = '1';
  try {
    const raw = sessionStorageGet(page, 'ruoyi-ipd.session');
    const token = await page.evaluate(() => {
      try { return JSON.parse(sessionStorage.getItem('ruoyi-ipd.session') || '{}')?.accessToken || ''; } catch { return ''; }
    });
    if (token) {
      const projects = await page.evaluate(async (t) => (await fetch('/api/v1/projects', { headers: { Authorization: `Bearer ${t}` } })).json().catch(() => null), token);
      const lst = Array.isArray(projects?.data) ? projects.data : (projects?.data?.records || projects?.data?.list || []);
      const pr = lst[0]?.project || lst[0] || {};
      if (pr.id) projectId = String(pr.id);
      const products = await page.evaluate(async (t) => (await fetch('/api/v1/products', { headers: { Authorization: `Bearer ${t}` } })).json().catch(() => null), token);
      const plist = Array.isArray(products?.data) ? products.data : (products?.data?.records || []);
      if ((plist[0]?.product || plist[0] || {}).id) productId = String((plist[0]?.product || plist[0] || {}).id);
    }
  } catch { /* 兜底种子常量 */ }
  return { projectId, productId, id: projectId, productCode: '', changeId: '1', actionId: '1', gateId: '1', requestId: '1', personId: '1', userId: '1', bidId: '1' };
}
function sessionStorageGet() { return null; }

async function traverse(page, routes, params, tag) {
  const results = [];
  let consoles = [], netErrs = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoles.push(msg.text().slice(0, 200)); });
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().includes('favicon')) netErrs.push(`${res.status()} ${res.url().replace(FRONTEND, '')}`); });
  for (const r of routes) {
    if (r.redirect || r.path.includes('login') || r.path === '/ipd' || r.path.includes('no-access')) continue;
    consoles = []; netErrs = [];
    const url = `${FRONTEND}${fill(r.path, params)}`;
    let finalUrl = url, textLen = 0, err = '';
    const t0 = Date.now();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForTimeout(900);
      finalUrl = page.url();
      textLen = await page.evaluate(() => (document.querySelector('main')?.innerText || document.body.innerText || '').length);
    } catch (e) { err = String(e).slice(0, 150); }
    const blocked = finalUrl.includes('no-access');
    const notFound = finalUrl.includes('404') || textLen === 0;
    const whiteScreen = !blocked && !notFound && textLen < 60;
    results.push({
      route: r.path, title: r.title, authority: r.authority, access: r.access,
      url: fill(url, params).replace(FRONTEND, ''), finalUrl: finalUrl.replace(FRONTEND, ''),
      textLen, whiteScreen, blockedByGate: blocked, notFound,
      consoleErrors: consoles.slice(0, 3), httpErrors: netErrs.slice(0, 3), err, ms: Date.now() - t0,
    });
    const flag = whiteScreen ? 'WHITE' : blocked ? 'BLOCKED' : notFound ? '404' : consoles.length || netErrs.length ? 'WARN' : 'OK';
    console.log(`[${tag}] ${flag} ${r.path} len=${textLen} c=${consoles.length} h=${netErrs.length}`);
  }
  return results;
}

const browser = await chromium.launch({ channel: process.env.A4_CHANNEL || 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await login(page, ACCOUNTS[0].user);
const routes = await extractRoutes(page);
console.log(`routes flattened: ${routes.length}`);
const params = await resolveParams(page);
console.log('params:', JSON.stringify(params));

const byAccount = {};
for (const acct of ACCOUNTS) {
  await login(page, acct.user);
  byAccount[acct.tag] = await traverse(page, routes, params, acct.tag);
}

// 角色可见性 diff：rd 被闸拦截而 admin 可达 = 路由闸生效证据
const adminBlocked = new Set(byAccount.admin.filter((x) => x.blockedByGate).map((x) => x.route));
const rdBlocked = new Set(byAccount.rd.filter((x) => x.blockedByGate).map((x) => x.route));
const roleDiff = [...rdBlocked].filter((r) => !adminBlocked.has(r));

// 窄屏 + 键盘抽样（以 admin 会话）
await login(page, 'ipd-admin');
const samples = ['/ipd/workbench', '/ipd/projects', `/ipd/project/${params.projectId}/overview`, '/ipd/admin/ai-models', '/ipd/product-lines'];
const narrow = [];
for (const s of samples) {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${FRONTEND}${s}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
  }));
  narrow.push({ page: s, ...overflow, horizontalOverflow: overflow.scrollW > overflow.clientW + 4 });
  await page.screenshot({ path: `scripts/a4-shot-narrow-${s.replace(/\W+/g, '_').slice(-30)}.png`, fullPage: false });
}
await page.setViewportSize({ width: 1440, height: 900 });
const kbd = [];
for (const s of samples.slice(0, 3)) {
  await page.goto(`${FRONTEND}${s}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(800);
  const hops = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    hops.push(await page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[aria-label=${el.getAttribute('aria-label')}]` : ''}` : 'none';
    }));
  }
  const focusRing = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const cs = getComputedStyle(el);
    return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  });
  kbd.push({ page: s, tabTargets: hops, anyFocusable: hops.some((h) => h !== 'body'), focusRingVisible: focusRing });
  console.log(`[kbd] ${s}: ${hops.join(' > ')} ring=${focusRing}`);
}

const summary = {
  at: new Date().toISOString(), routesTotal: routes.length,
  admin: { ok: byAccount.admin.filter((x) => !x.whiteScreen && !x.notFound && !x.blockedByGate && !x.consoleErrors.length && !x.httpErrors.length).length, blocked: [...adminBlocked], white: byAccount.admin.filter((x) => x.whiteScreen).map((x) => x.route), notfound: byAccount.admin.filter((x) => x.notFound).map((x) => x.route), warn: byAccount.admin.filter((x) => (x.consoleErrors.length || x.httpErrors.length) && !x.blockedByGate && !x.whiteScreen && !x.notFound).map((x) => ({ r: x.route, c: x.consoleErrors[0], h: x.httpErrors[0] })) },
  rd: { ok: byAccount.rd.filter((x) => !x.whiteScreen && !x.notFound && !x.blockedByGate && !x.consoleErrors.length && !x.httpErrors.length).length, blocked: [...rdBlocked], white: byAccount.rd.filter((x) => x.whiteScreen).map((x) => x.route), notfound: byAccount.rd.filter((x) => x.notFound).map((x) => x.route), warn: byAccount.rd.filter((x) => (x.consoleErrors.length || x.httpErrors.length) && !x.blockedByGate && !x.whiteScreen && !x.notFound).map((x) => ({ r: x.route, c: x.consoleErrors[0], h: x.httpErrors[0] })) },
  roleDiffRdBlockedAdminOk: roleDiff,
  narrow, keyboard: kbd,
};
writeFileSync('scripts/a4-role-traverse-result.json', JSON.stringify({ summary, byAccount }, null, 1));
console.log('\n=== SUMMARY ===', JSON.stringify(summary, null, 1));
await browser.close();
