/**
 * V12-F3 断点归一强制测试
 *
 * 静态扫描 views/ipd/** 全部 .vue / .css 中的媒体查询断点：
 * 只允许唯一断点常量体系（768 移动 / 1024 平板，见 ipd-breakpoints.ts）。
 * 出现 768/1024 之外的 max-width 字面量即失败——防止散落断点回潮
 * （V12 走查：历史散落 760/900/960/1000/1050/1100 共 7 个值）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  IPD_ALLOWED_BREAKPOINTS,
  IPD_BREAKPOINT_MOBILE,
  IPD_BREAKPOINT_TABLET,
} from './ipd-breakpoints';

const VIEWS_DIR = resolve(__dirname, '..');

function collectStyleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectStyleFiles(full));
    } else if (/\.(?:vue|css)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('V12-F3: ipd 视图层媒体查询断点唯一性', () => {
  const files = collectStyleFiles(VIEWS_DIR);

  it('扫描到足量样式文件（防路径漂移空转）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('全部 max-width 断点 ∈ {768, 1024}', () => {
    const offenders: string[] = [];
    const re = /@media[^{]*?max-width:\s*(\d+)px/g;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(re)) {
        const value = Number(m[1]);
        if (!IPD_ALLOWED_BREAKPOINTS.includes(value)) {
          offenders.push(`${file.replace(`${VIEWS_DIR}/`, '')}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('共享主题层含 768px 移动断点（V10 基线不回退）', () => {
    const css = readFileSync(resolve(__dirname, 'ipd-theme.css'), 'utf8');
    expect(css).toMatch(
      new RegExp(`@media\\s*\\(max-width:\\s*${IPD_BREAKPOINT_MOBILE}px\\)`),
    );
  });

  it('常量文件允许集与两档常量一致（防常量文件自身漂移）', () => {
    expect(IPD_ALLOWED_BREAKPOINTS).toEqual([
      IPD_BREAKPOINT_MOBILE,
      IPD_BREAKPOINT_TABLET,
    ]);
  });
});
