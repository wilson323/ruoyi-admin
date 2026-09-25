// 共担 KPI 归集（页30）组件级验证：mock 真实 /api/v1/kpi/shared +
// /api/v1/bonus-pool/list 契约，断言 revision DESC 分组、双 PM 列渲染、
// 空态、奖金池关联列表以及查询参数形态。

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import type { BonusPool } from '../../../../api/ipd/bonus';
import type { SharedKpiConfirmRow, SharedKpiDeadlineConfig, SharedKpiRecord } from '../../../../api/ipd/kpi';
import SharedKpi from './index.vue';
import { useIpdAuthStore } from '../../../../store/ipd-auth';

const kpiApi = vi.hoisted(() => ({
  listSharedKpis: vi.fn(),
  // ORPHAN-A7：页30 新增三端点（组件 onMounted 并行消费，mock 必须齐备）
  listSharedConfirms: vi.fn(),
  getSharedDeadlineConfig: vi.fn(),
  confirmSharedKpi: vi.fn(),
}));
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
  kpiApi.listSharedConfirms.mockReset();
  kpiApi.getSharedDeadlineConfig.mockReset();
  kpiApi.confirmSharedKpi.mockReset();
  bonusApi.listBonusPools.mockReset();
  // ORPHAN-A7 默认值：确认行空 + 截止配置 fixture（既有用例不感知新卡数据）
  kpiApi.listSharedConfirms.mockResolvedValue([]);
  kpiApi.getSharedDeadlineConfig.mockResolvedValue({
    dayOfMonth: 5, cutoffTime: '2026-10-07 18:00:00', version: 0, source: 'FACTORY_DEFAULT', configuredValue: null,
  } satisfies SharedKpiDeadlineConfig);
  kpiApi.confirmSharedKpi.mockResolvedValue({ confirmed: false, status: 'PENDING', firstConfirmedBy: '9001', secondConfirmedBy: null });
  routerMock.push.mockReset();
  routerMock.replace.mockReset();
  routeState.params = {};
  // 默认携带 projectId + period 触发 onMounted 自动 load()；按用例覆写。
  routeState.query = { period: '2026-09', projectId: '1001' };
});

afterEach(() => { vi.restoreAllMocks(); });

/** ORPHAN-A7 #82：签署闸按 personType 判定（GROUP_LEADER / SUPER_ADMIN 可签）。 */
function signIn(personType: 'GROUP_LEADER' | 'MARKET_PM' | 'RD_PM' | 'SUPER_ADMIN'): void {
  useIpdAuthStore().identity = {
    mustChangePwd: false,
    scope: 'FULL',
    person: { id: '9001', groupId: 'GRP-1', name: 'fixture', username: 'fixture', personType, accountStatus: 'ACTIVE' },
  };
}

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

    // API 形态：projectId 字符串透传（与 listBonusPools 统一）、period trim
    expect(kpiApi.listSharedKpis).toHaveBeenCalledWith('1001', '2026-09');
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

/* ========= ORPHAN-A7（R212 #79/#80/#82，看板卡 670aecdf）：页30 三端点接线 ========= */

function confirmRow(overrides: Partial<SharedKpiConfirmRow> = {}): SharedKpiConfirmRow {
  return {
    id: '9101',
    period: '2026-09',
    projectId: '1001',
    projectName: '智慧园区视频分析',
    personId: '9001',
    personName: '组长甲',
    metricCode: 'K01',
    metricName: '销量/出货量达成率',
    weight: '0.30',
    deadlineAt: '2026-10-07 18:00:00',
    status: 'PENDING',
    firstConfirmedBy: null,
    firstConfirmedAt: null,
    secondConfirmedBy: null,
    secondConfirmedAt: null,
    confirmedByMe: false,
    ...overrides,
  };
}

