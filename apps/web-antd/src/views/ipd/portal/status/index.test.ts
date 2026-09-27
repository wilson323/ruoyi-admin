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
 * - R3 补登/撤回：入口可见性(canSupplement/canWithdraw) / 补登载荷逐字段 /
 *   撤回二次确认载荷 / 成功后刷新 trace / 业务码错误文案 / ≤4000/≤128 长度校验边界
 *
 * Mock 策略：用 vi.mock 在模块层替换 fetchPortalDemandByCode → 直接控制返回值/拒绝，
 * 不走 fetch 网络层（API 契约路径由 portal.test.ts 已覆盖）。保留 PORTAL_CODE_PATTERN
 * 让 onMounted 自动查询与 queryTrace 校验正常工作。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import {
  fetchPortalDemandByCode,
  supplementDemand,
  withdrawDemand,
} from '../../../../api/ipd/portal';
import StatusPage from './index.vue';

// vi.mock 工厂：保留 PORTAL_CODE_PATTERN（onMounted 自动查询 + queryTrace 校验依赖），
// 将 fetchPortalDemandByCode 替换为 vi.fn 以便按用例返回 fixture / 拒绝。
vi.mock('../../../../api/ipd/portal', () => ({
  PORTAL_CODE_PATTERN: /^[A-Z0-9]{8}$/,
  fetchPortalDemandByCode: vi.fn(),
  supplementDemand: vi.fn(),
  withdrawDemand: vi.fn(),
}));

const fetchTrace = vi.mocked(fetchPortalDemandByCode);
const supplementApi = vi.mocked(supplementDemand);
const withdrawApi = vi.mocked(withdrawDemand);

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
  supplementApi.mockReset();
  withdrawApi.mockReset();
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

describe('R3 补登/撤回入口可见性（canSupplement / canWithdraw 控制）', () => {
  const cases: Array<[boolean, boolean]> = [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ];

  for (const [canSupplement, canWithdraw] of cases) {
    it(`canSupplement=${canSupplement} / canWithdraw=${canWithdraw} -> 补登入口 ${canSupplement} / 撤回入口 ${canWithdraw}`, async () => {
      fetchTrace.mockResolvedValue(baseTrace({ canSupplement, canWithdraw, status: 'SUBMITTED' }));
      const wrapper = await mountStatus();
      await vi.waitFor(() =>
        expect(wrapper.find('[data-testid="portal-track-result"]').exists()).toBe(true),
      );
      expect(wrapper.find('[data-testid="portal-supplement-button"]').exists()).toBe(canSupplement);
      expect(wrapper.find('[data-testid="portal-withdraw-button"]').exists()).toBe(canWithdraw);
      if (!canSupplement && !canWithdraw) {
        expect(wrapper.find('[data-testid="portal-trace-actions"]').exists()).toBe(false);
      }
      wrapper.unmount();
    });
  }
});

