// 共担 KPI 归集（页30）组件级验证：mock 真实 /api/v1/kpi/shared +
// /api/v1/bonus-pool/list 契约，断言 revision DESC 分组、双 PM 列渲染、
// 空态、奖金池关联列表以及查询参数形态。

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import type { BonusPool } from '../../../../api/ipd/bonus';
import type { SharedKpiRecord } from '../../../../api/ipd/kpi';
import SharedKpi from './index.vue';

const kpiApi = vi.hoisted(() => ({ listSharedKpis: vi.fn() }));
const bonusApi = vi.hoisted(() => ({ listBonusPools: vi.fn() }));
vi.mock('../../../../api/ipd/kpi', () => kpiApi);
vi.mock('../../../../api/ipd/bonus', () => bonusApi);

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const routeState = vi.hoisted(() => ({ params: {} as Record<string, unknown>, query: {} as Record<string, string> }));
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ params: routeState.params, query: routeState.query }),
}));

function record(overrides: Partial<SharedKpiRecord> = {}): SharedKpiRecord {
  return {
    id: 'r-1', projectId: '1001', personId: 'p-1', kpiType: 'SHARED',
    period: '2026-09', comprehensiveScore: '88.50', revision: 1,
    scoredBy: '市场 PM-甲', status: 'DRAFT', segment: 'MARKET_PM',
    scoredAt: '2026-09-05 14:30:00',
    ...overrides,
  };
}

function pool(overrides: Partial<BonusPool> = {}): BonusPool {
  return {
    achievementRate: '0.95', basePool: '23750.00', coefficient: '1.05',
    finalPool: '24937.50', id: 'BP-1',
    poolRate: '0.05', projectId: '1001', status: 'CONFIRMED',
    targetSales: '475000.00', tierCoefficient: '1.00',
    ...overrides,
  } as BonusPool;
}

beforeEach(() => {
  setActivePinia(createPinia());
  kpiApi.listSharedKpis.mockReset();
  bonusApi.listBonusPools.mockReset();
  routerMock.push.mockReset();
  routerMock.replace.mockReset();
  routeState.params = {};
  // 默认携带 projectId + period 触发 onMounted 自动 load()；按用例覆写。
  routeState.query = { period: '2026-09', projectId: '1001' };
});

afterEach(() => { vi.restoreAllMocks(); });

