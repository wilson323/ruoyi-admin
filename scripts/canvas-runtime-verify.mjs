#!/usr/bin/env node
/**
 * canvas-runtime-verify.mjs — 画布 .canvas.tsx 运行时验证器（防复发工具）
 *
 * 背景（2026-10-07 实战）：ipd-execution-plan.canvas.tsx 报
 *   `ReferenceError: sources is not defined`。
 * 根因：JSX 文本里写了 `{sources-repair.sha256,compile-final.log,...}`——
 * 花括号在 JSX 中即表达式容器，内容被当 JS/序列表达式求值（sources - repair.sha256...），
 * 语法通过、编译通过，但运行时必然 ReferenceError。TS 语法解析查不出这类问题。
 *
 * 本脚本做「转译 + mock 渲染执行」：
 *   1) tsc 转译 TSX → CommonJS（React.createElement 模式）
 *   2) mock 掉 `cursor/canvas`（万能 Proxy）、`react`、`react/jsx-runtime`
 *   3) 实际调用默认导出组件函数 —— 触发组件树中所有表达式求值
 * 任何「引用不存在的标识符 / 其它运行时异常」都会被当场抓到。
 *
 * 用法:
 *   node scripts/canvas-runtime-verify.mjs                # 扫描默认画布目录
 *   node scripts/canvas-runtime-verify.mjs <file...>      # 指定文件
 *   CANVAS_DIR=<dir> node scripts/canvas-runtime-verify.mjs
 *
 * 退出码: 0 全部通过；1 有失败；2 环境错（typescript 不可用等）。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require('typescript');
} catch {
  console.error('[canvas-verify] 环境错: 未找到 typescript（请在 ruoyi-ipd-web 仓根运行）');
  process.exit(2);
}

const DEFAULT_DIR =
  process.env.CANVAS_DIR ||
  '/Users/mac/.cursor/projects/Users-mac-Documents-ruoyi-ipd-web/canvases';

function listTargets(argv) {
  if (argv.length > 0) return argv;
  if (!fs.existsSync(DEFAULT_DIR)) {
    console.error(`[canvas-verify] 环境错: 画布目录不存在: ${DEFAULT_DIR}`);
    process.exit(2);
  }
  return fs
    .readdirSync(DEFAULT_DIR)
    .filter((n) => n.endsWith('.canvas.tsx'))
    .map((n) => path.join(DEFAULT_DIR, n));
}

function verifyOne(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2019,
      module: ts.ModuleKind.CommonJS,
    },
    reportDiagnostics: true,
  });
  if (out.diagnostics && out.diagnostics.length) {
    const msg = out.diagnostics
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
      .join('; ');
    throw new Error(`TS 转译诊断: ${msg}`);
  }
  let code = out.outputText;

  // 万能对象：任意属性访问、调用、数组解构（迭代）都安全——用于 mock 组件与 hooks
  const makeAny = () =>
    new Proxy(function () {}, {
      get: (t, k) =>
        k === Symbol.iterator ? () => [][Symbol.iterator]() : k === 'then' ? undefined : makeAny(),
      apply: () => makeAny(),
      construct: () => makeAny(),
    });
  const stub = () => makeAny();
  const canvasMock = new Proxy({}, { get: () => stub });

  const expObj = {};
  const sandbox = {
    React: { createElement: (...args) => ({ el: args }) },
    console,
    exports: expObj,
    module: { exports: expObj },
    require: (name) => {
      if (name === 'cursor/canvas') return canvasMock;
      if (name === 'react/jsx-runtime') return { jsx: stub, jsxs: stub, Fragment: stub };
      if (name === 'react') return { createElement: (...args) => ({ el: args }) };
      throw new Error(`unknown module: ${name}`);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: path.basename(file) });
  const fn = expObj.default;
  if (typeof fn !== 'function') throw new Error('未捕获到默认导出组件函数');
  fn(); // 触发全部表达式求值
}

const targets = listTargets(process.argv.slice(2));
let failed = 0;
for (const f of targets) {
  const name = path.basename(f);
  try {
    verifyOne(f);
    console.log(`[canvas-verify] OK   ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`[canvas-verify] FAIL ${name} — ${e.message}`);
    if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  }
}
console.log(
  `[canvas-verify] 汇总: ${targets.length - failed}/${targets.length} 通过` +
    (failed ? '（有失败，禁止视为画布可用）' : ''),
);
process.exit(failed ? 1 : 0);
