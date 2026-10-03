import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./typecheck-error-count.mjs', import.meta.url);
const cleanLog = '> @vben/web-antd typecheck\n> vue-tsc --noEmit --skipLibCheck\n';
function run(log, exitCode = 0, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'ipd-typecheck-gate-'));
  try {
    const input = join(dir, 'input.log'); const output = join(dir, 'report.json');
    writeFileSync(input, log);
    const result = spawnSync(process.execPath, [script.pathname, `--input=${input}`, `--output=${output}`, ...(exitCode === null ? [] : [`--typecheck-exit-code=${exitCode}`]), ...extra], { encoding: 'utf8' });
    let report;
    try { report = JSON.parse(readFileSync(output, 'utf8')); } catch { /* Invalid input does not produce a success report. */ }
    return { status: result.status, report, stderr: result.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('clean completed typecheck succeeds', () => {
  const result = run(cleanLog); assert.equal(result.status, 0); assert.equal(result.report.passed, true);
});
const failures = [
  ['empty log', '', 0, 'EMPTY_LOG'],
  ['whitespace log', ' \n', 0, 'EMPTY_LOG'],
  ['global TS error', 'error TS5083: Cannot read tsconfig.json.\n', 0, 'TYPECHECK_DIAGNOSTICS'],
  ['OOM despite claimed exit zero', 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n', 0, 'INCOMPLETE_OR_FAILED_EXECUTION'],
  ['process failed without diagnostics', cleanLog, 137, 'TYPECHECK_PROCESS_FAILED'],
  ['unrecognised TS diagnostic', 'src/a.ts:3: error TS2345 unexpected formatting\n', 0, 'UNPARSED_DIAGNOSTICS'],
  ['filter matches no package', 'No projects matched the filters\n', 0, 'INCOMPLETE_OR_FAILED_EXECUTION'],
  ['pnpm execution fails', 'ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL\n', 0, 'INCOMPLETE_OR_FAILED_EXECUTION'],
];
for (const [name, log, code, reason] of failures) test(name, () => {
  const result = run(log, code); assert.equal(result.status, 1); assert.equal(result.report.passed, false); assert.ok(result.report.failureReasons.includes(reason));
});
test('file diagnostics tolerate prefixes, ANSI, spaces and Unicode without losing errors', () => {
  const result = run('\u001b[31m@vben/web-antd:typecheck: apps/web-antd/src/a.vue(2,3): error TS2345: mismatch\u001b[0m\n/项目 dir/文件.ts(4,5): error TS6133: unused\n');
  assert.equal(result.status, 1); assert.equal(result.report.totalErrors, 2); assert.equal(result.report.errors[0].file, 'src/a.vue');
});
test('failure exits nonzero without the legacy optional flag', () => assert.equal(run('src/a.ts(1,1): error TS1: failed\n').status, 1));
test('real process exit code is mandatory', () => assert.equal(run(cleanLog, null).status, 2));
test('legacy 21-count allowance cannot mask replacement errors', () => assert.equal(run('src/new.ts(1,1): error TS2345: newly added\n', 0, ['--baseline=21']).status, 2));
test('nonzero new-error allowance is rejected', () => assert.equal(run(cleanLog, 0, ['--max-new-errors=1']).status, 2));
test('malformed exit code is rejected', () => assert.equal(run(cleanLog, 0, ['--typecheck-exit-code=NaN']).status, 2));