describe('页30 双组长确认 + 截止配置（ORPHAN-A7）', () => {
  it('#79 确认列表渲染：K01-K04 行 + 状态映射 + 首签/次签列 + 查询参数形态', async () => {
    kpiApi.listSharedKpis.mockResolvedValueOnce([record()]);
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    kpiApi.listSharedConfirms.mockResolvedValueOnce([
      confirmRow({ id: '9101', metricCode: 'K01', status: 'PENDING' }),
      confirmRow({ id: '9102', metricCode: 'K02', status: 'CONFIRMED', firstConfirmedBy: '9001', firstConfirmedAt: '2026-09-28 10:00:00', secondConfirmedBy: '9002', secondConfirmedAt: '2026-09-29 11:00:00', confirmedByMe: true }),
      confirmRow({ id: '9103', metricCode: 'K03', status: 'OVERDUE' }),
    ]);
    const wrapper = mount(SharedKpi);

    await vi.waitFor(() => expect(wrapper.text()).toContain('销量/出货量达成率'));
    // 状态三态映射
    expect(wrapper.text()).toContain('待确认');
    expect(wrapper.text()).toContain('已确认');
    expect(wrapper.text()).toContain('已逾期');
    // 首签/次签列（#id + 时间）
    expect(wrapper.text()).toContain('#9001');
    expect(wrapper.text()).toContain('#9002');
    // confirmedByMe 行渲染「我已签署」（无身份 → canSign false + confirmedByMe true 分支）
    expect(wrapper.text()).toContain('我已签署');
    // 查询参数形态：projectId 字符串透传 + period + 不传 status（filter 未选）
    expect(kpiApi.listSharedConfirms).toHaveBeenCalledWith('1001', '2026-09', undefined);
    wrapper.unmount();
  });

  it('#79 状态筛选：OVERDUE 选中后 status 参数透传', async () => {
    kpiApi.listSharedKpis.mockResolvedValueOnce([record()]);
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    kpiApi.listSharedConfirms.mockResolvedValue([]);
    const wrapper = mount(SharedKpi);
    await vi.waitFor(() => expect(kpiApi.listSharedConfirms).toHaveBeenCalled());

    // 状态筛选 Select（extra 位置）emit change → loadConfirms 透传 OVERDUE
    const statusSelect = wrapper.findComponent({ name: 'ASelect' });
    statusSelect.vm.$emit('update:value', 'OVERDUE');
    statusSelect.vm.$emit('change', 'OVERDUE');
    await vi.waitFor(() => {
      expect(kpiApi.listSharedConfirms).toHaveBeenLastCalledWith('1001', '2026-09', 'OVERDUE');
    });
    wrapper.unmount();
  });

  it('#82 签署动作：组长身份可见按钮 → Popconfirm 确认 → confirmSharedKpi + 列表刷新', async () => {
    signIn('GROUP_LEADER');
    kpiApi.listSharedKpis.mockResolvedValueOnce([record()]);
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    kpiApi.listSharedConfirms.mockResolvedValue([confirmRow({ status: 'PENDING', confirmedByMe: false })]);
    const wrapper = mount(SharedKpi);

    await vi.waitFor(() => expect(wrapper.text()).toContain('确认签署'));
    // Popconfirm confirm 事件（jsdom 气泡动画不可靠——emit 哲学与 functional 页一致）
    const popconfirm = wrapper.findComponent({ name: 'APopconfirm' });
    expect(popconfirm.exists()).toBe(true);
    popconfirm.vm.$emit('confirm');
    await vi.waitFor(() => expect(kpiApi.confirmSharedKpi).toHaveBeenCalledWith('9101'));
    // 签署后确认列表刷新（listSharedConfirms 再次被调）
    await vi.waitFor(() => expect(kpiApi.listSharedConfirms.mock.calls.length).toBeGreaterThanOrEqual(2));
    wrapper.unmount();
  });

  it('#82 权限闸：PM 身份（无 ipd:kpi-shared:confirm）不渲染签署按钮，PENDING 行显示占位', async () => {
    signIn('MARKET_PM');
    kpiApi.listSharedKpis.mockResolvedValueOnce([record()]);
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    kpiApi.listSharedConfirms.mockResolvedValue([confirmRow({ status: 'PENDING', confirmedByMe: false })]);
    const wrapper = mount(SharedKpi);

    await vi.waitFor(() => expect(wrapper.text()).toContain('销量/出货量达成率'));
    expect(wrapper.text()).not.toContain('确认签署');
    wrapper.unmount();
  });

  it('#80 截止配置卡：dayOfMonth/cutoff/source 渲染 + 写路径未交付标注', async () => {
    kpiApi.listSharedKpis.mockResolvedValueOnce([record()]);
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    kpiApi.getSharedDeadlineConfig.mockResolvedValueOnce({
      dayOfMonth: 7, cutoffTime: '2026-10-09 18:00:00', version: 3, source: 'DB_ACTIVE', configuredValue: '7',
    } satisfies SharedKpiDeadlineConfig);
    const wrapper = mount(SharedKpi);

    await vi.waitFor(() => expect(wrapper.text()).toContain('库内生效（DB_ACTIVE）'));
    expect(wrapper.text()).toContain('月度截止配置');
    expect(wrapper.text()).toContain('后端未交付 PUT 端点');
    expect(kpiApi.getSharedDeadlineConfig).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('#79/#80 拒绝路径：confirms 拒绝走 Alert、deadline 拒绝独立报错（互不拖垮）', async () => {
    kpiApi.listSharedKpis.mockResolvedValueOnce([record()]);
    bonusApi.listBonusPools.mockResolvedValueOnce([]);
    kpiApi.listSharedConfirms.mockRejectedValueOnce(new IpdRequestError('network', 0, 0, 'transport'));
    kpiApi.getSharedDeadlineConfig.mockRejectedValueOnce(new IpdRequestError('boom', 500, 50000, 'http'));
    const wrapper = mount(SharedKpi);

    await vi.waitFor(() => expect(wrapper.text()).toContain('确认列表加载失败'));
    await vi.waitFor(() => expect(wrapper.text()).toContain('截止配置加载失败'));
    // 主列表不受影响
    expect(wrapper.text()).toContain('共担 KPI 归集');
    wrapper.unmount();
  });
});
