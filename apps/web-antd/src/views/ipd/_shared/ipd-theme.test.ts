/**
 * V11 dark mode + V10 mobile breakpoint 验收测试
 *
 * <p>静态扫描 ipd-theme.css 是否含 dark + mobile 关键选择器/媒体查询；
 * 失败则阻断后续 build。CI 维度由 ipd-static-lint 接力执行。
 * V12-F1 追加焦点环 token / 全局 :focus-visible 断言。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('ipd-theme.css — dark mode + mobile breakpoint', () => {
  const css = readFileSync(resolve(__dirname, 'ipd-theme.css'), 'utf8');

  it('V11: 含 html.dark 选择器（暗色模式入口）', () => {
    expect(css).toMatch(/html\.dark\s*\{/);
  });

  it('V11: 含 8 个核心暗色 token（ipd-navy/blue/text/muted/line/surface/bg/green）', () => {
    for (const tok of [
      '--ipd-navy',
      '--ipd-blue',
      '--ipd-text',
      '--ipd-muted',
      '--ipd-line',
      '--ipd-surface',
      '--ipd-bg',
      '--ipd-green',
    ]) {
      const re = new RegExp(`html\\.dark[\\s\\S]*?${tok}\\s*:`);
      expect(css).toMatch(re);
    }
  });

  it('V10: 含 @media (max-width: 768px) 移动端断点', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)/);
  });

  it('V10: 含移动端按钮全宽 + 表头简化布局', () => {
    expect(css).toMatch(/\.ipd-page-actions/);
    expect(css).toMatch(/\.ipd-page-header/);
    expect(css).toMatch(/width:\s*100%/);
  });

  it('V12-F1: 含焦点环三 token（color/width/offset）', () => {
    for (const tok of [
      '--ipd-focus-ring-color',
      '--ipd-focus-ring-width',
      '--ipd-focus-ring-offset',
    ]) {
      expect(css).toContain(`${tok}:`);
    }
  });

  it('V12-F1: 含全局 :focus-visible 规则且引用 token（非硬编码色）', () => {
    expect(css).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*var\(--ipd-focus-ring-width\)\s+solid\s+var\(--ipd-focus-ring-color\)/,
    );
  });

  it('V12-F1: antd 按钮/输入/下拉含 token 化 focus-visible 覆盖', () => {
    expect(css).toMatch(/\.ant-btn:focus-visible/);
    expect(css).toMatch(/\.ant-input(-affix-wrapper)?:focus-visible/);
    expect(css).toMatch(/\.ant-select[^{]*:focus-visible/);
  });
});
