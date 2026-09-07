#!/usr/bin/env node
// scripts/typecheck-error-count.mjs
// 用途：解析 vue-tsc 输出 → 与已知红基线比对 → 检测新增错误（typecheck 不新增门禁）。
// 由 .github/workflows/typecheck-no-new-errors.yml 调用；也可本地手跑。
//
// 用法：
//   node scripts/typecheck-error-count.mjs \
//     --input=/tmp/typecheck-output.txt \
//     --baseline=21 \
//     --max-new-errors=0 \
//     --output=typecheck-report.json \
//     [--exit-on-regression]
//
// 约定：
// - 基线 = 历史已知的 HEAD 错误数（W3-A8 实证 21 个：review/gate-panel.vue 占 14）。
// - "新增" = 当前错误数 - 基线（当前实现单边比较；CI 不实现双 PR diff）。
// - 当前错误数 ≤ 基线 ⇒ 通过；当前错误数 > 基线 ⇒ 失败（视为新增）。
// - 错误行格式（vue-tsc 默认输出）：
//     <relative-path>(<line>,<col>): error TS<code>: <message>
//   例：src/views/ipd/review/gate-panel.vue(147,3): error TS2532: Object is possibly 'undefined'.
//
// 设计取舍：
// - 仅用 node 内置 API（fs / path / process），零依赖、零新增 lockfile。
// - regex 兼容 vue-tsc 与 ts 单跑两种 stderr 格式（带不带项目根路径前缀都吃）。
// - 输出 JSON 便于 CI 上传 artifact + 后续审计。

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULTS = {
  input: '/tmp/typecheck-output.txt',
  baseline: 21,
  maxNewErrors: 0,
  output: 'typecheck-report.json',
  exitOnRegression: false,
};

/**
 * 解析 CLI 参数（仅支持 --key=value 与 --flag 两种简单形式）
 */
function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (const arg of argv.slice(2)) {
    if (arg === '--exit-on-regression') {
      out.exitOnRegression = true;
      continue;
    }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'baseline' || key === 'max-new-errors') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`Invalid number for --${key}: ${value}`);
      }
      out[key === 'baseline' ? 'baseline' : 'maxNewErrors'] = n;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 解析 vue-tsc / tsc 输出中的错误行
 * 匹配形式：
 *   path/to/file.ts(line,col): error TSxxxx: message
 *   path/to/file.vue(line,col): error TSxxxx: message
 * 兼容：
 *   - 含项目根前缀（pnpm exec 输出会带 apps/web-antd/...）
 *   - 含 ANSI 色码（CI runner 偶发）
 */
function parseTypecheckErrors(text) {
  const errors = [];
  // eslint-disable-next-line no-control-regex
  const ANSI_RE = /\x1b\[[0-9;]*m/g;
  // 兼容：
  //   - turbo/pnpm 前缀（@vben/web-antd:typecheck: <line> 或 vue-tsc 直接输出）
  //   - ./ 前缀、绝对路径、项目根相对路径
  //   - 行末多空格
  // 注：前缀正则采用非贪婪的 `.*?: `，允许 turbo / pnpm 任意命名空间 + ":" + 空格；
  // 这样 vue-tsc 直跑（无前缀）和 turbo 包跑（含 @pkg:typecheck: 前缀）两种输出都能命中。
  const LINE_RE =
    /^(?:.*?: )?(?:\.\/)?((?:[\w.@\-/]+\/)?[\w.@\-]+\.(?:ts|tsx|vue|cts|mts))\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+?)\s*$/;

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(ANSI_RE, '');
    const m = line.match(LINE_RE);
    if (!m) continue;
    const [, file, lineNum, column, code, message] = m;
    errors.push({
      file: file.replace(/^apps\/web-antd\//, ''), // 规整到相对 web-antd
      line: Number(lineNum),
      column: Number(column),
      code,
      message,
    });
  }
  return errors;
}

function main() {
  const args = parseArgs(process.argv);
  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output);

  let text = '';
  try {
    text = readFileSync(inputPath, 'utf8');
  } catch (e) {
    console.error(`[typecheck-error-count] cannot read input: ${inputPath}`);
    console.error(`  reason: ${e.message}`);
    process.exit(2);
  }

  const errors = parseTypecheckErrors(text);
  const totalErrors = errors.length;
  const newErrorCount = Math.max(0, totalErrors - args.baseline);

  // 错误按文件归集（便于 owner 快速定位）
  const byFile = errors.reduce((acc, e) => {
    const k = e.file;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  // 新增错误的近似定义：当前总错误数超过基线。
  // 单边比较（CURRENT baseline 21 写死），不实现"按文件指纹 diff"。
  // owner 主动降基线时，需同步把 workflow 的 BASELINE 改小。
  const report = {
    generatedAt: new Date().toISOString(),
    input: args.input,
    baseline: args.baseline,
    maxNewErrors: args.maxNewErrors,
    totalErrors,
    newErrorCount,
    passed: newErrorCount <= args.maxNewErrors,
    errorsByFile: byFile,
    newErrors: newErrorCount > 0 ? errors.slice(args.baseline) : [],
    errors,
  };

  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log('--- typecheck report ---');
  console.log(`baseline        : ${report.baseline}`);
  console.log(`totalErrors     : ${report.totalErrors}`);
  console.log(`newErrorCount   : ${report.newErrorCount}`);
  console.log(`maxNewErrors    : ${report.maxNewErrors}`);
  console.log(`passed          : ${report.passed}`);
  console.log(`errorsByFile    :`);
  const sorted = Object.entries(byFile).sort((a, b) => b[1] - a[1]);
  for (const [file, count] of sorted) {
    console.log(`  ${String(count).padStart(3)}  ${file}`);
  }
  console.log(`report written  : ${outputPath}`);

  if (!report.passed) {
    console.error(
      `\n❌ typecheck regression: ${report.newErrorCount} new error(s) beyond baseline ${report.baseline}`,
    );
    if (args.exitOnRegression) {
      process.exit(1);
    }
  } else if (report.totalErrors < report.baseline) {
    console.log(
      `\n🎉 typecheck improved: ${report.totalErrors} < baseline ${report.baseline} (consider lowering BASELINE in workflow env)`,
    );
  } else {
    console.log(
      `\n✅ typecheck at baseline: ${report.totalErrors} errors (no regression)`,
    );
  }
}

try {
  main();
} catch (e) {
  console.error(`[typecheck-error-count] fatal: ${e.message}`);
  process.exit(2);
}
