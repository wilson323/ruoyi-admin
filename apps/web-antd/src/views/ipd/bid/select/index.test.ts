// 遴选页组件测试：3 选 1 原子遴选、防双中标前端表达、状态机只读分支。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Popconfirm, Radio } from 'ant-design-vue';

import { IpdRequestError, type IpdIdentity, type IpdPersonType } from '../../../../api/ipd/auth';
import type { BidInvitation, BidResponse } from '../../../../api/ipd/bid';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import SelectPage from './index.vue';

const api = vi.hoisted(() => ({
  getBidInvitation: vi.fn(),
  listBidResponses: vi.fn(),
  selectBidInvitation: vi.fn(),
}));
vi.mock('../../../../api/ipd/bid', () => api);

const routerMock = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ params: { bidId: 'INV-3003' } }),
}));

function identity(personType: IpdPersonType, id = '9007199254740993'): IpdIdentity {
  return {
    mustChangePwd: false, scope: 'FULL',
    person: { id, groupId: null, name: '测试', username: 'fixture', personType, accountStatus: 'ACTIVE' },
  };
}

function invitation(overrides: Partial<BidInvitation> = {}): BidInvitation {
  return {
    id: 'INV-3003', projectId: null, mode: 'PUBLIC', targetPersonId: null,
    title: '智慧园区视频分析算法研发', content: '客户问题、应用场景与核心功能', expireAt: '2026-09-20 23:59:59',
    status: 'OPEN', selectedResponseId: null, createBy: '9007199254740993', createTime: '2026-09-05 10:00:00',
    ...overrides,
  };
}

function bidResponse(overrides: Partial<BidResponse> = {}): BidResponse {
  return {
    id: 'RESP-1', invitationId: 'INV-3003', rdPmId: '9007199254740993',
    responseNote: null, status: 'PENDING', respondedAt: '2026-09-05 11:00:00', createBy: '9007199254740993',
    createTime: '2026-09-05 11:00:00',
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setActivePinia(createPinia());
  api.getBidInvitation.mockReset();
  api.listBidResponses.mockReset();
  api.selectBidInvitation.mockReset();
  routerMock.push.mockReset();
});

afterEach(() => { vi.unstubAllGlobals(); });

async function mountSelect() {
  const wrapper = mount(SelectPage);
  await flushPromises();
  return wrapper;
}

