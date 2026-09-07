// 应标页组件测试：契约 D-1/D-2/D-3~D-7 的端到端校验与状态分支。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Popconfirm } from 'ant-design-vue';

import { IpdRequestError, type IpdIdentity, type IpdPersonType } from '../../../../api/ipd/auth';
import type { BidInvitation, BidResponse } from '../../../../api/ipd/bid';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import Respond from './index.vue';

const api = vi.hoisted(() => ({
  getBidInvitation: vi.fn(),
  listBidResponses: vi.fn(),
  submitBidResponse: vi.fn(),
  withdrawBidResponse: vi.fn(),
}));
vi.mock('../../../../api/ipd/bid', () => api);

const routerMock = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ params: { bidId: 'INV-2002' } }),
}));

function identity(personType: IpdPersonType, id = '9007199254740993'): IpdIdentity {
  return {
    mustChangePwd: false, scope: 'FULL',
    person: { id, groupId: null, name: '测试', username: 'fixture', personType, accountStatus: 'ACTIVE' },
  };
}

function invitation(overrides: Partial<BidInvitation> = {}): BidInvitation {
  return {
    id: 'INV-2002', projectId: null, mode: 'PUBLIC', targetPersonId: null,
    title: '智慧园区视频分析算法研发', content: '客户问题、应用场景与核心功能', expireAt: '2026-09-20 23:59:59',
    status: 'OPEN', selectedResponseId: null, createBy: 'someone-else', createTime: '2026-09-05 10:00:00',
    ...overrides,
  };
}

function bidResponse(overrides: Partial<BidResponse> = {}): BidResponse {
  return {
    id: 'RESP-1', invitationId: 'INV-2002', rdPmId: '9007199254740993',
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
  api.submitBidResponse.mockReset();
  api.withdrawBidResponse.mockReset();
  routerMock.push.mockReset();
});

afterEach(() => { vi.unstubAllGlobals(); });

async function mountRespond() {
  const wrapper = mount(Respond);
  await flushPromises();
  return wrapper;
}

