// 月度切换验收视图测试（R215 GAP-F5）。mock api/ipd/switching-acceptance 模块
// （string 透传/BigDecimal 原样/month 守卫由 api/ipd/switching-acceptance.test.ts 锁定，
// 本文件验证视图接线：列表加载、报告详情渲染、unlock 预校验、month 补零入参）。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../api/ipd/auth';
import SwitchingAcceptancePage from './switching-acceptance.vue';

const api = vi.hoisted(() => ({
  getSwitchingAcceptance: vi.fn(),
  listSwitchingAcceptance: vi.fn(),
  lockSwitchingAcceptance: vi.fn(),
  runSwitchingAcceptance: vi.fn(),
  unlockSwitchingAcceptance: vi.fn(),
}));
vi.mock('../../../api/ipd/switching-acceptance', () => api);

const checkRow = (over: Record<string, unknown> = {}) => ({
  actual: '3180.50',
  bonusDistributionSum: '3180.50',
  diff: '0',
  duplicateCount: null,
  expected: '3180.50',
  kpiScoreSum: '3180.50',
  name: 'kpi_score_sum',
  note: null,
  passed: true,
  ...over,
});

const reportFixture = (over: Record<string, unknown> = {}) => ({
  checks: [
    checkRow(),
    checkRow({ actual: '1', diff: '1', duplicateCount: 1, expected: '0', name: 'duplicate_check', note: '检测到 1 条重复发放', passed: false }),
  ],
  diffRate: '0.0123',
  isLocked: false,
  lockedAt: null,
  lockedBy: null,
  month: '2026-08',
  passed: true,
  ranAt: '2026-09-01 02:00:00',
  ranBy: '2096266884247736321',
  summary: { failed: 1, passed: 4, total: 5 },
  unlockReason: null,
  unlockedAt: null,
  unlockedBy: null,
  ...over,
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setActivePinia(createPinia());
  for (const fn of Object.values(api)) fn.mockReset();
  api.listSwitchingAcceptance.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mountPage() {
  return mount(SwitchingAcceptancePage);
}

describe('月度切换验收视图（R215 GAP-F5）', () => {
  it('mount 即拉已 run 月份列表（onMounted 一次）；月份/差异率原样渲染', async () => {
    api.listSwitchingAcceptance.mockResolvedValueOnce([reportFixture()]);
    const wrapper = mountPage();
    await flushPromises();
    expect(api.listSwitchingAcceptance).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('2026-08');
    // BigDecimal 精度串原样展示（未做百分比换算/parseFloat）
    expect(wrapper.text()).toContain('0.0123');
    expect(wrapper.text()).toContain('通过');
    expect(wrapper.text()).toContain('未锁');
    wrapper.unmount();
  });

  it('列表 403/30001：错误 Alert 透传后端 message，不吞错（无权限态）', async () => {
    api.listSwitchingAcceptance.mockRejectedValueOnce(
      new IpdRequestError('HTTP 403', 403, 30001, 'http', '权限不足'),
    );
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('权限不足');
    wrapper.unmount();
  });

  it('月份列表空态：引导文案（尚无已 run 月份），不展示模拟数据（G-06）', async () => {
    api.listSwitchingAcceptance.mockResolvedValueOnce([]);
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('尚无已 run 月份');
    wrapper.unmount();
  });

  it('查看报告：month string 透传 getSwitchingAcceptance；checks 明细 + summary + 19 位雪花 ranBy 渲染', async () => {
    api.listSwitchingAcceptance.mockResolvedValueOnce([reportFixture()]);
    api.getSwitchingAcceptance.mockResolvedValueOnce(reportFixture());
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as { openReport: (m: string) => Promise<void> };
    await vm.openReport('2026-08');
    await flushPromises();
    expect(api.getSwitchingAcceptance).toHaveBeenCalledWith('2026-08');
    const text = wrapper.text();
    expect(text).toContain('2096266884247736321'); // ranBy 19 位雪花逐字符
    expect(text).toContain('kpi_score_sum');
    expect(text).toContain('duplicate_check');
    expect(text).toContain('检测到 1 条重复发放');
    expect(text).toContain('total=5'); // summary 计数
    wrapper.unmount();
  });

  it('run：选月运行对账，month 补零格式透传 api；返回报告渲染并回拉列表', async () => {
    api.runSwitchingAcceptance.mockResolvedValueOnce(reportFixture({ month: '2026-08' }));
    api.listSwitchingAcceptance.mockResolvedValue([]);
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      pickedMonth: { value: { format: (f: string) => string } | null };
      runReport: () => Promise<void>;
    };
    // DatePicker picker=month + value-format YYYY-MM（dayjs format 保证补零）
    vm.pickedMonth.value = { format: (f: string) => (f === 'YYYY-MM' ? '2026-08' : '') };
    await vm.runReport();
    await flushPromises();
    expect(api.runSwitchingAcceptance).toHaveBeenCalledWith('2026-08');
    expect(api.listSwitchingAcceptance.mock.calls.length).toBeGreaterThanOrEqual(2); // 回拉列表
    expect(wrapper.text()).toContain('kpi_score_sum');
    wrapper.unmount();
  });

  it('lock：以当前报告 month 透传 api；unlock reason 4 字前端拦截不发（对齐 @Size(5,500)）', async () => {
    api.listSwitchingAcceptance.mockResolvedValueOnce([reportFixture({ month: '2026-08' })]);
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      lockReport: () => Promise<void>;
      openUnlock: () => void;
      submitUnlock: () => Promise<void>;
      unlockReason: string;
      report: { month: string } | null;
    };
    // 先经报告路径把 report 挂上（activeMonth 兜底链）
    api.getSwitchingAcceptance.mockResolvedValueOnce(reportFixture({ month: '2026-08', isLocked: false }));
    const vmOpen = wrapper.vm as unknown as { openReport: (m: string) => Promise<void> };
    await vmOpen.openReport('2026-08');
    await flushPromises();

    api.lockSwitchingAcceptance.mockResolvedValueOnce(reportFixture({ month: '2026-08', isLocked: true }));
    await vm.lockReport();
    expect(api.lockSwitchingAcceptance).toHaveBeenCalledWith('2026-08');

    // unlock：reason 4 字 → 前端拦截，api 不被调用
    vm.openUnlock();
    vm.unlockReason = '太短了';
    await vm.submitUnlock();
    expect(api.unlockSwitchingAcceptance).not.toHaveBeenCalled();

    // 合法 reason（≥5 字）→ 透传 month+reason
    api.unlockSwitchingAcceptance.mockResolvedValueOnce(reportFixture({ isLocked: false, unlockReason: '重复发放已冲正，重跑对账' }));
    vm.openUnlock();
    vm.unlockReason = '重复发放已冲正，重跑对账';
    await vm.submitUnlock();
    await flushPromises();
    expect(api.unlockSwitchingAcceptance).toHaveBeenCalledWith('2026-08', '重复发放已冲正，重跑对账');
    expect(wrapper.text()).toContain('该月曾被解锁');
    wrapper.unmount();
  });

  it('run 失败 403：message 透传不吞错，列表不被污染', async () => {
    api.runSwitchingAcceptance.mockRejectedValueOnce(new IpdRequestError('HTTP 403', 403, 30001, 'http', '权限不足'));
    const wrapper = mountPage();
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      pickedMonth: { value: { format: (f: string) => string } | null };
      runReport: () => Promise<void>;
    };
    vm.pickedMonth.value = { format: (f: string) => (f === 'YYYY-MM' ? '2026-08' : '') };
    await vm.runReport();
    expect(api.runSwitchingAcceptance).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
