// 页12/13 动作详情 - 深管/轻管分支 + FAR/FRR + 乐观锁 50002。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import type { StageAction } from '../../../../api/ipd/stage-action';
import ActionDetail from './index.vue';

const api = vi.hoisted(() => ({
  addStageActionDeliverable: vi.fn(),
  listStageActions: vi.fn(),
  recordStageActionFields: vi.fn(),
  transitStageAction: vi.fn(),
}));
vi.mock('../../../../api/ipd/stage-action', () => api);

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ params: { projectId: 'PRJ-1', actionId: 'W-1' }, query: {} }),
}));

function stubAntd(): void {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

function deep(overrides: Partial<StageAction> = {}): StageAction {
  return {
    id: 'W-1', projectId: 'PRJ-1', stageId: 'STG-1', actionCode: 'C02', actionName: '客户问题验证',
    ownerRole: 'MARKET_PM', depth: 'DEEP', status: 'IN_PROGRESS',
    historyMark: null, isBlocking: null,
    actualDoneAt: null, farValue: null, frrValue: null,
    certNo: null, certPassedAt: null, algoType: null, isBioFeature: null,
    dueDate: null, sopId: 'SOP-1', remark: null, version: 1,
    ...overrides,
  };
}

function light(overrides: Partial<StageAction> = {}): StageAction {
  return {
    id: 'W-1', projectId: 'PRJ-1', stageId: 'STG-1', actionCode: 'P05', actionName: '文档校对',
    ownerRole: 'RD_PM', depth: 'LIGHT', status: 'NOT_STARTED',
    historyMark: null, isBlocking: null,
    actualDoneAt: null, farValue: null, frrValue: null,
    certNo: null, certPassedAt: null, algoType: null, isBioFeature: null,
    dueDate: null, sopId: 'SOP-2', remark: null, version: 1,
    ...overrides,
  };
}

function lightD11(overrides: Partial<StageAction> = {}): StageAction {
  return {
    id: 'W-1', projectId: 'PRJ-1', stageId: 'STG-1', actionCode: 'D11',
    actionName: 'BioCV 算法训练与评测',
    ownerRole: 'RD_PM', depth: 'LIGHT', status: 'IN_PROGRESS',
    historyMark: null, isBlocking: '1',
    actualDoneAt: null, farValue: null, frrValue: null,
    certNo: null, certPassedAt: null, algoType: 'FACE', isBioFeature: '1',
    dueDate: null, sopId: 'SOP-D11', remark: null, version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  stubAntd();
  setActivePinia(createPinia());
  Object.values(api).forEach((fn) => fn.mockReset());
  routerMock.replace.mockReset();
});

afterEach(() => { vi.unstubAllGlobals(); });

async function mountDetail() {
  const wrapper = mount(ActionDetail);
  await flushPromises();
  return wrapper;
}

describe('页12/13 动作详情', () => {
  it('加载态：保留 loading', async () => {
    let resolve!: (rows: StageAction[]) => void;
    api.listStageActions.mockReturnValueOnce(new Promise<StageAction[]>((r) => { resolve = r; }));
    mount(ActionDetail);
    await flushPromises();
    expect(api.listStageActions).toHaveBeenCalledWith('PRJ-1');
    resolve([]);
    await flushPromises();
  });

  it('深管动作：显示「深管动作」徽标 + 登记交付物按钮', async () => {
    api.listStageActions.mockResolvedValueOnce([deep()]);
    const wrapper = await mountDetail();
    const html = wrapper.html();
    expect(html).toContain('深管动作');
    expect(html).toContain('客户问题验证');
    expect(html).toContain('登记交付物');
    expect(html).not.toContain('FAR');
  });

  it('轻管动作：显示「轻管动作」徽标，无登记交付物按钮', async () => {
    api.listStageActions.mockResolvedValueOnce([light()]);
    const wrapper = await mountDetail();
    const html = wrapper.html();
    expect(html).toContain('轻管动作');
    expect(html).toContain('文档校对');
    expect(html).not.toContain('登记交付物');
  });

  it('D11 动作：显示 FAR/FRR 字段（例外一）', async () => {
    api.listStageActions.mockResolvedValueOnce([lightD11({ farValue: 0.001, frrValue: 0.002 })]);
    const wrapper = await mountDetail();
    const html = wrapper.html();
    expect(html).toContain('FAR');
    expect(html).toContain('FRR');
    expect(html).toContain('阻断性动作');
    expect(html).toContain('0.001');
    expect(html).toContain('0.002');
  });

  it('阻断性动作徽标显示', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ isBlocking: '1' })]);
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('阻断性动作');
  });

  it('历史缺失标记显示', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ historyMark: 'HISTORICAL_MISSING' })]);
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('历史缺失');
  });

  it('50002 乐观锁 → 中文错误提示', async () => {
    api.listStageActions.mockRejectedValueOnce(new IpdRequestError('x', 409, 50002, 'http'));
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('状态已变更');
  });

  it('10001 字段缺失 → 输入校验错误', async () => {
    api.listStageActions.mockRejectedValueOnce(new IpdRequestError('x', 400, 10001, 'http'));
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('输入信息');
  });

  it('transport 异常 → 网络异常文案', async () => {
    api.listStageActions.mockRejectedValueOnce(new IpdRequestError('x', 0, 0, 'transport'));
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('无法连接服务');
  });

  it('找不到动作 ID → loadError 提示「不在项目下」', async () => {
    api.listStageActions.mockResolvedValueOnce([deep({ id: 'OTHER' })]);
    const wrapper = await mountDetail();
    expect(wrapper.html()).toContain('不在项目');
  });

  it('返回 IPD 流程按钮跳转', async () => {
    api.listStageActions.mockResolvedValueOnce([light()]);
    const wrapper = await mountDetail();
    const backBtn = wrapper.findAll('button').find((b) => b.text().includes('返回 IPD 流程'));
    await backBtn!.trigger('click');
    expect(routerMock.replace).toHaveBeenCalledWith('/ipd/projects/PRJ-1/flow');
  });

  it('V02 动作：显示 certNo/certPassedAt 字段（例外二）', async () => {
    api.listStageActions.mockResolvedValueOnce([lightD11({
      actionCode: 'V02', actionName: '国别认证',
      isBlocking: '1', algoType: null, isBioFeature: null,
      certNo: 'CN-123', certPassedAt: 1726000000000,
    })]);
    const wrapper = await mountDetail();
    const html = wrapper.html();
    // Antd Descriptions 的 cell 渲染有特殊结构，直接断言组件 setup 暴露的内部状态更稳定
    const vm = wrapper.vm as unknown as { action?: { certNo: string; actionCode: string; certPassedAt: number } };
    expect(vm.action?.actionCode).toBe('V02');
    expect(vm.action?.certNo).toBe('CN-123');
    expect(vm.action?.certPassedAt).toBe(1726000000000);
    // V02 不显示 FAR/FRR（D11/Z01 专属例外字段）
    expect(html).not.toContain('FAR');
    expect(html).not.toContain('FRR');
    // 阻断性动作徽标仍在
    expect(html).toContain('阻断性动作');
  });
});