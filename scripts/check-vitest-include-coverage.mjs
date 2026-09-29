#!/usr/bin/env node
/**
 * check-vitest-include-coverage.mjs — 测试发现完备性门禁（Track D · D-G05，防假绿第 5 类）
 *
 * 施工图：ruoyi-ai/docs/ipd-系统说明/开发计划-分节草稿/Track-D-验证治理.md §2.5
 *
 * 问题：vitest.ipd.config.mts 的 include 是显式白名单——测试文件存在但不被任何 include
 * 命中时 vitest 永远不会执行它，"vitest 全绿"是空转（假绿⑤）。
 * 判据：src 树下每个 *.test.ts(x) / *.spec.ts(x) 至少命中 vitest 配置 include 之一。
 * 退出码：0=全部被发现  1=存在孤儿测试文件  2=脚本/输入错误（配置解析失败必须拦）
 *
 * 用法（参数解析对齐 typecheck-error-count.mjs 的 --key=value，兼容 --key value 形态）：
 *   node scripts/check-vitest-include-coverage.mjs [--config vitest.ipd.config.mts] [--src apps/web-antd/src]
 *   默认路径相对仓根（脚本自身位置推断，仿 check-api-contract-fe-be.mjs REPO_ROOT 模式）。
 *
 * 自证能红：在 include 未覆盖路径放孤儿测试文件（如 views/agent/<x>/orphan.test.ts——
 * views/mcp/** 与 views/agent/agent/** 已进白名单，须选白名单外路径）→ exit 1 → 清理 → exit 0。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 参数解析（--key=value / --key value / --flag） ----------
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
const CONFIG = resolve(REPO_ROOT, cli.config ?? 'vitest.ipd.config.mts');
const SRC = resolve(REPO_ROOT, cli.src ?? join('apps', 'web-antd', 'src'));
if (!existsSync(CONFIG) || !existsSync(SRC)) {
  console.error(`[vitest-include] 配置或源目录缺失: ${CONFIG} / ${SRC}`);
  process.exit(2);
}

const cfgText = readFileSync(CONFIG, 'utf8');
const m = cfgText.match(/include:\s*\[([\s\S]*?)\]/);
if (!m) {
  console.error('[vitest-include] 解析 include 数组失败（配置格式变更需同步本脚本）');
  process.exit(2);
}
const globs = [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
if (globs.length === 0) {
  console.error('[vitest-include] include 为空');
  process.exit(2);
}

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:[^/]*\\/)*';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
const res = globs.map(globToRegex);
const cfgDir = dirname(CONFIG); // include glob 以配置文件所在目录为基准

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.((test|spec)\.(ts|tsx))$/.test(name)) yield p;
  }
}
const orphans = [];
let total = 0;
for (const abs of walk(SRC)) {
  total++;
  const norm = relative(cfgDir, abs).split(sep).join('/'); // 与 include 同一基准
  if (!res.some((r) => r.test(norm))) orphans.push(norm);
}
console.log(`[vitest-include] 测试文件 ${total} 个, include 模式 ${globs.length} 条, 孤儿 ${orphans.length} 个`);
orphans.forEach((o) => console.log(`  [ORPHAN] ${o} 不被任何 include 命中 → vitest 永远不会执行它`));
if (orphans.length > 0) {
  console.log('[vitest-include] FAIL');
  process.exit(1);
}
console.log('[vitest-include] PASS');
process.exit(0);