describe('IPD 共担 KPI 归集页 (page 30 / P0-10.30)', () => {
  it('happy path: 5 records across revisions [3, 2, 1] grouped DESC with both PM columns', async () => {
    kpiApi.listSharedKpis.mockResolvedValueOnce([
      record({ id: 'r-mkt-3', revision: 3, segment: 'MARKET_PM', scoredBy: '市场 PM-甲', comprehensiveScore: '92.50', status: 'FINALIZED' }),
      record({ id: 'r-rd-3', revision: 3, segment: 'RD_PM', scoredBy: '研发 PM-乙', comprehensiveScore: '88.20', status: 'FINALIZED' }),
      record({ id: 'r-mkt-2', revision: 2, segment: 'MARKET_PM', scoredBy: '市场 PM-甲', comprehensiveScore: '85.00', status: 'DRAFT' }),
      record({ id: 'r-rd-2', revision: 2, segment: 'RD_PM', scoredBy: '研发 PM-乙', comprehensiveScore: '83.40', status: 'DRAFT' }),
      record({ id: 'r-mkt-1', revision: 1, segment: 'MARKET_PM', scoredBy: '市场 PM-甲', comprehensiveScore: '80.00', status: 'DRAFT' }),
    ]);
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    const wrapper = mount(SharedKpi);

    // 等真实数据（FINALIZED 综合分 92.50 load 完成才渲染）
    await vi.waitFor(() => expect(wrapper.text()).toContain('92.50'));

    // 双 PM 列渲染（segmentLabel）
    expect(wrapper.text()).toContain('市场 PM');
    expect(wrapper.text()).toContain('研发 PM');

    // 状态映射（statusTag）
    expect(wrapper.text()).toContain('已定稿');
    expect(wrapper.text()).toContain('草稿');

    // 最新 revision 描述项（最新 revision = 3）
    expect(wrapper.text()).toContain('最新 revision');
    expect(wrapper.text()).toContain('3');

    // revision DESC 顺序：3 → 2 → 1
    const html = wrapper.html();
    const pos3 = html.indexOf('revision 3');
    const pos2 = html.indexOf('revision 2');
    const pos1 = html.indexOf('revision 1');
    expect(pos3).toBeGreaterThan(-1);
    expect(pos2).toBeGreaterThan(pos3);
    expect(pos1).toBeGreaterThan(pos2);

    // API 形态：projectId 转 Number、period trim
    expect(kpiApi.listSharedKpis).toHaveBeenCalledWith(1001, '2026-09');
    wrapper.unmount();
  });

  it('empty data: [] records shows dedicated empty description, not the rejection alert', async () => {
    kpiApi.listSharedKpis.mockResolvedValueOnce([]);
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    const wrapper = mount(SharedKpi);

    // 等空态描述渲染（loaded=true 且 recordsData=[] 才显示 Empty）
    await vi.waitFor(() => expect(wrapper.text()).toContain('该期无共担 KPI 归集记录'));

    // 真缺口登记文案仍在（不展示任何模拟数据 G-06）
    expect(wrapper.text()).toContain('共担 KPI 归集');
    // 奖金池空态
    expect(wrapper.text()).toContain('该项目当期暂无奖金池');
    // 拒绝态错误条不应出现
    expect(wrapper.text()).not.toContain('共担 KPI 加载失败');
    wrapper.unmount();
  });

  it('market PM column: MARKET_PM records render with segment label and contributor name', async () => {
    kpiApi.listSharedKpis.mockResolvedValueOnce([
      record({ id: 'r-mkt', revision: 2, segment: 'MARKET_PM', scoredBy: '市场 PM-甲', comprehensiveScore: '91.00', status: 'FINALIZED' }),
      record({ id: 'r-rd', revision: 2, segment: 'RD_PM', scoredBy: '研发 PM-乙', comprehensiveScore: '86.00', status: 'FINALIZED' }),
    ]);
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    const wrapper = mount(SharedKpi);

    // 等真实数据（91.00 load 完成）
    await vi.waitFor(() => expect(wrapper.text()).toContain('91.00'));

    // 市场 PM 贡献列
    expect(wrapper.text()).toContain('市场 PM-甲');
    expect(wrapper.text()).toContain('91.00');
    // 归集周期 / 项目编号描述项
    expect(wrapper.text()).toContain('归集周期');
    expect(wrapper.text()).toContain('2026-09');
    expect(wrapper.text()).toContain('1001');
    wrapper.unmount();
  });

  it('rd PM column: RD_PM records render with segment label and contributor name', async () => {
    kpiApi.listSharedKpis.mockResolvedValueOnce([
      record({ id: 'r-rd', revision: 1, segment: 'RD_PM', scoredBy: '研发 PM-乙', comprehensiveScore: '77.30', status: 'FINALIZED' }),
    ]);
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    const wrapper = mount(SharedKpi);

    // 等真实数据（77.30 load 完成）
    await vi.waitFor(() => expect(wrapper.text()).toContain('77.30'));

    // 研发 PM 贡献列
    expect(wrapper.text()).toContain('研发 PM-乙');
    expect(wrapper.text()).toContain('77.30');
    wrapper.unmount();
  });

  it('revision grouping: 2 records with same revision are rendered under one revision header', async () => {
    kpiApi.listSharedKpis.mockResolvedValueOnce([
      record({ id: 'r-mkt', revision: 2, segment: 'MARKET_PM', scoredBy: '市场 PM-甲', comprehensiveScore: '88.00', status: 'FINALIZED' }),
      record({ id: 'r-rd', revision: 2, segment: 'RD_PM', scoredBy: '研发 PM-乙', comprehensiveScore: '82.00', status: 'FINALIZED' }),
    ]);
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    const wrapper = mount(SharedKpi);

    // 等真实数据
    await vi.waitFor(() => expect(wrapper.text()).toContain('88.00'));

    // revision 2 应出现一次（同一 revision 一个分组），且标记条数
    const rev2Matches = wrapper.text().match(/revision 2/g) ?? [];
    expect(rev2Matches.length).toBe(1);
    expect(wrapper.text()).toContain('2 条');
    // 最新 revision 描述项 = 2
    expect(wrapper.text()).toContain('最新 revision');
    // 同组两行：市场 PM + 研发 PM
    expect(wrapper.text()).toContain('市场 PM-甲');
    expect(wrapper.text()).toContain('研发 PM-乙');
    // revision 1 不存在
    expect(wrapper.text()).not.toContain('revision 1');
    wrapper.unmount();
  });

  it('bonus pool link: each linked pool row shows id, actual receipts, coefficients and status', async () => {
    kpiApi.listSharedKpis.mockResolvedValueOnce([
      record({ id: 'r-mkt', revision: 1, segment: 'MARKET_PM', comprehensiveScore: '90.00', status: 'FINALIZED' }),
    ]);
    bonusApi.listBonusPools.mockResolvedValueOnce([
      pool({ id: 'BP-1', status: 'DRAFT', finalPool: '12000.50', targetSales: '240010.00', tierCoefficient: '0.50' }),
      pool({ id: 'BP-2', status: 'CONFIRMED', finalPool: '30000.00', targetSales: '600020.00', tierCoefficient: '0.80' }),
      pool({ id: 'BP-3', status: 'DISTRIBUTED', finalPool: '18000.00', targetSales: '360030.00', tierCoefficient: '1.00' }),
    ]);
    const wrapper = mount(SharedKpi);

    // 等奖金池任一 ID 出现（load 完成才渲染）
    await vi.waitFor(() => expect(wrapper.text()).toContain('BP-2'));

    // 奖金池三行 ID（dataIndex 命中，列直接渲染）
    expect(wrapper.text()).toContain('BP-1');
    expect(wrapper.text()).toContain('BP-2');
    expect(wrapper.text()).toContain('BP-3');
    // 实际回款三行（后端 DRAFT 行 targetSales = actualReceipts）
    expect(wrapper.text()).toContain('240010');
    expect(wrapper.text()).toContain('600020');
    // 阶梯系数列
    expect(wrapper.text()).toContain('0.5');
    // 状态映射：草稿 / 已确认 / 已发放
    expect(wrapper.text()).toContain('草稿');
    expect(wrapper.text()).toContain('已确认');
    expect(wrapper.text()).toContain('已发放');
    // 奖金池列表 URL 调用形态
    expect(bonusApi.listBonusPools).toHaveBeenCalledWith('1001');
    wrapper.unmount();
  });

  it('rejection: IpdRequestError surfaced via inline Alert with rejectText mapping (transport kind)', async () => {
    kpiApi.listSharedKpis.mockRejectedValueOnce(new IpdRequestError('network', 0, 0, 'transport'));
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    const wrapper = mount(SharedKpi);

    // 等拒绝态文案（rejectText → transport → 「无法连接服务」）
    await vi.waitFor(() => expect(wrapper.text()).toContain('无法连接服务，请检查网络后重试'));
    expect(wrapper.text()).toContain('共担 KPI 加载失败');
    wrapper.unmount();
  });
});
