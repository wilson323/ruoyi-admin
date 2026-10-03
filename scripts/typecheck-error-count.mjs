#!/usr/bin/env node
// 工程门禁：真实进程退出码、完整日志和诊断必须同时通过。
// 当前 workflow 基线已为 0；历史数量 21 不再作为可接受错误集合。
// 用法：node scripts/typecheck-error-count.mjs --input=log.txt \
//   --typecheck-exit-code=0 --output=typecheck-report.json
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const args = { input: '/tmp/typecheck-output.txt', output: 'typecheck-report.json', baseline: 0, 'max-new-errors': 0 };
  const allowed = new Set(['input', 'output', 'baseline', 'max-new-errors', 'typecheck-exit-code']);
  for (const arg of argv) {
    if (arg === '--exit-on-regression') continue; // 兼容旧入口；失败始终退出非零。
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (!match || !allowed.has(match[1])) throw new Error(`Unknown or empty argument: ${arg}`);
    args[match[1]] = match[2];
  }
  for (const key of ['baseline', 'max-new-errors', 'typecheck-exit-code']) {
    if (!/^\d+$/.test(String(args[key]))) throw new Error(`Required nonnegative integer: --${key}`);
    args[key] = Number(args[key]);
    if (!Number.isSafeInteger(args[key])) throw new Error(`Invalid integer: --${key}`);
  }
  if (args.baseline !== 0 || args['max-new-errors'] !== 0) {
    throw new Error('Numeric error allowances are unsupported: a count cannot identify known diagnostics. Current baseline is 0.');
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = readFileSync(resolve(args.input), 'utf8').replace(/\u001b\[[0-9;]*m/g, '');
  const errors = [];
  const unparsedDiagnostics = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // Accept spaces, Unicode and absolute paths, as well as turbo package prefixes.
    const file = line.match(/^(?:.*?: )?(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.*)$/);
    const global = line.match(/^(?:.*?: )?error\s+(TS\d+):\s*(.*)$/);
    if (file) {
      errors.push({ file: file[1].replace(/^\.\//, '').replace(/^apps\/web-antd\//, ''), line: Number(file[2]), column: Number(file[3]), code: file[4], message: file[5] });
    } else if (global) {
      errors.push({ file: null, code: global[1], message: global[2] });
    } else if (/\berror\s+TS\d+\b/i.test(line)) {
      unparsedDiagnostics.push(line);
    }
  }
  const failureReasons = [];
  if (!text.trim()) failureReasons.push('EMPTY_LOG');
  if (args['typecheck-exit-code'] !== 0) failureReasons.push('TYPECHECK_PROCESS_FAILED');
  if (errors.length) failureReasons.push('TYPECHECK_DIAGNOSTICS');
  if (unparsedDiagnostics.length) failureReasons.push('UNPARSED_DIAGNOSTICS');
  if (/FATAL ERROR|heap out of memory|allocation failed|JavaScript heap|SIGABRT|SIGKILL|Killed|Segmentation fault|ERR_PNPM|ELIFECYCLE|command not found|No projects matched|No projects found/i.test(text)) {
    failureReasons.push('INCOMPLETE_OR_FAILED_EXECUTION');
  }
  const report = {
    generatedAt: new Date().toISOString(), input: args.input,
    typecheckExitCode: args['typecheck-exit-code'], baseline: 0, maxNewErrors: 0,
    totalErrors: errors.length, newErrorCount: errors.length, passed: failureReasons.length === 0,
    failureReasons, errorsByFile: errors.reduce((acc, error) => {
      const key = error.file ?? '<global>'; acc[key] = (acc[key] ?? 0) + 1; return acc;
    }, {}), newErrors: errors, errors, unparsedDiagnostics,
  };
  writeFileSync(resolve(args.output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[typecheck-error-count] passed=${report.passed} errors=${errors.length} processExit=${report.typecheckExitCode}`);
  if (!report.passed) console.error(report.failureReasons.join(', '));
  process.exitCode = report.passed ? 0 : 1;
}
try { main(); } catch (error) {
  console.error(`[typecheck-error-count] fatal: ${error.message}`);
  process.exitCode = 2;
}