describe('页22 遴选 - 3 选 1、原子性、只读分支', () => {
  it('加载态：保留 Spin 直到详情返回', async () => {
    let resolveInvitation!: (inv: BidInvitation) => void;
    let resolveResponses!: (rows: BidResponse[]) => void;
    api.getBidInvitation.mockReturnValueOnce(new Promise<BidInvitation>((r) => { resolveInvitation = r; }));
    api.listBidResponses.mockReturnValueOnce(new Promise<BidResponse[]>((r) => { resolveResponses = r; }));
    const wrapper = mount(SelectPage);
    await flushPromises();
    expect(api.getBidInvitation).toHaveBeenCalled();
    resolveInvitation(invitation());
    resolveResponses([]);
    await flushPromises();
    expect(wrapper.find('.ant-spin').exists()).toBe(false);
  });

  it('成功态：候选人列表 + 确认区可见', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', '9007199254740993');
    api.getBidInvitation.mockResolvedValueOnce(invitation());
    api.listBidResponses.mockResolvedValueOnce([
      bidResponse({ id: 'A', rdPmId: '111' }),
      bidResponse({ id: 'B', rdPmId: '222' }),
    ]);
    const wrapper = await mountSelect();
    expect(wrapper.html()).toContain('待遴选应标');
    expect(wrapper.html()).toContain('研发PM #111');
    expect(wrapper.html()).toContain('研发PM #222');
    expect(wrapper.findAll('button').some((b) => b.text().includes('确认遴选'))).toBe(true);
  });

  it('非发起人：显示权限提示且不渲染候选人表', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', 'OTHER');
    api.getBidInvitation.mockResolvedValueOnce(invitation({ createBy: 'someone-else' }));
    api.listBidResponses.mockResolvedValueOnce([]);
    const wrapper = await mountSelect();
    expect(wrapper.html()).toContain('仅招标发起人可执行遴选');
    expect(wrapper.findAll('button').some((b) => b.text().includes('确认遴选'))).toBe(false);
  });

  it('空态：暂无应标记录给出方向性引导', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', '9007199254740993');
    api.getBidInvitation.mockResolvedValueOnce(invitation());
    api.listBidResponses.mockResolvedValueOnce([]);
    const wrapper = await mountSelect();
    expect(wrapper.html()).toContain('暂无应标记录');
  });

  it('单选约束：PENDING 可选，WITHDRAWN 禁用', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', '9007199254740993');
    api.getBidInvitation.mockResolvedValueOnce(invitation());
    api.listBidResponses.mockResolvedValueOnce([
      bidResponse({ id: 'A', status: 'PENDING' }),
      bidResponse({ id: 'B', status: 'WITHDRAWN' }),
    ]);
    const wrapper = await mountSelect();
    const radios = wrapper.findAllComponents(Radio);
    // 找到选中项对应的 radio 即可；具体数量与 antd 包装有关
    expect(radios.length).toBeGreaterThanOrEqual(2);
    // 至少一个 radio 的 input 是 disabled（WITHDRAWN）
    const disabledCount = radios.filter((r) => r.find('input').attributes('disabled') !== undefined).length;
    expect(disabledCount).toBeGreaterThanOrEqual(1);
  });

  it('确认遴选：调用 selectBidInvitation，成功后刷新只读', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', '9007199254740993');
    const inv = invitation();
    api.getBidInvitation.mockResolvedValueOnce(inv);
    api.listBidResponses.mockResolvedValueOnce([
      bidResponse({ id: 'A', rdPmId: '111' }),
      bidResponse({ id: 'B', rdPmId: '222' }),
    ]);
    const wrapper = await mountSelect();
    // 选择 A
    const radios = wrapper.findAllComponents(Radio);
    for (const r of radios) {
      if (r.props('checked') === false) { await r.vm.$emit('change'); break; }
    }
    api.selectBidInvitation.mockResolvedValueOnce(invitation({ status: 'SELECTED', selectedResponseId: 'A' }));
    api.listBidResponses.mockResolvedValueOnce([
      bidResponse({ id: 'A', status: 'ACCEPTED' }),
      bidResponse({ id: 'B', status: 'REJECTED' }),
    ]);
    const popconfirms = wrapper.findAllComponents(Popconfirm);
    await popconfirms[0]!.vm.$emit('confirm');
    await flushPromises();
    expect(api.selectBidInvitation).toHaveBeenCalledWith('INV-3003', expect.any(String));
    // SELECTED 后切换为只读结果态：确认遴选按钮消失
    expect(wrapper.findAll('button').some((b) => b.text().includes('确认遴选'))).toBe(false);
  });

  it('防双中标表达：提交期间 radio 全部 disabled', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', '9007199254740993');
    api.getBidInvitation.mockResolvedValueOnce(invitation());
    api.listBidResponses.mockResolvedValueOnce([
      bidResponse({ id: 'A', status: 'PENDING' }),
      bidResponse({ id: 'B', status: 'PENDING' }),
    ]);
    let resolve!: (inv: BidInvitation) => void;
    api.selectBidInvitation.mockReturnValueOnce(new Promise<BidInvitation>((r) => { resolve = r; }));
    const wrapper = await mountSelect();
    const radios = wrapper.findAllComponents(Radio);
    // 选中 A
    for (const r of radios) { await r.vm.$emit('change'); break; }
    // 触发遴选确认（select 仍未 resolve）
    const popconfirms = wrapper.findAllComponents(Popconfirm);
    await popconfirms[0]!.vm.$emit('confirm');
    await flushPromises();
    // 此时 confirmBusy=true，所有 PENDING 单选应被禁用
    const disabledCount = radios.filter((r) => r.find('input').attributes('disabled') !== undefined).length;
    expect(disabledCount).toBe(radios.length);
    resolve(invitation({ status: 'SELECTED', selectedResponseId: 'A' }));
  });

  it('拒绝态：50002 状态冲突映射中文文案 + 刷新按钮', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', '9007199254740993');
    api.getBidInvitation.mockResolvedValueOnce(invitation());
    api.listBidResponses.mockResolvedValueOnce([bidResponse()]);
    const wrapper = await mountSelect();
    const radios = wrapper.findAllComponents(Radio);
    for (const r of radios) { await r.vm.$emit('change'); break; }
    api.selectBidInvitation.mockRejectedValueOnce(new IpdRequestError('x', 409, 50002, 'http'));
    const popconfirms = wrapper.findAllComponents(Popconfirm);
    await popconfirms[0]!.vm.$emit('confirm');
    await flushPromises();
    expect(wrapper.html()).toContain('招标单状态已变更');
    expect(wrapper.findAll('button').some((b) => b.text().includes('刷新后重试'))).toBe(true);
  });

  it('断网态：transport 异常显示网络异常文案', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', '9007199254740993');
    api.getBidInvitation.mockResolvedValueOnce(invitation());
    api.listBidResponses.mockResolvedValueOnce([bidResponse()]);
    const wrapper = await mountSelect();
    const radios = wrapper.findAllComponents(Radio);
    for (const r of radios) { await r.vm.$emit('change'); break; }
    api.selectBidInvitation.mockRejectedValueOnce(new IpdRequestError('x', 0, 0, 'transport'));
    const popconfirms = wrapper.findAllComponents(Popconfirm);
    await popconfirms[0]!.vm.$emit('confirm');
    await flushPromises();
    expect(wrapper.html()).toContain('无法连接服务');
  });
});
