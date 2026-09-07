/**
 * 页39 需求门户-查询进度：STATUS_TEXT 8 态 + badge kind 映射 + 五态覆盖。
 *
 * 组件层单测（与 portal.test.ts 的 API/网络层测试互斥）：
 * - 8 态 STATUS_TEXT：SUBMITTED / ACCEPTED / EVALUATING / SCHEDULED / PROCESSING /
 *   CLOSED / ARCHIVED / WITHDRAWN 各自渲染对应中文 + 正确 badge kind
 * - 未知 status：显式「待补充」（G-06 禁止空白）+ badge=default
 * - badgeKind 映射：WITHDRAWN→warning；CLOSED/ARCHIVED→default；
 *   SUBMITTED/ACCEPTED/EVALUATING/SCHEDULED/PROCESSING→processing
 * - 五态：成功 / 拒绝(码错误/限流) / 未查询引导 / 加载 / 断网
 *
 * Mock 策略：用 vi.mock 在模块层替换 fetchPortalDemandByCode → 直接控制返回值/拒绝，
 * 不走 fetch 网络层（API 契约路径由 portal.test.ts 已覆盖）。保留 PORTAL_CODE_PATTERN
 * 让 onMounted 自动查询与 queryTrace 校验正常工作。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import { fetchPortalDemandByCode } from '../../../../api/ipd/portal';
import StatusPage from './index.vue';

// vi.mock 工厂：保留 PORTAL_CODE_PATTERN（onMounted 自动查询 + queryTrace 校验依赖），
// 将 fetchPortalDemandByCode 替换为 vi.fn 以便按用例返回 fixture / 拒绝。
vi.mock('../../../../api/ipd/portal', () => ({
  PORTAL_CODE_PATTERN: /^[A-Z0-9]{8}$/,
  fetchPortalDemandByCode: vi.fn(),
}));

const fetchTrace = vi.mocked(fetchPortalDemandByCode);

interface FixtureTimelineEntry {
  memo?: string;
  occurredAt?: string;
  stage: string;
}
interface FixtureAttachment {
  fileName: string;
  fileSize: null | number | string;
}
interface FixtureOverrides {
  attachments?: FixtureAttachment[];
  canSupplement?: boolean;
  canWithdraw?: boolean;
  code?: string;
  customerName?: string;
  status?: string;
  timeline?: FixtureTimelineEntry[];
  withdrawDeadlineAt?: null | string;
}

const baseTrace = (overrides: FixtureOverrides = {}) => ({
  attachments: [],
  canSupplement: false,
  canWithdraw: false,
  code: 'AB12CD34',
  customerName: '某某**公司',
  status: 'ACCEPTED',
  timeline: [
    { stage: 'SUBMITTED', occurredAt: '2026-09-05T02:00:00Z' },
    { stage: 'ACCEPTED', occurredAt: '2026-09-05T03:00:00Z' },
  ],
  withdrawDeadlineAt: null,
  ...overrides,
});

let router: Router;

async function mountStatus(routePath = '/portal/track?code=AB12CD34') {
  const pinia = createPinia();
  setActivePinia(pinia);
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/portal/track', component: StatusPage }],
  });
  await router.push(routePath);
  await router.isReady();
  const wrapper = mount(StatusPage, {
    global: { plugins: [pinia, router] },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  fetchTrace.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('STATUS_TEXT 8 态 badge 渲染', () => {
  const cases: Array<[string, string, 'default' | 'processing' | 'warning']> = [
    ['SUBMITTED', '已提交待受理', 'processing'],
    ['ACCEPTED', '已受理', 'processing'],
    ['EVALUATING', '评估中', 'processing'],
    ['SCHEDULED', '已排期', 'processing'],
    ['PROCESSING', '处理中', 'processing'],
    ['CLOSED', '已关闭', 'default'],
    ['ARCHIVED', '已归档', 'default'],
    ['WITHDRAWN', '已撤回', 'warning'],
  ];

  for (const [status, expectedText, expectedKind] of cases) {
    it(`${status} -> "${expectedText}" + badge=${expectedKind}`, async () => {
      fetchTrace.mockResolvedValue(baseTrace({ status }));
      const wrapper = await mountStatus();
      await vi.waitFor(() => {
        const badge = wrapper.find('[data-testid="portal-status-badge"]');
        expect(badge.exists()).toBe(true);
      });
      const badge = wrapper.find('[data-testid="portal-status-badge"]');
      // 文本断言：data-testid 包裹 status-text span
      expect(badge.text(), `${status} 必须显示中文「${expectedText}」`).toContain(expectedText);
      // 颜色断言：antdv 把具体 kind 放在内层 .ant-badge-status-dot 上（非 root）
      const dot = badge.find('.ant-badge-status-dot');
      expect(dot.exists(), `${status} 必须渲染 status dot`).toBe(true);
      expect(dot.classes(), `${status} 的 badge kind 必须为 ${expectedKind}`).toContain(
        `ant-badge-status-${expectedKind}`,
      );
      wrapper.unmount();
    });
  }
});

describe('未知 status 值（G-06 显式「待补充」+ badge=default）', () => {
  it('未知 status 渲染「待补充」+ ant-badge-status-default', async () => {
    fetchTrace.mockResolvedValue(baseTrace({ status: 'UNKNOWN_STATE_X' }));
    const wrapper = await mountStatus();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="portal-status-badge"]').exists()).toBe(true);
    });
    const badge = wrapper.find('[data-testid="portal-status-badge"]');
    expect(badge.text()).toContain('待补充');
    // 默认 badge kind 同样落在内层 dot 上
    const dot = badge.find('.ant-badge-status-dot');
    expect(dot.exists(), '未知 status 也必须渲染 status dot').toBe(true);
    expect(dot.classes()).toContain('ant-badge-status-default');
    wrapper.unmount();
  });

  it('时间线条目未知 stage 同样渲染「待补充」', async () => {
    fetchTrace.mockResolvedValue(
      baseTrace({
        status: 'SUBMITTED',
        timeline: [{ stage: 'UNKNOWN_STAGE', occurredAt: '2026-09-05T02:00:00Z' }],
      }),
    );
    const wrapper = await mountStatus();
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="portal-timeline"]').exists()).toBe(true),
    );
    expect(wrapper.find('[data-testid="portal-timeline"]').text()).toContain('待补充');
    wrapper.unmount();
  });
});

describe('五态覆盖', () => {
  it('成功：徽章 + 时间线 + 客户名(脱敏) + 附件清单', async () => {
    fetchTrace.mockResolvedValue(
      baseTrace({
        attachments: [{ fileName: 'specs.pdf', fileSize: '1.2MB' }],
        customerName: '某某**公司',
      }),
    );
    const wrapper = await mountStatus();
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="portal-track-result"]').exists()).toBe(true),
    );
    expect(wrapper.find('[data-testid="portal-track-customer"]').text()).toBe('某某**公司');
    expect(wrapper.find('[data-testid="portal-track-code"]').text()).toBe('AB12CD34');
    expect(wrapper.findAll('.ant-timeline-item')).toHaveLength(2);
    expect(wrapper.find('[data-testid="portal-attachments"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('specs.pdf');
    wrapper.unmount();
  });

  it('拒绝：码不存在（50001 业务码）→ 中文业务文案', async () => {
    fetchTrace.mockRejectedValue(new Error('未查询到对应的需求，请核对查询码'));
    const wrapper = await mountStatus('/portal/track?code=ZZZZZZZZ');
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="portal-track-error"]').text()).toContain(
        '未查询到对应的需求',
      );
    });
    expect(wrapper.find('[data-testid="portal-track-result"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('拒绝：限流（40011）→ 限流文案', async () => {
    fetchTrace.mockRejectedValue(new Error('请求过于频繁，请稍后再试'));
    const wrapper = await mountStatus();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="portal-track-error"]').text()).toContain(
        '请求过于频繁',
      );
    });
    expect(wrapper.find('[data-testid="portal-track-result"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('空态：未查询时显示引导，不展示任何模拟数据', async () => {
    const wrapper = await mountStatus('/portal/track');
    expect(wrapper.find('[data-testid="portal-track-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('输入查询码后点击');
    expect(wrapper.find('[data-testid="portal-track-result"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="portal-track-error"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('空态：时间线为空显示「暂无处理记录」', async () => {
    fetchTrace.mockResolvedValue(baseTrace({ status: 'SUBMITTED', timeline: [] }));
    const wrapper = await mountStatus();
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="portal-track-result"]').exists()).toBe(true),
    );
    expect(wrapper.find('[data-testid="portal-timeline-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('暂无处理记录');
    wrapper.unmount();
  });

  it('加载：querying 时显示 Spin', async () => {
    // mock 永不解析 -> querying 态保持 -> Spin 应可见
    fetchTrace.mockImplementation(() => new Promise(() => {}));
    const wrapper = await mountStatus('/portal/track');
    const input = wrapper.find('input[placeholder="如 AB12CD34"]');
    await input.setValue('AB12CD34');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[data-testid="portal-track-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="portal-track-result"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('断网：fetch 失败 -> 断网文案，进度面板不出现', async () => {
    fetchTrace.mockRejectedValue(new Error('无法连接服务，请检查网络后重试'));
    const wrapper = await mountStatus();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="portal-track-error"]').text()).toContain(
        '无法连接服务',
      );
    });
    expect(wrapper.find('[data-testid="portal-track-result"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