describe('R3 补登交互（Modal 表单 → supplementDemand 载荷）', () => {
  it('补登提交载荷逐字段断言 + 成功后重新拉取 trace 刷新视图', async () => {
    supplementApi.mockResolvedValue(baseTrace({ status: 'SUBMITTED', canSupplement: true, canWithdraw: true }));
    fetchTrace
      .mockResolvedValueOnce(baseTrace({ status: 'SUBMITTED', canSupplement: true, canWithdraw: true }))
      .mockResolvedValueOnce(baseTrace({ status: 'ACCEPTED', canSupplement: false, canWithdraw: false }));
    const wrapper = await mountStatus();
    await wrapper.find('[data-testid="portal-supplement-button"]').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.querySelector('.ant-modal')).toBeTruthy();
    });
    const modal = document.body.querySelector('.ant-modal')!;
    const textarea = modal.querySelector('textarea.ant-input') as HTMLTextAreaElement;
    expect(textarea, '补登 Modal 必须有补登内容多行输入').toBeTruthy();
    textarea.value = '希望增加批量导出报表功能，支持按月筛选';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const contactInput = modal.querySelector('input.ant-input') as HTMLInputElement;
    expect(contactInput, '补登 Modal 必须有联系方式单行输入').toBeTruthy();
    contactInput.value = '13800000000';
    contactInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const okButton = [...modal.querySelectorAll('.ant-modal-footer button')]
      .find((b) => b.textContent?.includes('提交补登')) as HTMLButtonElement | undefined;
    expect(okButton, 'Modal footer 应有「提交补登」按钮').toBeDefined();
    okButton!.click();
    await vi.waitFor(() => {
      expect(supplementApi).toHaveBeenCalledTimes(1);
    });
    // 逐字段断言：第一参=trace.code，第二参仅 functionalRequirement/contact（禁自造字段）
    expect(supplementApi).toHaveBeenCalledWith('AB12CD34', {
      contact: '13800000000',
      functionalRequirement: '希望增加批量导出报表功能，支持按月筛选',
    });
    expect(Object.keys(supplementApi.mock.calls[0]![1]).sort()).toEqual([
      'contact',
      'functionalRequirement',
    ]);
    // 成功后重新拉取 trace 刷新视图（第 2 次 fetchTrace + 徽章/入口随新视图更新）
    await vi.waitFor(() => {
      expect(fetchTrace).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="portal-status-badge"]').text()).toContain('已受理');
    });
    expect(wrapper.find('[data-testid="portal-supplement-button"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('补登内容长度校验边界：4001 字被 ≤4000 规则拦截不发请求，4000 字放行', async () => {
    supplementApi.mockResolvedValue(baseTrace({ status: 'SUBMITTED', canSupplement: true }));
    fetchTrace.mockResolvedValue(baseTrace({ status: 'SUBMITTED', canSupplement: true }));
    const wrapper = await mountStatus();
    await wrapper.find('[data-testid="portal-supplement-button"]').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.querySelector('.ant-modal')).toBeTruthy();
    });
    const modal = document.body.querySelector('.ant-modal')!;
    const textarea = modal.querySelector('textarea.ant-input') as HTMLTextAreaElement;
    textarea.value = 'x'.repeat(4001);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const okButton = [...modal.querySelectorAll('.ant-modal-footer button')]
      .find((b) => b.textContent?.includes('提交补登')) as HTMLButtonElement;
    okButton.click();
    await flushPromises();
    expect(supplementApi, '4001 字必须被 ≤4000 校验拦截').not.toHaveBeenCalled();
    await vi.waitFor(() => {
      const explains = [...modal.querySelectorAll('.ant-form-item-explain')].map((el) => el.textContent ?? '');
      expect(explains, '必须展示 ≤4000 中文校验文案').toContain('补登内容不能超过 4000 字');
    });
    // 边界另一侧：恰好 4000 字放行
    textarea.value = 'x'.repeat(4000);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    okButton.click();
    await vi.waitFor(() => {
      expect(supplementApi).toHaveBeenCalledTimes(1);
    });
    expect(supplementApi.mock.calls[0]![1].functionalRequirement).toHaveLength(4000);
    wrapper.unmount();
  });

  it('联系方式长度校验边界：129 字被 ≤128 规则拦截，128 字放行', async () => {
    supplementApi.mockResolvedValue(baseTrace({ status: 'SUBMITTED', canSupplement: true }));
    fetchTrace.mockResolvedValue(baseTrace({ status: 'SUBMITTED', canSupplement: true }));
    const wrapper = await mountStatus();
    await wrapper.find('[data-testid="portal-supplement-button"]').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.querySelector('.ant-modal')).toBeTruthy();
    });
    const modal = document.body.querySelector('.ant-modal')!;
    const textarea = modal.querySelector('textarea.ant-input') as HTMLTextAreaElement;
    textarea.value = '补充需求描述';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const contactInput = modal.querySelector('input.ant-input') as HTMLInputElement;
    contactInput.value = '1'.repeat(129);
    contactInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const okButton = [...modal.querySelectorAll('.ant-modal-footer button')]
      .find((b) => b.textContent?.includes('提交补登')) as HTMLButtonElement;
    okButton.click();
    await flushPromises();
    expect(supplementApi, '129 字必须被 ≤128 校验拦截').not.toHaveBeenCalled();
    await vi.waitFor(() => {
      const explains = [...modal.querySelectorAll('.ant-form-item-explain')].map((el) => el.textContent ?? '');
      expect(explains, '必须展示 ≤128 中文校验文案').toContain('联系方式不能超过 128 字');
    });
    // 边界另一侧：恰好 128 字放行
    contactInput.value = '1'.repeat(128);
    contactInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    okButton.click();
    await vi.waitFor(() => {
      expect(supplementApi).toHaveBeenCalledTimes(1);
    });
    expect(supplementApi.mock.calls[0]![1].contact).toHaveLength(128);
    wrapper.unmount();
  });

  it('补登失败：50002 业务码文案展示，失败不刷新 trace', async () => {
    supplementApi.mockRejectedValue(new Error('当前状态不支持该操作，请稍后重试'));
    fetchTrace.mockResolvedValue(baseTrace({ status: 'SUBMITTED', canSupplement: true }));
    const wrapper = await mountStatus();
    await wrapper.find('[data-testid="portal-supplement-button"]').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.querySelector('.ant-modal')).toBeTruthy();
    });
    const modal = document.body.querySelector('.ant-modal')!;
    const textarea = modal.querySelector('textarea.ant-input') as HTMLTextAreaElement;
    textarea.value = '希望增加批量导出报表功能';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const okButton = [...modal.querySelectorAll('.ant-modal-footer button')]
      .find((b) => b.textContent?.includes('提交补登')) as HTMLButtonElement;
    okButton.click();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="portal-action-error"]').exists()).toBe(true);
    });
    expect(wrapper.find('[data-testid="portal-action-error"]').text()).toContain(
      '当前状态不支持该操作，请稍后重试',
    );
    expect(fetchTrace, '操作失败不得刷新 trace').toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('补登内容为空时「提交补登」按钮 disabled（双重保护）', async () => {
    fetchTrace.mockResolvedValue(baseTrace({ status: 'SUBMITTED', canSupplement: true }));
    const wrapper = await mountStatus();
    await wrapper.find('[data-testid="portal-supplement-button"]').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.querySelector('.ant-modal')).toBeTruthy();
    });
    const modal = document.body.querySelector('.ant-modal')!;
    const okButton = [...modal.querySelectorAll('.ant-modal-footer button')]
      .find((b) => b.textContent?.includes('提交补登')) as HTMLButtonElement;
    expect(okButton).toBeDefined();
    // AntDV Modal 的 disabled 通过原生 disabled 属性表达
    expect(okButton!.hasAttribute('disabled'), '内容为空时按钮必须 disabled').toBe(true);
    expect(supplementApi).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe('R3 撤回交互（二次确认 → withdrawDemand 载荷）', () => {
  it('撤回需二次确认，确认后以 trace.code 提交，成功后刷新 trace 并隐藏入口', async () => {
    withdrawApi.mockResolvedValue(baseTrace({ status: 'WITHDRAWN', canSupplement: false, canWithdraw: false }));
    fetchTrace
      .mockResolvedValueOnce(baseTrace({ status: 'SUBMITTED', canSupplement: true, canWithdraw: true }))
      .mockResolvedValueOnce(baseTrace({ status: 'WITHDRAWN', canSupplement: false, canWithdraw: false }));
    const wrapper = await mountStatus();
    await wrapper.find('[data-testid="portal-withdraw-button"]').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.querySelector('.ant-modal')).toBeTruthy();
    });
    const modal = document.body.querySelector('.ant-modal')!;
    expect(modal.textContent ?? '').toContain('撤回后该需求将关闭且不可恢复');
    expect(withdrawApi, '二次确认前不得提交').not.toHaveBeenCalled();
    const okButton = [...modal.querySelectorAll('.ant-modal-footer button')]
      .find((b) => b.textContent?.includes('确认撤回')) as HTMLButtonElement | undefined;
    expect(okButton, 'Modal footer 应有「确认撤回」按钮').toBeDefined();
    okButton!.click();
    await vi.waitFor(() => {
      expect(withdrawApi).toHaveBeenCalledTimes(1);
    });
    expect(withdrawApi).toHaveBeenCalledWith('AB12CD34');
    // 成功后重新拉取 trace 刷新视图
    await vi.waitFor(() => {
      expect(fetchTrace).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="portal-status-badge"]').text()).toContain('已撤回');
    });
    expect(wrapper.find('[data-testid="portal-withdraw-button"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('撤回失败：50001 业务码文案展示，失败不刷新 trace', async () => {
    withdrawApi.mockRejectedValue(new Error('未查询到对应的需求，请核对查询码'));
    fetchTrace.mockResolvedValue(baseTrace({ status: 'SUBMITTED', canWithdraw: true }));
    const wrapper = await mountStatus();
    await wrapper.find('[data-testid="portal-withdraw-button"]').trigger('click');
    await vi.waitFor(() => {
      expect(document.body.querySelector('.ant-modal')).toBeTruthy();
    });
    const modal = document.body.querySelector('.ant-modal')!;
    const okButton = [...modal.querySelectorAll('.ant-modal-footer button')]
      .find((b) => b.textContent?.includes('确认撤回')) as HTMLButtonElement;
    okButton.click();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="portal-action-error"]').exists()).toBe(true);
    });
    expect(wrapper.find('[data-testid="portal-action-error"]').text()).toContain(
      '未查询到对应的需求，请核对查询码',
    );
    expect(fetchTrace, '操作失败不得刷新 trace').toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
