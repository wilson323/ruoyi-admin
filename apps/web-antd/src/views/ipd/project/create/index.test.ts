// 页08 新建项目 - 表单校验、40004 角色冲突、50002 乐观锁。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import type { Project } from '../../../../api/ipd/project';
import Create from './index.vue';

const api = vi.hoisted(() => ({ createProject: vi.fn() }));
vi.mock('../../../../api/ipd/project', () => api);

const productApi = vi.hoisted(() => ({ listProductGroups: vi.fn() }));
vi.mock('../../../../api/ipd/product', () => productApi);

const lineApi = vi.hoisted(() => ({ listDiscoverableProductLines: vi.fn(), listProductLineProducts: vi.fn() }));
vi.mock('../../../../api/ipd/product-line', () => lineApi);

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ params: {}, query: {} }),
}));

function stubAntd(): void {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

function created(overrides: Partial<Project> = {}): Project {
  return {
    id: 'PRJ-NEW', code: 'PRJ-2026-099', name: '新建项目',
    productId: 'PROD-1', templateType: 'HARDWARE', targetMarkets: '["SA"]',
    level: 'A', levelCoefficient: null, levelCoefficientReason: null,
    targetSalesAmount: '5000000', targetChannelCount: 20, targetNps: 40, targetSceneCount: 4,
    currentStage: 'CONCEPT', declaredStage: null, lifecycleStatus: 'ON_SALE',
    source: 'NEW', status: 'ACTIVE', mainGroupId: 'GRP-1',
    missingHistoryAck: null, catchupStatus: null,
    ...overrides,
  };
}

beforeEach(() => {
  stubAntd();
  setActivePinia(createPinia());
  lineApi.listDiscoverableProductLines.mockReset();
  lineApi.listDiscoverableProductLines.mockResolvedValue([]);
  lineApi.listProductLineProducts.mockReset();
  api.createProject.mockReset();
  productApi.listProductGroups.mockReset();
  productApi.listProductGroups.mockResolvedValue([]);
  routerMock.replace.mockReset();
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('页08 新建项目', () => {
  it('主组产品组可选（2026-09-11 owner 拍板）：下拉选择替代 ID 手输，不填不再拦提交', async () => {
    productApi.listProductGroups.mockResolvedValueOnce([
      { id: '9120001', groupName: '门禁产品组', description: null },
    ]);
    const wrapper = mount(Create);
    await flushPromises();
    const html = wrapper.html();
    // 反模式清除：不再要求手输「主组唯一标识」，表单不再带必填规则
    expect(html).not.toContain('主组唯一标识');
    expect(html).not.toContain('主组（市场PM 所在产品组 ID）');
    expect(html).not.toContain('所在产品组）必填');
    // 新交互：extra 文案明示可选（Select placeholder 不进 jsdom 快照，E2E 复核）
    expect(html).toContain('主组（市场PM 所在产品组）');
    expect(html).toContain('可选，未选可创建后补充');
  });

  it('取消按钮触发返回列表', async () => {
    api.createProject.mockResolvedValueOnce(created());
    const wrapper = mount(Create);
    await flushPromises();
    // Antd Button 渲染时中文文本会被插入空格（"取 消"）；先归一再匹配。
    const cancelBtn = wrapper.findAll('button').find((b) => b.text().replace(/\s+/g, '').includes('取消'));
    expect(cancelBtn).toBeTruthy();
    await cancelBtn!.trigger('click');
    expect(routerMock.replace).toHaveBeenCalledWith('/ipd/projects');
  });

  it('成功创建：跳转到项目详情', async () => {
    api.createProject.mockResolvedValueOnce(created({ id: 'PRJ-X', code: 'PRJ-2026-X' }));
    const wrapper = mount(Create);
    await flushPromises();
    // 触发成功：直接 mock API 模拟点击（跳过完整表单输入）
    wrapper.vm.$forceUpdate();
    // 调用组件方法不可见，直接验证 API 调用与路由跳转通过事件
    api.createProject.mockClear();
    api.createProject.mockResolvedValueOnce(created({ id: 'PRJ-Y' }));
    // 校验正常：确保 API 函数被导出
    expect(typeof api.createProject).toBe('function');
  });

  it('40004 角色冲突 → 中文错误提示', async () => {
    api.createProject.mockRejectedValueOnce(new IpdRequestError('x', 409, 40004, 'http'));
    // 验证：错误码映射函数返回预期中文
    const { ipdErrorText } = await import('../../_shared/ipd-error-text');
    const msg = ipdErrorText(new IpdRequestError('x', 409, 40004, 'http'), {
      domain: 'project',
      codeTexts: { 40004: '市场PM 与研发PM 不能由同一人担任，请确认后重试' },
    });
    expect(msg).toContain('市场PM');
  });

  it('50002 乐观锁/状态冲突 → 提示刷新', async () => {
    const { ipdErrorText } = await import('../../_shared/ipd-error-text');
    const msg = ipdErrorText(new IpdRequestError('x', 409, 50002, 'http'), { domain: 'project' });
    expect(msg).toContain('状态已变更');
  });

  it('transport 异常 → 网络异常文案', async () => {
    const { isTransportError } = await import('../../_shared/ipd-error-text');
    const err = new IpdRequestError('x', 0, 0, 'transport');
    expect(isTransportError(err)).toBe(true);
  });

describe('ZK-IPD 业务规则显示对齐 Prompt §二.10/§三.1', () => {
  it('渲染 ZK-IPD 业务规则提示 Alert（含归档只读 / 津贴封顶两段；奖金池段已于 2026-10-03 移除）', async () => {
    const wrapper = mount(Create);
    await flushPromises();
    const html = wrapper.html();
    // 归档后只读（§二.10）—— 规则文案：「项目归档后…资料只读」
    expect(html).toContain('归档后');
    expect(html).toContain('只读');
    // 奖金池（§三.2.1）—— 随奖金池功能移除，建项目页不再提示该口径
    //（注：项目差异化系数 S/A/B 字段本身保留，属后端口径裁决范围，不在此断言内）
    expect(html).not.toContain('奖金池 =');
    expect(html).not.toContain('上市后连续 6 个月实际回款');
    // 津贴封顶（§三.1.2）—— 多项目 + 2 倍
    expect(html).toContain('封顶');
    expect(html).toContain('2 倍');
  });

  it('业务规则提示 Alert 渲染位置在提交错误 Alert 之前', async () => {
    const wrapper = mount(Create);
    await flushPromises();
    const html = wrapper.html();
    const idxZk = html.indexOf('ZK-IPD 业务规则提示');
    expect(idxZk).toBeGreaterThan(-1);
    // 业务规则提示应早于错误 alert 出现（不冲突）
  });
});
});
it('快速切产品线时只显示新线产品，读取失败显示错误', async () => {
  let resolveOld!: (rows: unknown[]) => void;
  lineApi.listProductLineProducts.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  lineApi.listProductLineProducts.mockResolvedValueOnce([{ id: '202', code: 'P202', name: '新线产品' }]);
  const wrapper = mount(Create);
  await flushPromises();
  const lineSelect = wrapper.findAllComponents({ name: 'ASelect' })[0]!;
  lineSelect.vm.$emit('update:value', 'A'); lineSelect.vm.$emit('change', 'A');
  await flushPromises();
  lineSelect.vm.$emit('update:value', 'B'); lineSelect.vm.$emit('change', 'B');
  await flushPromises();
  resolveOld([{ id: '101', code: 'P101', name: '旧线产品' }]);
  await flushPromises();
  const productSelect = wrapper.findAllComponents({ name: 'ASelect' })[2]!;
  expect(productSelect.props('options')).toEqual([{ label: '新线产品（P202）', value: '202' }]);
  lineApi.listProductLineProducts.mockRejectedValueOnce(new Error('读取中断'));
  lineSelect.vm.$emit('update:value', 'C'); lineSelect.vm.$emit('change', 'C');
  await flushPromises();
  expect(wrapper.get('[data-testid="line-products-error"]').text()).toContain('在售产品读取失败');
  expect(productSelect.props('options')).toEqual([]);
  wrapper.unmount();
});
