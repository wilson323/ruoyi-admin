#!/usr/bin/env node
/**
 * IPD 前后端契约对照门禁（F4，2026-09-09）
 *
 * 病根背景：前端按想象写端点（platform-token 调用后端不存在，上线即 404），
 * 此前无任何机制会喊"对不上"。本脚本把对照固化：
 *   前端 api/ipd 的每个调用 → 必须命中后端契约清单（scripts/ipd-backend-contract.json）
 *   已知断裂 → scripts/ipd-known-gaps.json 显式登记（warning 不拦，owner 一眼可见）
 *
 * 用法: node scripts/check-ipd-contract.mjs
 * 退出码: 0=全对齐或仅 known-gap；1=存在未登记断裂；2=清单/扫描器自身失效（门禁失效必须拦）
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const API_DIR = 'apps/web-antd/src/api/ipd';
const CONTRACT = 'scripts/ipd-backend-contract.json';
const KNOWN_GAPS = 'scripts/ipd-known-gaps.json';
const PREFIX = '/api/v1';

// ---- 归一化：剥 query string + 路径参数两端统一为 {p} ----
const norm = (p) => p.split('?')[0].replace(/\$\{[^}]+\}/g, '{p}').replace(/\{[^}]+\}/g, '{p}');

// ---- 加载契约清单（含自检：清单坏了必须 fail，不能静默全过） ----
let contract;
try {
  contract = JSON.parse(readFileSync(CONTRACT, 'utf8'));
} catch (e) {
  console.error(`::error::契约清单读取失败 (${CONTRACT}): ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(contract.endpoints) || contract.endpoints.length < 50) {
  console.error(`::error::契约清单端点数 ${contract?.endpoints?.length ?? 0} < 50，清单疑似损坏或过期——门禁失效，直接 fail`);
  process.exit(2);
}
const backendSet = new Set(contract.endpoints.map((e) => `${e.method} ${norm(e.path)}`));
console.log(`后端契约清单: ${contract.endpoints.length} 端点 (${contract.generated_from})`);

// ---- 加载已知断裂登记 ----
let gaps = [];
try {
  gaps = JSON.parse(readFileSync(KNOWN_GAPS, 'utf8'));
} catch {
  console.error(`::warning::${KNOWN_GAPS} 读取失败，按无已知断裂处理`);
}
const gapSet = new Set(gaps.map((g) => `${g.method} ${norm(PREFIX + g.path)}`));

// ---- 扫前端调用 ----
const files = readdirSync(API_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
const callRe =
  /\b(?:ipdGet|ipdPost|ipdPut|ipdDelete|requestIpd)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]+)\1/g;
const methodFromOpts = (src, idx) => {
  // requestIpd 的 options 里找 method；ipdGet/ipdPost 由动词决定
  const ahead = src.slice(idx, idx + 200);
  const m = ahead.match(/method:\s*['"](\w+)['"]/);
  return m ? m[1].toUpperCase() : 'GET';
};

const calls = [];
for (const f of files) {
  const src = readFileSync(join(API_DIR, f), 'utf8');
  for (const m of src.matchAll(callRe)) {
    const verb = m[0].startsWith('ipdGet') ? 'GET'
      : m[0].startsWith('ipdPost') ? 'POST'
      : m[0].startsWith('ipdPut') ? 'PUT'
      : m[0].startsWith('ipdDelete') ? 'DELETE'
      : methodFromOpts(src, m.index + m[0].length);
    calls.push({ file: f, verb, path: m[2], line: src.slice(0, m.index).split('\n').length });
  }
}

// 扫描器自检：调用点过少说明正则失效（门禁失效必须拦）
if (calls.length < 50) {
  console.error(`::error::前端调用点只扫出 ${calls.length} 个（<50），扫描正则疑似失效——直接 fail`);
  process.exit(2);
}

// ---- 对照 ----
const broken = [];
let gapHits = 0;
const seen = new Set();
for (const c of calls) {
  const key = `${c.verb} ${norm(PREFIX + c.path)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  if (backendSet.has(key)) continue;
  if (gapSet.has(key)) {
    gapHits += 1;
    const g = gaps.find((x) => `${x.method} ${norm(PREFIX + x.path)}` === key);
    console.log(`::warning::已知断裂(登记在案): ${key} — ${g?.reason ?? ''} (${c.file})`);
    continue;
  }
  broken.push({ ...c, key });
}

console.log(`前端调用: ${calls.length} 处 / 去重 ${seen.size} 端点 / 已知断裂命中 ${gapHits} / 未登记断裂 ${broken.length}`);

if (broken.length) {
  console.error(`::error::以下前端调用在后端契约清单中不存在（将 404）——须补后端实现或登记 known-gap:`);
  for (const b of broken) {
    console.error(`  - ${b.key}  (${b.file}:${b.line})`);
  }
  process.exit(1);
}
console.log('契约对照通过：无未登记断裂。');
