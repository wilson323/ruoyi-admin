#!/usr/bin/env node
/**
 * check-mcp-config-gates.mjs — MCP 配置面双门禁（Track D · D-G04）
 * （位掩码退出码，仿 check-api-contract-fe-be.mjs / orphan-gate-lib.mjs 约定）
 *
 * 施工图：ruoyi-ai/docs/ipd-系统说明/开发计划-分节草稿/Track-D-验证治理.md §2.4
 *
 *   位 1 (1)：表单字段集漂移 / 后端读取键漂移（锁 Global Constraint #20 + §0.6 结论 1）
 *            - 后端 LangChain4jMcpToolProviderService 的 configNode.has/get/path 键集
 *              必须恰为 {command, args, baseUrl}（新增读取键必须先改本契约常量 + ADR）
 *            - 前端连接表单字段（field/dataIndex/prop: '...'）落在连接键域 {command,args,
 *              baseUrl,env,headers,configJson,authConfig,timeout,sslContext} 的必须
 *              ⊆ {command,args,baseUrl}
 *            - `env` / `headers` 在 Task E-A1 落地前出现即违规（填了没用 = 假成功界面）
 *   位 4 (4)：凭据明文渲染（MCP 凭据 write-only 前端半区，Task E 交互红线 #19）
 *            - {{ }} 插值 / v-html 出现 configJson | authConfig 即违规
 *   位 2 (2)：环境或输入错误（锚点文件/目录缺失，门禁自身失效必须拦）
 * 叠加示例：5 = 1|4（字段漂移 + 明文渲染同时发生）；判定优先级 ENV(2) > 其余叠加位
 * 退出码 0 = PASS。
 *
 * 用法（参数解析对齐 typecheck-error-count.mjs 的 --key=value，兼容 --key value 形态）：
 *   node scripts/check-mcp-config-gates.mjs [--be-file <LangChain4jMcpToolProviderService.java>]
 *                                      [--fe-dir <dir> ...]（可重复，默认前端四目录）
 * 后端锚点解析（S1 参数化，去本机绝对路径硬编码）：
 *   --be-file 显式 > ../ruoyi-ai 同级仓推断 > 缺失即 exit 2（不静默降级，仿 check-api-contract-fe-be）
 *
 * 自证能红（scripts/__fixtures__/mcp-gates-{clean,red}/）：
 *   干净夹具（后端读 command/args/baseUrl + 前端只出契约字段）→ exit 0
 *   违规夹具（后端多读 timeout + 前端 field:'env' + {{ tool.configJson }}）→ exit 5
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CONTRACT_KEYS = ['command', 'args', 'baseUrl']; // §0.6 实测键集（唯一真相源常量）
const CONN_KEY_DOMAIN = [
  'command', 'args', 'baseUrl', 'env', 'headers',
  'configJson', 'authConfig', 'timeout', 'sslContext',
];
const FORBIDDEN_UNTIL_EA1 = ['env', 'headers'];

const BE_REL = join(
  'ruoyi-modules', 'ruoyi-chat', 'src', 'main', 'java', 'org', 'ruoyi',
  'mcp', 'service', 'core', 'LangChain4jMcpToolProviderService.java',
);

// ---------- 参数解析（--key=value / --key value / --flag；--fe-dir 可重复） ----------
const argv = process.argv.slice(2);
function getArg(k) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--' + k && argv[i + 1] !== undefined) return argv[i + 1];
    if (argv[i].startsWith('--' + k + '=')) return argv[i].slice(k.length + 3);
  }
  return undefined;
}
function getArgs(k) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--' + k && argv[i + 1] !== undefined) out.push(argv[i + 1]);
    else if (argv[i].startsWith('--' + k + '=')) out.push(argv[i].slice(k.length + 3));
  }
  return out;
}

function resolveBeFile() {
  const explicit = getArg('be-file');
  if (explicit) return resolve(REPO_ROOT, explicit);
  const sibling = resolve(REPO_ROOT, '..', 'ruoyi-ai', BE_REL);
  if (existsSync(sibling)) return sibling;
  return null;
}

const BE_FILE = resolveBeFile();
const feArgs = getArgs('fe-dir');
const FE_DIRS = (feArgs.length ? feArgs : [
  join('apps', 'web-antd', 'src', 'views', 'mcp'),
  join('apps', 'web-antd', 'src', 'views', 'agent'),
  join('apps', 'web-antd', 'src', 'api', 'mcp'),
  join('apps', 'web-antd', 'src', 'api', 'agent'),
]).map((d) => resolve(REPO_ROOT, d));

let bits = 0;
const problems = [];
if (!BE_FILE || !existsSync(BE_FILE)) {
  console.error(`[mcp-gates] 后端锚点缺失: ${BE_FILE ?? '(未找到 ../ruoyi-ai 同级仓，须显式 --be-file)'}`);
  process.exit(2);
}
for (const d of FE_DIRS) {
  if (!existsSync(d)) {
    console.error(`[mcp-gates] 前端目录缺失: ${d}`);
    process.exit(2);
  }
}

// ---- 位1-a：后端真实读取键集 == 契约 ----
const beSrc = readFileSync(BE_FILE, 'utf8');
const beKeys = [
  ...new Set(
    [...beSrc.matchAll(/configNode\.(?:has|get|path)\(\s*"([A-Za-z0-9_]+)"\s*\)/g)].map((m) => m[1]),
  ),
].sort();
const want = [...CONTRACT_KEYS].sort();
if (JSON.stringify(beKeys) !== JSON.stringify(want)) {
  bits |= 1;
  problems.push(
    `[字段集] 后端读取键 ${JSON.stringify(beKeys)} ≠ 契约 ${JSON.stringify(want)}（新增键须先 ADR + 改 CONTRACT_KEYS）`,
  );
}

// ---- 前端扫描 ----
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(vue|ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}
for (const dir of FE_DIRS) {
  for (const abs of walk(dir)) {
    const rel = relative(REPO_ROOT, abs).split(sep).join('/');
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      // 位1-b：连接键域字段必须 ⊆ 契约；E-A1 前禁 env/headers
      const fm = line.match(/(?:field|dataIndex|prop):\s*'([A-Za-z0-9_]+)'/g) ?? [];
      for (const hit of fm) {
        const key = hit.match(/'([A-Za-z0-9_]+)'/)[1];
        if (!CONN_KEY_DOMAIN.includes(key)) continue;
        if (FORBIDDEN_UNTIL_EA1.includes(key)) {
          bits |= 1;
          problems.push(`[字段集] E-A1 未落地前禁止字段 '${key}' ${rel}:${idx + 1}`);
        } else if (!CONTRACT_KEYS.includes(key)) {
          bits |= 1;
          problems.push(`[字段集] 字段 '${key}' 不在后端真实读取键集 ${rel}:${idx + 1}`);
        }
      }
      // 位4：凭据明文渲染
      if (
        /\{\{[^}]*(?:configJson|authConfig)[^}]*\}\}/.test(line) ||
        /v-html[^\n]*(?:configJson|authConfig)/.test(line)
      ) {
        bits |= 4;
        problems.push(`[凭据渲染] 密钥字段进入渲染层 ${rel}:${idx + 1} → ${t.slice(0, 80)}`);
      }
    });
  }
}
problems.slice(0, 20).forEach((p) => console.log('  ' + p));
console.log(`[mcp-gates] backend read keys = ${JSON.stringify(beKeys)}`);
console.log(bits === 0 ? '[mcp-gates] PASS (0)' : `[mcp-gates] FAIL (bits=${bits})`);
process.exit(bits);
