import type { Router } from 'vue-router';

/**
 * V12-F4/F5/F6 无障碍自动化验收（零新依赖）。
 *
 * <p>三层断言：
 * <ol>
 *   <li>F4 静态扫描（沿用 ipd-theme.test.ts 惯例）：关键交互 ARIA 语义齐全 ——
 *       IPD 阶段轨道 data-testid、全局项目选择器可读 label、旧自绘壳特征已清除
 *       （2026-09-11 菜单/UI 统一后顶栏/侧栏/菜单由 vben BasicLayout 承担）、
 *       无权页 aria-live；
 *   <li>F5 样式存在性：ipd-a11y.css 含 skip-link 聚焦呈现 + prefers-reduced-motion 降级，
 *       且被 layouts/ipd.vue 引入（未引入 = 样式不生效）；
 *   <li>F6 挂载断言：无权页真实渲染后 aria-live 属性穿透到 DOM。
 * </ol>
 *
 * <p>环境沿用 vitest.ipd.config.mts 的 happy-dom（零新依赖，不引入 vitest-axe）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it } from 'vitest';

import NoAccess from './no-access.vue';

const layoutSrc = readFileSync(
  resolve(__dirname, '../../../layouts/ipd.vue'),
  'utf8',
);
const a11yCss = readFileSync(resolve(__dirname, 'ipd-a11y.css'), 'utf8');
const noAccessSrc = readFileSync(resolve(__dirname, 'no-access.vue'), 'utf8');

/** 提取 SFC 模板段（避免扫到 script 注释里的示例标记）。 */
function templateSection(src: string): string {
  const start = src.indexOf('<template>');
  const end = src.lastIndexOf('</template>');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, end);
}

describe('f4 — ipd.vue 关键 ARIA（静态扫描）', () => {
  it('阶段轨道带 data-testid="ipd-stage-rail"，六阶段节点按 stages 渲染', () => {
    expect(layoutSrc).toMatch(/data-testid="ipd-stage-rail"/);
    expect(templateSection(layoutSrc)).toMatch(
      /v-for="\(stage, index\) in stages"/,
    );
  });

  it('全局项目选择器由 label 包裹（可读名称），带 data-testid', () => {
    expect(layoutSrc).toMatch(/data-testid="ipd-project-select"/);
    expect(templateSection(layoutSrc)).toMatch(/<label class="rail-project">/);
  });

  it('页面内容经 router-view 渲染（壳由 vben BasicLayout 承担）', () => {
    expect(templateSection(layoutSrc)).toMatch(/<router-view \/>/);
  });

  it('旧自绘壳特征已清除（侧栏导航 / 双悬浮入口 / 三弹窗 / skip-link）', () => {
    expect(layoutSrc).not.toMatch(/id="ipd-sidebar-nav"/);
    expect(layoutSrc).not.toMatch(/ipd-platform-switch/);
    expect(layoutSrc).not.toMatch(/ipd-ai-entry/);
    expect(layoutSrc).not.toMatch(/aria-label="切换到 AI 管理平台"/);
    expect(layoutSrc).not.toMatch(/aria-label="打开 AI 副驾"/);
    expect(layoutSrc).not.toMatch(/role="dialog"/);
    expect(layoutSrc).not.toMatch(/ipd-skip-link/);
  });
});

describe('f4 — 共享组件 ARIA（静态扫描）', () => {
  it('no-access.vue：结果区带 aria-live="polite"', () => {
    expect(noAccessSrc).toMatch(/aria-live="polite"/);
  });
});

describe('f5 — skip-link + prefers-reduced-motion 样式', () => {
  it('ipd-a11y.css 含 skip-link 聚焦呈现规则（聚焦时滑入视口 + 可见焦点环）', () => {
    expect(a11yCss).toMatch(/\.ipd-app \.ipd-skip-link/);
    expect(a11yCss).toMatch(/\.ipd-skip-link:focus[^{]*\{[^}]*top:\s*0/);
    expect(a11yCss).toMatch(/outline:\s*2px solid var\(--ipd-blue/);
  });

  it('ipd-a11y.css 含 @media (prefers-reduced-motion: reduce) 全局动效降级', () => {
    expect(a11yCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(a11yCss).toMatch(/animation-duration:\s*0\.01ms/);
    expect(a11yCss).toMatch(/transition-duration:\s*0\.01ms/);
    expect(a11yCss).toMatch(/scroll-behavior:\s*auto/);
  });

  it('layouts/ipd.vue 实际引入 ipd-a11y.css（否则样式不生效）', () => {
    expect(layoutSrc).toMatch(
      /import '\.\.\/views\/ipd\/_shared\/ipd-a11y\.css';/,
    );
  });
});

describe('f6 — 共享组件 ARIA 挂载断言（happy-dom 真实渲染）', () => {
  async function mountWithRouter(component: unknown) {
    const router: Router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
      ],
    });
    await router.push('/');
    await router.isReady();
    setActivePinia(createPinia());
    return mount(component, { global: { plugins: [router] } });
  }

  it('no-access 真实渲染出 aria-live="polite" 区域', async () => {
    const wrapper = await mountWithRouter(NoAccess);
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('当前账号无权访问该页面');
    wrapper.unmount();
  });
});
