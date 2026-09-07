import type { Router } from 'vue-router';

/**
 * V12-F4/F5/F6 无障碍自动化验收（零新依赖）。
 *
 * <p>三层断言：
 * <ol>
 *   <li>F4 静态扫描（沿用 ipd-theme.test.ts 惯例）：关键交互 ARIA 语义齐全 ——
 *       skip-link 目标、侧栏 aria-current、折叠钮 aria-expanded、弹窗 role="dialog"/aria-modal、
 *       关闭钮与纯图标钮可读名称、三态 Alert role="alert"、无权页 aria-live、占位卡 role="status"；
 *   <li>F5 样式存在性：ipd-a11y.css 含 skip-link 聚焦呈现 + prefers-reduced-motion 降级，
 *       且被 layouts/ipd.vue 引入（未引入 = 样式不生效）；
 *   <li>F6 挂载断言：三态/无权/占位组件真实渲染后 role / aria-live 属性穿透到 DOM。
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

import BackendPending from './backend-pending.vue';
import NoAccess from './no-access.vue';
import ThreeState from './three-state.vue';

const layoutSrc = readFileSync(
  resolve(__dirname, '../../../layouts/ipd.vue'),
  'utf8',
);
const a11yCss = readFileSync(resolve(__dirname, 'ipd-a11y.css'), 'utf8');
const threeStateSrc = readFileSync(
  resolve(__dirname, 'three-state.vue'),
  'utf8',
);
const noAccessSrc = readFileSync(resolve(__dirname, 'no-access.vue'), 'utf8');
const backendPendingSrc = readFileSync(
  resolve(__dirname, 'backend-pending.vue'),
  'utf8',
);

/** 提取 SFC 模板段（避免扫到 script 注释里的示例标记）。 */
function templateSection(src: string): string {
  const start = src.indexOf('<template>');
  const end = src.lastIndexOf('</template>');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, end);
}

describe('f4 — ipd.vue 关键 ARIA（静态扫描）', () => {
  it('skip-link 存在且 href 指向主内容锚点 #main，文案为「跳到主内容」', () => {
    expect(layoutSrc).toMatch(
      /<a class="ipd-skip-link" href="#main">跳到主内容<\/a>/,
    );
  });

  it('主内容区带 #main 锚点与 tabindex="-1"（skip-link 命中后可编程式聚焦）', () => {
    expect(layoutSrc).toMatch(
      /<main id="main" class="main-area" tabindex="-1">/,
    );
  });

  it('侧栏当前路由项带 aria-current="page"', () => {
    expect(templateSection(layoutSrc)).toMatch(
      /:aria-current="isActive\(item\.path\) \? 'page' : undefined"/,
    );
  });

  it('侧栏折叠钮带 aria-expanded / aria-controls / 可读 aria-label', () => {
    // 两种等价写法皆可：Vue 3 对 aria-* 布尔绑定恒渲染 "true"/"false" 字符串
    expect(templateSection(layoutSrc)).toMatch(
      /:aria-expanded="(String\(!collapsed\)|!collapsed)"/,
    );
    expect(templateSection(layoutSrc)).toMatch(
      /aria-controls="ipd-sidebar-nav"/,
    );
    expect(templateSection(layoutSrc)).toMatch(
      /:aria-label="collapsed \? '展开侧栏' : '收起侧栏'"/,
    );
  });

  it('三个弹窗容器带 role="dialog" + aria-modal + aria-label', () => {
    const tpl = templateSection(layoutSrc);
    expect(tpl.match(/role="dialog"/g)?.length).toBe(3);
    expect(tpl.match(/aria-modal="true"/g)?.length).toBe(3);
    for (const label of ['当前页面帮助', '全局搜索', '站内通知']) {
      expect(tpl).toMatch(
        new RegExp(`aria-label="${label}"[^>]*role="dialog"`),
      );
    }
  });

  it('所有纯图标 button 必须有可读名称（aria-label）', () => {
    const tpl = templateSection(layoutSrc);
    // 逐段切割替代双惰性组匹配，规避多项式回溯（regexp/no-super-linear-backtracking）
    const buttons = tpl
      .split(/<button\b/)
      .slice(1)
      .map((chunk) => {
        const close = chunk.indexOf('</button>');
        const body = close === -1 ? chunk : chunk.slice(0, close);
        const gt = body.indexOf('>');
        return { attrs: body.slice(0, gt), inner: body.slice(gt + 1) };
      });
    // 顶栏 4 图标钮 + 3 弹窗关闭钮 + 折叠钮 + 2 悬浮入口，至少 10 个
    expect(buttons.length).toBeGreaterThanOrEqual(10);
    const unnamed: string[] = [];
    for (const { attrs, inner } of buttons) {
      const text = inner.replaceAll(/<[^>]+>/g, '').trim();
      if (text === '' && !/aria-label=/.test(attrs)) unnamed.push(attrs.trim());
    }
    expect(unnamed).toEqual([]);
  });

  it('弹窗关闭钮 aria-label="关闭" ×3', () => {
    expect(templateSection(layoutSrc).match(/aria-label="关闭"/g)?.length).toBe(
      3,
    );
  });

  it('两个悬浮入口（AI 管理平台 / AI 副驾）带可读 aria-label', () => {
    expect(layoutSrc).toMatch(/aria-label="切换到 AI 管理平台"/);
    expect(layoutSrc).toMatch(/aria-label="打开 AI 副驾"/);
  });
});

describe('f4 — 共享组件 ARIA（静态扫描）', () => {
  it('three-state.vue：错误 Alert 带 role="alert"，加载态带 role="status"', () => {
    expect(threeStateSrc).toMatch(/role="alert"\n {6}show-icon/);
    expect(threeStateSrc).toMatch(/class="ipd-loading"\n {6}role="status"/);
  });

  it('no-access.vue：结果区带 aria-live="polite"', () => {
    expect(noAccessSrc).toMatch(/aria-live="polite"/);
  });

  it('backend-pending.vue：占位卡带 role="status"', () => {
    expect(backendPendingSrc).toMatch(/role="status"/);
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

  it('three-state 错误态渲染 role="alert"，重试钮真实渲染且可触发（prop/插槽双供修复回归）', async () => {
    let clicked = false;
    const wrapper = mount(ThreeState, {
      props: {
        error: new Error('boom'),
        retry: () => {
          clicked = true;
        },
      },
    });
    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('加载失败');
    // 回归锁定：:description prop 已删，#description 插槽（含「重新加载」钮）真实渲染
    const retryBtn = alert.find('button');
    expect(retryBtn.exists()).toBe(true);
    expect(retryBtn.text()).toContain('重新加载');
    await retryBtn.trigger('click');
    expect(clicked).toBe(true);
    wrapper.unmount();
  });

  it('no-access 真实渲染出 aria-live="polite" 区域', async () => {
    const wrapper = await mountWithRouter(NoAccess);
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('当前账号无权访问该页面');
    wrapper.unmount();
  });

  it('backend-pending 真实渲染出 role="status" 占位卡', async () => {
    const wrapper = await mountWithRouter(BackendPending);
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('后端接口尚未交付');
    wrapper.unmount();
  });
});
