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
 *
 * 两侧路径口径（对账的前提，改任何一边前先读这里）：
 *   - 清单 ipd-backend-contract.json：**含** /api/v1 前缀（由后端类级 @RequestMapping 带出）
 *   - 前端 api/ipd 源码：**裸路径**（PREFIX 由 auth.ts 的 requestIpd 在 fetch 时统一拼）
 *   因此比较键统一为 `METHOD /api/v1 + 裸路径`，与清单同口径。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const API_DIR = 'apps/web-antd/src/api/ipd';
const CONTRACT = 'scripts/ipd-backend-contract.json';
const KNOWN_GAPS = 'scripts/ipd-known-gaps.json';
const PREFIX = '/api/v1';

// ---- 归一化：剥 query string + 路径参数两端统一为 {p} ----
// 三步，顺序不能换：
//  1) 砍掉查询串（第一个字面 '?' 之后）。
//  2) 砍掉「粘连在静态片段末尾」的插值，如 `/modify${query}`（${ 前面不是 '/'）。
//     这种写法是把整个查询串塞进变量再拼上去，query 只会是 '?...' 或 ''，不是路径段；
//     不砍的话会被归一化成 {p}，产出 `/bid-invitations/{p}/modify{p}` 这种**假断裂**
//     （2026-10-03 实测 bid.ts:211 即此例，契约里 `PUT /api/v1/bid-invitations/{id}/modify` 明明存在）。
//     反例保护：`/projects/${id}` 的插值前面是 '/'，属于真实路径段，必须保留。
//     已知残余局限：若将来有人写 `/v${n}` 这种「粘连的真实路径段」，会被误砍——当前仓库无此写法。
//  3) 路径参数（${...} 与 {...}）统一成 {p}，两侧同形才能对账。
const norm = (p) =>
  p.split('?')[0]
    .replace(/(?<=[^/])\$\{[^}]*\}$/, '')
    .replace(/\$\{[^}]+\}/g, '{p}')
    .replace(/\{[^}]+\}/g, '{p}');

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
// known-gaps 按约定存「后端控制器注解路径」（裸路径，不含 PREFIX）。
// 若有人误把 /api/v1 前缀写进去，拼接后会变成 /api/v1/api/v1/... 永远匹配不上——
// 那样这条登记会静默失效、断裂照旧报红，属于「登记了却没用」。这里直接 fail 拦住。
const badGap = gaps.find((g) => typeof g?.path === 'string' && g.path.startsWith(PREFIX));
if (badGap) {
  console.error(`::error::${KNOWN_GAPS} 中 "${badGap.path}" 误带了 ${PREFIX} 前缀；该文件存裸路径（后端控制器注解路径）`);
  process.exit(2);
}
const gapSet = new Set(gaps.map((g) => `${g.method} ${norm(PREFIX + g.path)}`));

// ---- 扫前端调用 ----
const files = readdirSync(API_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
// 覆盖全部「会经 http.ts / requestIpd 发请求」的封装；漏掉 ipdUpload/ipdDownload 会让
// 上传、下载两族端点完全不被对账（2026-10-03 前就是漏的）。
// 字面量部分用「排除定界符」而不是「排除全部引号」：模板串里嵌单引号（如
// `${approve ? 'true' : 'false'}`）时，旧写法会在单引号处断掉、整个调用**扫不到**
// （2026-10-03 实测 change.ts:161 的 leader-decision 调用就是这样漏掉的，恰好是真实的已删端点）。
const callRe =
  /\b(?:ipdGet|ipdPost|ipdPut|ipdDelete|ipdUpload|ipdDownload|requestIpd)\s*(?:<[^>]*>)?\s*\(\s*([`'"])((?:(?!\1)[\s\S])*?)\1/g;
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
      : m[0].startsWith('ipdUpload') ? 'POST'
      : m[0].startsWith('ipdDownload') ? 'GET'
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
  // 运行时真实 URL 的算法（2026-10-03 校正，推翻 R155-F 的旧假设）：
  //   http.ts 的 ipdGet/ipdPost/ipdPut/ipdDelete/ipdUpload/ipdDownload
  //     → store.authenticatedRequest → auth.ts 的 requestIpd
  //     → fetch(`/api/v1${path}`)   ← PREFIX 在 http 层统一加，源码里写的是**裸路径**
  // 所以这里必须做**字面拼接**，而不是「缺前缀才补」：
  // 若哪天源码误写成 ipdGet('/api/v1/projects')，真实 URL 会是 /api/v1/api/v1/projects（真 404），
  // 字面拼接才能如实报红；「缺前缀才补」会把这种真实错误洗成绿的。
  // 旧写法直接用 norm(c.path)（裸路径）去撞清单里的 `/api/v1/...`，等于 283 条全红。
  const key = `${c.verb} ${norm(PREFIX + c.path)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  if (backendSet.has(key)) continue;
  if (gapSet.has(key)) {
    gapHits += 1;
    // gap.path 不含 PREFIX（known-gaps 是后端控制器注解路径），仍走 norm(PREFIX + g.path) 对齐 gapSet
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
