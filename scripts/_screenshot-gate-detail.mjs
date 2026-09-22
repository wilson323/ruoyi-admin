import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const FRONTEND = 'http://127.0.0.1:15666';
const BACKEND = 'http://127.0.0.1:16039';
const LOGIN_USER = 'ipd-admin';
const LOGIN_PASS = 'Ipd@123456';
const OUT_DIR = '/private/tmp/r177-a6/docs/ipd-系统说明/qa/r177-gate-detail-button-policy-20260922';
const PROJECT_ID = '101';
const NS = 'ruoyi-ipd-web-1.5.2-dev';

const FIXTURES = {
  pending: { gateId: '9001', gateCode: 'G3', status: 'PENDING', dualSign: true, leadSide: 'MARKET_PM', round: 2, signDueAt: 1893456000000, extensionCount: 1, my: null, other: null, otherSubmitted: false, observers: [{ name: '产品组长 ZK' }] },
  rejected: { gateId: '9002', gateCode: 'G2', status: 'REJECTED', dualSign: true, leadSide: 'RD_PM', round: 1, signDueAt: 1893456000000, extensionCount: 0, my: { decision: 'REJECT', opinion: '材料不足', signedAt: 1893456000000, reviewerType: 'MARKET_PM' }, other: { decision: 'REJECT', opinion: '需补数据', signedAt: 1893456000000, reviewerType: 'RD_PM' }, otherSubmitted: true },
  approved: { gateId: '9003', gateCode: 'G1', status: 'APPROVED', dualSign: true, leadSide: 'MARKET_PM', round: 1, signDueAt: 1893456000000, extensionCount: 0, my: { decision: 'APPROVE', opinion: '通过', signedAt: 1893456000000, reviewerType: 'MARKET_PM' }, other: { decision: 'APPROVE', opinion: '通过', signedAt: 1893456000000, reviewerType: 'RD_PM' }, otherSubmitted: true },
};

const LIST_FIXTURE = [
  { id: '9001', projectId: PROJECT_ID, gateCode: 'G3', status: 'PENDING', currentRound: 2, signDueAt: 1893456000000, concludedAt: null },
  { id: '9002', projectId: PROJECT_ID, gateCode: 'G2', status: 'REJECTED', currentRound: 1, signDueAt: 1893456000000, concludedAt: 1893456000000 },
  { id: '9003', projectId: PROJECT_ID, gateCode: 'G1', status: 'APPROVED', currentRound: 1, signDueAt: 1893456000000, concludedAt: 1893456000000 },
  { id: '9004', projectId: PROJECT_ID, gateCode: 'G4', status: 'ABSTAINED_TIMEOUT', currentRound: 1, signDueAt: 1893456000000, concludedAt: 1893456000000 },
];

function envelope(data, code = 0) {
  return { code, message: code === 0 ? 'ok' : '请求不合法', data, timestamp: new Date().toISOString(), traceId: 'pw-' + Math.random().toString(36).slice(2, 10) };
}

async function setupRouteIntercept(context, scenarioKey) {
  const fixture = FIXTURES[scenarioKey];
  await context.unroute('**/api/v1/projects/*/gates').catch(() => {});
  await context.unroute('**/api/v1/gates/*/review').catch(() => {});
  await context.route('**/api/v1/projects/*/gates', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope(LIST_FIXTURE)) });
  });
  await context.route('**/api/v1/gates/*/review', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope(fixture)) });
  });
}

// 在每次新 navigation 前注入 SUPER_ADMIN 全通码
async function injectSuperAdminCodes(page) {
  await page.evaluate((ns) => {
    const k = `${ns}-core-access`;
    const raw = JSON.parse(localStorage.getItem(k) || '{}');
    raw.accessCodes = ['*:*:*'];
    localStorage.setItem(k, JSON.stringify(raw));
  }, NS);
}

async function loginByForm(page) {
  await page.goto(`${FRONTEND}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input[autocomplete="username"]');
  await page.fill('input[autocomplete="username"]', LOGIN_USER);
  await page.fill('input[type="password"]', LOGIN_PASS);
  await page.click('button:has-text("登录")');
  await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 30000 });
  await page.waitForTimeout(2500);
  await injectSuperAdminCodes(page);
  console.log(`登录后落地: ${page.url()}`);
}

async function capture(page, context, scenarioKey, label, screenshotName) {
  await setupRouteIntercept(context, scenarioKey);
  const fixture = FIXTURES[scenarioKey];
  const url = `${FRONTEND}/ipd/admin/gate-detail?projectId=${PROJECT_ID}&gateId=${fixture.gateId}`;
  console.log(`[${label}] goto ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 第一次 navigation 后访问了 gate-detail 但 accessCodes 没注入；
  // 通过 page.evaluate 注入 accessCodes + 触发 vue store 重读：直接调 setAccessCodes(['*:*:*'])
  await page.waitForTimeout(1500);
  await page.evaluate((ns) => {
    const k = `${ns}-core-access`;
    const raw = JSON.parse(localStorage.getItem(k) || '{}');
    raw.accessCodes = ['*:*:*'];
    localStorage.setItem(k, JSON.stringify(raw));
  }, NS);
  try {
    await page.waitForSelector('.ant-card-head-title:has-text("评审动作")', { timeout: 15000 });
    console.log(`  [${label}] ✓ 评审动作卡片已渲染`);
  } catch (e) {
    console.log(`  [${label}] WARN 找不到'评审动作'，URL=${page.url()}`);
  }
  await page.waitForTimeout(500);
  const stats = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll('.ant-btn'));
    const visible = allBtns.filter((b) => !b.disabled && !b.hasAttribute('disabled'));
    return { total: allBtns.length, visible: visible.length, visibleLabels: visible.map((b) => b.innerText.trim().slice(0, 30)).filter(Boolean) };
  });
  console.log(`  [${label}] 渲染: 总按钮=${stats.total} 可见=${stats.visible} 标签=${JSON.stringify(stats.visibleLabels)}`);
  const out = resolve(OUT_DIR, screenshotName);
  await page.screenshot({ path: out, fullPage: true });
  console.log(`  [${label}] 截图: ${out}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Users/mac/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await ctx.newPage();
  await loginByForm(page);
  await capture(page, ctx, 'pending', '流转中 PENDING', '01-gate-detail-流转中.png');
  await capture(page, ctx, 'rejected', '已驳回 REJECTED', '02-gate-detail-已驳回.png');
  await capture(page, ctx, 'approved', '已通过 APPROVED', '03-gate-detail-已通过.png');
  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