describe('页21 应标 - 五态、契约差异、提交', () => {
  it('加载态：保留 Spin 直到邀请详情返回', async () => {
    let resolveInvitation!: (inv: BidInvitation) => void;
    let resolveResponses!: (rows: BidResponse[]) => void;
    api.getBidInvitation.mockReturnValueOnce(new Promise<BidInvitation>((r) => { resolveInvitation = r; }));
    api.listBidResponses.mockReturnValueOnce(new Promise<BidResponse[]>((r) => { resolveResponses = r; }));
    const wrapper = mount(Respond);
    await flushPromises();
    expect(api.getBidInvitation).toHaveBeenCalled();
    resolveInvitation(invitation());
    resolveResponses([]);
    await flushPromises();
    expect(wrapper.find('.ant-spin').exists()).toBe(false);
  });

  it('成功态：RD_PM + 受邀 OPEN 渲染应标编辑器', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.getBidInvitation.mockResolvedValueOnce(invitation());
    api.listBidResponses.mockResolvedValueOnce([]);
    const wrapper = await mountRespond();
    expect(wrapper.html()).toContain('我的密封应标');
    expect(wrapper.html()).toContain('密封应标：仅招标发起人可见');
  });

  it('空态：招标中但非受邀（ONE_TO_ONE 定向他人）说明权限边界', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.getBidInvitation.mockResolvedValueOnce(invitation({ mode: 'ONE_TO_ONE', targetPersonId: 'someone-else' }));
    api.listBidResponses.mockResolvedValueOnce([]);
    const wrapper = await mountRespond();
    expect(wrapper.html()).toContain('本招标单为定向邀请');
    expect(wrapper.find('textarea').exists()).toBe(false);
  });

  it('拒绝态：50002 状态冲突映射中文文案', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.getBidInvitation.mockResolvedValue(invitation());
    api.listBidResponses.mockResolvedValue([]);
    const wrapper = await mountRespond();
    const [plan, resource, risk] = wrapper.findAll('textarea');
    await plan!.setValue('p'.repeat(45));
    await resource!.setValue('两人双周迭代');
    await risk!.setValue('r'.repeat(22));
    api.submitBidResponse.mockRejectedValueOnce(new IpdRequestError('x', 409, 50002, 'http'));
    const submit = wrapper.findAll('button').find((b) => b.text() === '提交应标');
    await submit!.trigger('click');
    await flushPromises();
    expect(wrapper.html()).toContain('招标单已遴选或已关闭');
  });

  it('断网态：transport 异常显示网络异常文案', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.getBidInvitation.mockResolvedValue(invitation());
    api.listBidResponses.mockResolvedValue([]);
    const wrapper = await mountRespond();
    const [plan, resource, risk] = wrapper.findAll('textarea');
    await plan!.setValue('p'.repeat(45));
    await resource!.setValue('两人双周迭代');
    await risk!.setValue('r'.repeat(22));
    api.submitBidResponse.mockRejectedValueOnce(new IpdRequestError('x', 0, 0, 'transport'));
    const submit = wrapper.findAll('button').find((b) => b.text() === '提交应标');
    await submit!.trigger('click');
    await flushPromises();
    expect(wrapper.html()).toContain('无法连接服务');
  });

  it('成功提交：组装 responseNote 含【方案摘要】/【预计周期】/【资源投入】/【主要风险】', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.getBidInvitation.mockResolvedValue(invitation());
    api.listBidResponses.mockResolvedValue([]);
    const wrapper = await mountRespond();
    const [plan, resource, risk] = wrapper.findAll('textarea');
    await plan!.setValue('采用模块化重构方案，先离线回放历史数据完成算法评测，再小流量灰度验证效果，最后全量发布上线');
    await resource!.setValue('投入两人双周迭代');
    await risk!.setValue('客户现场开放节奏不可控，存在交付延期风险，需要提前与运营对齐里程碑');
    api.submitBidResponse.mockResolvedValueOnce(null);
    const submit = wrapper.findAll('button').find((b) => b.text() === '提交应标');
    await submit!.trigger('click');
    await flushPromises();
    const body = api.submitBidResponse.mock.calls[0]![0];
    expect(body.decision).toBe('accept');
    expect(body.invitationId).toBe('INV-2002');
    expect(body.responseNote).toContain('【方案摘要】采用模块化重构方案');
    expect(body.responseNote).toContain('【预计周期】90 天');
    expect(body.responseNote).toContain('【资源投入】投入两人双周迭代');
    expect(body.responseNote).toContain('【主要风险】客户现场开放节奏');
  });

  it('拒绝成功：data=null 视为成功（D-2 不留痕），提示已拒绝', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.getBidInvitation.mockResolvedValue(invitation());
    api.listBidResponses.mockResolvedValue([]);
    const wrapper = await mountRespond();
    api.submitBidResponse.mockResolvedValueOnce(null);
    const popconfirms = wrapper.findAllComponents(Popconfirm);
    const rejectConfirm = popconfirms[0];
    await rejectConfirm!.vm.$emit('confirm');
    await flushPromises();
    const body = api.submitBidResponse.mock.calls[0]![0];
    expect(body.decision).toBe('reject');
    expect(body.invitationId).toBe('INV-2002');
    expect(wrapper.html()).toContain('您已拒绝');
  });

  it('已应标 PENDING：显示我的应标卡 + 撤回应标入口', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.getBidInvitation.mockResolvedValueOnce(invitation());
    api.listBidResponses.mockResolvedValueOnce([bidResponse()]);
    const wrapper = await mountRespond();
    expect(wrapper.html()).toContain('我的应标');
    expect(wrapper.html()).toContain('已应标（待遴选）');
    const withdrawBtn = wrapper.findAll('button').find((b) => b.text() === '撤回应标');
    expect(withdrawBtn).toBeTruthy();
    api.withdrawBidResponse.mockResolvedValueOnce(bidResponse({ status: 'WITHDRAWN' }));
    const popconfirms = wrapper.findAllComponents(Popconfirm);
    await popconfirms[0]!.vm.$emit('confirm');
    await flushPromises();
    expect(api.withdrawBidResponse).toHaveBeenCalledWith('RESP-1');
  });

  it('发起人视角：不渲染编辑器，提示前往遴选页', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', 'CREATOR');
    api.getBidInvitation.mockResolvedValueOnce(invitation({ createBy: 'CREATOR' }));
    api.listBidResponses.mockResolvedValueOnce([]);
    const wrapper = await mountRespond();
    expect(wrapper.html()).toContain('您是本招标单的发起人');
    expect(wrapper.html()).not.toContain('我的密封应标');
  });
});
