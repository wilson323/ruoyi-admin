#!/usr/bin/env node
/**
 * check-ipd-color-gate.mjs — IPD 颜色系统门禁（锁 Global Constraint #21，Track D · D-G02）
 *
 * 施工图：ruoyi-ai/docs/ipd-系统说明/开发计划-分节草稿/Track-D-验证治理.md §2.2（脚本草案落成真脚本）
 *
 * 规则：
 *   R1 硬编码色字面量（#hex / rgb( / hsl( ）只允许出现在 CSS 自定义属性声明行
 *      （`--token: …`）——token 定义文件是唯一合法位置；其余一律违规。
 *      行内豁免标记：行含 `ipd-color-ok`（须带理由注释），计数上报。
 *      `rgb(var(--x))` / `hsl(var(--x))` 形态按 token 合法用法放行。
 *      `*.test.ts(x)` 不扫 R1（组件测试夹具可含色值）；preferences.ts / bootstrap.ts
 *      不扫 R1（它们是 R3 锚点，值必须是 hex）。
 *   R2 禁止 `--primary/--success/--warning/--destructive` 的 CSS 覆写（无效代码红线，
 *      组件层主色唯一入口 = preferences.ts + bootstrap.ts）。
 *   R3 两处同值 + 与 token 真值源对账：
 *      preferences.ts 与 bootstrap.ts 的 colorPrimary/Success/Warning/Destructive
 *      必须同值，且逐值等于 styles/ipd-tokens.css 的
 *      --ipd-blue/--ipd-green/--ipd-amber/--ipd-red（首个 :root 段）。
 *
 * 基线（scripts/baselines/ipd-color-baseline.json）：
 *   R1/R2 违规按「文件 → 条数」计数棘轮只减不增（不记行号，防行号漂移）；
 *   基线只允许脚本独占写（--update-baseline），对齐 ratchet-data-guard 精神 +
 *   orphan-gate-lib.mjs writeBaseline 的「只减不增、新增拒绝入账」成熟模式。
 *
 * 退出码（D-G02 约定）：0=通过  1=违规/基线被突破  2=锚点缺失/脚本或输入错误
 *
 * 用法（参数解析对齐 typecheck-error-count.mjs 的 --key=value，兼容施工图 --key value 形态）：
 *   node scripts/check-ipd-color-gate.mjs [--root <srcDir>] [--baseline <f.json>] [--update-baseline]
 *   默认 --root=apps/web-antd/src、--baseline=scripts/baselines/ipd-color-baseline.json（相对仓根）
 *
 * 自证能红（scripts/__fixtures__/color-gate-{clean,red}/，见同目录 README）：
 *   干净夹具（token 用法 + 两处同值）                → exit 0
 *   违规夹具（#1677ff / :root{--primary:…} / 两处不同值）→ exit 1
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 参数解析（--key=value / --key value / --flag 三形态通吃） ----------
function parseCli(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}
const cli = parseCli(process.argv.slice(2));
const ROOT = resolve(REPO_ROOT, cli.root ?? join('apps', 'web-antd', 'src'));
const BASELINE = resolve(REPO_ROOT, cli.baseline ?? join('scripts', 'baselines', 'ipd-color-baseline.json'));
const UPDATE = cli['update-baseline'] === true;

if (!existsSync(ROOT)) {
  console.error(`[color-gate] --root 缺失或不存在: ${ROOT}`);
  process.exit(2);
}

const ANCHOR_PREF = join(ROOT, 'preferences.ts');
const ANCHOR_BOOT = join(ROOT, 'bootstrap.ts');
const ANCHOR_TOKENS = join(ROOT, 'styles', 'ipd-tokens.css');
for (const f of [ANCHOR_PREF, ANCHOR_BOOT, ANCHOR_TOKENS]) {
  if (!existsSync(f)) {
    console.error(`[color-gate] 锚点文件缺失(不得删除以规避门禁): ${f}`);
    process.exit(2);
  }
}

const COLOR_KEY_MAP = {
  colorPrimary: '--ipd-blue',
  colorSuccess: '--ipd-green',
  colorWarning: '--ipd-amber',
  colorDestructive: '--ipd-red',
};
const errors = [];
const pragmas = [];
const counts = {}; // rel -> {r1, r2}
const bump = (rel, rule) => {
  counts[rel] ??= { r1: 0, r2: 0 };
  counts[rel][rule]++;
};

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(vue|ts|tsx|css)$/.test(name)) yield p;
  }
}

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const FUNC = /\b(?:rgb|rgba|hsl|hsla)\s*\(/;
const CUSTOM_PROP = /(?:^|[\s;{])--[\w-]+\s*:/;
const FORBID_OVERRIDE = /--(?:primary|success|warning|destructive)\s*:/;

for (const abs of walk(ROOT)) {
  const rel = relative(ROOT, abs).split(sep).join('/');
  const isAnchor = abs === ANCHOR_PREF || abs === ANCHOR_BOOT;
  if (/\.test\.tsx?$/.test(rel)) continue; // 测试夹具不扫 R1（组件测试断言里可含色值）
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return;
    if (t.includes('ipd-color-ok')) {
      pragmas.push(`${rel}:${idx + 1}`);
      return;
    }
    if (!isAnchor && /\.(vue|ts|tsx|css)$/.test(rel)) {
      const tokenUse = /var\s*\(\s*--/.test(line); // rgb(var(--x)) / hsl(var(--x)) 属 token 合法用法
      if ((HEX.test(line) || FUNC.test(line)) && !CUSTOM_PROP.test(line) && !tokenUse) {
        bump(rel, 'r1');
        errors.push(`R1 硬编码色 ${rel}:${idx + 1} → ${t.slice(0, 80)}`);
      }
    }
    if (/\.css$/.test(rel) && FORBID_OVERRIDE.test(line)) {
      bump(rel, 'r2');
      errors.push(`R2 禁止 CSS 覆写组件主色 --primary/… ${rel}:${idx + 1}`);
    }
  });
}

// ---- R3 两处同值 + token 对账 ----
function extractKeyed(src, keys, re) {
  const out = {};
  for (const k of keys) {
    const m = [...src.matchAll(new RegExp(re.source.replace('KEY', k), 'g'))];
    if (m.length === 0) return { error: `缺少 ${k}` };
    const vals = [...new Set(m.map((x) => x[1].toLowerCase()))];
    if (vals.length > 1) return { error: `${k} 同文件多值: ${vals.join(' / ')}` };
    out[k] = vals[0];
  }
  return out;
}
function rootBlock(css) {
  const i = css.indexOf(':root');
  if (i < 0) return '';
  const start = css.indexOf('{', i);
  if (start < 0) return '';
  let depth = 0;
  for (let j = start; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') {
      depth--;
      if (depth === 0) return css.slice(start, j);
    }
  }
  return '';
}
const pref = extractKeyed(readFileSync(ANCHOR_PREF, 'utf8'), Object.keys(COLOR_KEY_MAP), /KEY:\s*'([^']+)'/);
const boot = extractKeyed(readFileSync(ANCHOR_BOOT, 'utf8'), Object.keys(COLOR_KEY_MAP), /KEY:\s*'([^']+)'/);
const tokBlock = rootBlock(readFileSync(ANCHOR_TOKENS, 'utf8'));
const tok = {};
for (const tokName of Object.values(COLOR_KEY_MAP)) {
  const m = tokBlock.match(new RegExp(`${tokName}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) {
    errors.push(`R3 ipd-tokens.css :root 缺 ${tokName}`);
    continue;
  }
  tok[tokName] = m[1].toLowerCase();
}
for (const [k, tokName] of Object.entries(COLOR_KEY_MAP)) {
  if (pref.error) {
    errors.push(`R3 preferences.ts ${pref.error}`);
    break;
  }
  if (boot.error) {
    errors.push(`R3 bootstrap.ts ${boot.error}`);
    break;
  }
  if (pref[k] !== boot[k]) errors.push(`R3 两处不同值: ${k} preferences=${pref[k]} bootstrap=${boot[k]}`);
  if (tok[tokName] && pref[k] !== tok[tokName]) {
    errors.push(`R3 与 token 不一致: ${k}=${pref[k]} 应等于 ${tokName}=${tok[tokName]}`);
  }
}

// ---- 基线棘轮（按文件计数，只减不增；脚本独占写） ----
let baseline = { files: {} };
if (existsSync(BASELINE)) {
  try {
    const doc = JSON.parse(readFileSync(BASELINE, 'utf8'));
    if (!doc || typeof doc !== 'object' || typeof doc.files !== 'object' || doc.files === null) {
      console.error(`[color-gate] baseline schema 错误（须含 files:object）: ${BASELINE}`);
      process.exit(2);
    }
    baseline = doc;
  } catch (e) {
    console.error(`[color-gate] baseline JSON 解析失败: ${BASELINE} (${e.message})`);
    process.exit(2);
  }
}

if (UPDATE) {
  // 只减不增（仿 orphan-gate-lib.mjs writeBaseline）：相对既有基线计数增加 ⇒ 拒绝入账。
  // 新增违规必须修代码，不得经 --update-baseline 吸收（治"手改基线绕门禁"的脚本侧入口）。
  const prev = baseline.files ?? {};
  const grown = [];
  for (const [rel, c] of Object.entries(counts)) {
    const b = prev[rel] ?? { r1: 0, r2: 0 };
    if (c.r1 > (b.r1 ?? 0) || c.r2 > (b.r2 ?? 0)) {
      grown.push(`${rel} R1 ${b.r1 ?? 0}→${c.r1} / R2 ${b.r2 ?? 0}→${c.r2}`);
    }
  }
  if (Object.keys(prev).length > 0 && grown.length > 0) {
    console.error('[color-gate] --update-baseline 拒绝写入: 相对既有基线计数增长（棘轮只减不增）:');
    grown.slice(0, 10).forEach((g) => console.error('  ' + g));
    console.error('  新增违规须修复源码后重跑；确需登记存量债走 Task 卡评审。');
    process.exit(2);
  }
  mkdirSync(dirname(BASELINE), { recursive: true });
  const doc = {
    $schema_version: 1,
    generated_at: new Date().toISOString(),
    gen_cmd: 'node scripts/check-ipd-color-gate.mjs --update-baseline',
    root: relative(REPO_ROOT, ROOT).split(sep).join('/'),
    files: counts,
    notice:
      '脚本独占写（node scripts/check-ipd-color-gate.mjs --update-baseline）。手工编辑违反 ratchet-data-guard 精神；R1/R2 计数棘轮只减不增，新增违规须修复不得入账。',
  };
  writeFileSync(BASELINE, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log(`[color-gate] baseline 已更新: ${BASELINE}（${Object.keys(counts).length} 文件入账）`);
  baseline = doc; // 本次即基线 → 不再计 regression
}

const regressions = [];
for (const [rel, c] of Object.entries(counts)) {
  const b = baseline.files[rel] ?? { r1: 0, r2: 0 };
  if (c.r1 > (b.r1 ?? 0)) regressions.push(`${rel} R1 ${b.r1 ?? 0}→${c.r1} 超基线`);
  if (c.r2 > (b.r2 ?? 0)) regressions.push(`${rel} R2 ${b.r2 ?? 0}→${c.r2} 超基线`);
}

console.log(`[color-gate] R1/R2 违规计数: ${JSON.stringify(counts)} ipd-color-ok 豁免: ${pragmas.length} 处`);
errors.slice(0, 20).forEach((e) => console.log('  ' + e));
regressions.forEach((e) => console.log('  [REGRESSION] ' + e));
if (errors.some((e) => e.startsWith('R3')) || regressions.length > 0) {
  console.log('[color-gate] FAIL');
  process.exit(1);
}
if (errors.length > 0 && Object.keys(baseline.files ?? {}).length === 0 && !UPDATE) {
  console.log('[color-gate] FAIL（存在违规且无基线）');
  process.exit(1);
}
console.log('[color-gate] PASS');
process.exit(0);
