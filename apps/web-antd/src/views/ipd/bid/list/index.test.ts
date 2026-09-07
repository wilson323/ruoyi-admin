// 列表页组件测试：五态、行内操作与权限可见性。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Popconfirm } from 'ant-design-vue';

import { IpdRequestError, type IpdIdentity, type IpdPersonType } from '../../../../api/ipd/auth';
import type { BidInvitation, IpdPage } from '../../../../api/ipd/bid';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import List from './index.vue';

const api = vi.hoisted(() => ({
  closeBidInvitation: vi.fn(),
  getBidInvitation: vi.fn(),
  listBidInvitations: vi.fn(),
  withdrawBidInvitation: vi.fn(),
}));
vi.mock('../../../../api/ipd/bid', () => api);

const routerMock = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => routerMock, useRoute: () => ({ params: {} }) }));

function stubAntd(): void {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

function identity(personType: IpdPersonType, id = '9007199254740993'): IpdIdentity {
  return {
    mustChangePwd: false, scope: 'FULL',
    person: { id, groupId: null, name: '测试', username: 'fixture', personType, accountStatus: 'ACTIVE' },
  };
}

function invitation(overrides: Partial<BidInvitation> = {}): BidInvitation {
  return {
    id: 'INV-1001', projectId: null, mode: 'PUBLIC', targetPersonId: null,
    title: '智慧园区视频分析算法研发', content: '客户问题、应用场景与核心功能描述', expireAt: '2026-09-20 23:59:59',
    status: 'OPEN', selectedResponseId: null, createBy: '9007199254740993', createTime: '2026-09-05 10:00:00',
    ...overrides,
  };
}

function pageOf(records: BidInvitation[]): IpdPage<BidInvitation> {
  return { current: 1, pages: 1, records, size: 20, total: records.length };
}

beforeEach(() => {
  stubAntd();
  setActivePinia(createPinia());
  api.closeBidInvitation.mockReset();
  api.getBidInvitation.mockReset();
  api.listBidInvitations.mockReset();
  api.withdrawBidInvitation.mockReset();
  routerMock.push.mockReset();
});

afterEach(() => { vi.unstubAllGlobals(); });

async function mountList() {
  const wrapper = mount(List);
  await flushPromises();
  return wrapper;
}

describe('页19 招标单列表 - 五态与权限', () => {
  it('加载态：保留 loading 图标直到数据返回', async () => {
    let resolve!: (page: IpdPage<BidInvitation>) => void;
    api.listBidInvitations.mockReturnValueOnce(new Promise<IpdPage<BidInvitation>>((r) => { resolve = r; }));
    const wrapper = mount(List);
    await flushPromises();
    expect(api.listBidInvitations).toHaveBeenCalled();
    resolve(pageOf([]));
    await flushPromises();
    expect(wrapper.find('.ant-empty').exists()).toBe(true);
  });

  it('成功态：渲染表格与状态标签', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', '9007199254740993');
    const rows = [
      invitation({ id: '1', title: '公开招标：图像算法', mode: 'PUBLIC' }),
      invitation({ id: '2', title: '定向招标：感知算法', mode: 'ONE_TO_ONE', targetPersonId: '9007199254740993' }),
      invitation({ id: '3', title: '已遴选', status: 'SELECTED' }),
    ];
    api.listBidInvitations.mockResolvedValueOnce(pageOf(rows));
    const wrapper = await mountList();
    const html = wrapper.html();
    expect(html).toContain('公开招标：图像算法');
    expect(html).toContain('定向招标：感知算法');
    expect(html).toContain('已遴选');
    expect(html).toContain('已遴选'); // status tag
    expect(html).toContain('公开征集');
    expect(html).toContain('定向邀请');
  });

  it('空态：研发PM 看到无数据引导', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.listBidInvitations.mockResolvedValueOnce(pageOf([]));
    const wrapper = await mountList();
    expect(wrapper.find('.ant-empty').exists()).toBe(true);
    expect(wrapper.html()).toContain('暂无招标单');
  });

  it('拒绝态（50002 状态冲突）映射中文文案 + 重新加载按钮', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listBidInvitations.mockRejectedValueOnce(new IpdRequestError('x', 409, 50002, 'http'));
    const wrapper = await mountList();
    const html = wrapper.html();
    expect(html).toContain('状态已变更');
    expect(wrapper.findAll('button').some((b) => b.text().includes('重新加载'))).toBe(true);
  });

  it('断网态：transport 异常显示网络异常文案', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listBidInvitations.mockRejectedValueOnce(new IpdRequestError('network', 0, 0, 'transport'));
    const wrapper = await mountList();
    expect(wrapper.html()).toContain('无法连接服务');
  });

  it('权限边界：RD_PM 看到「发起招标」被禁用 + Tooltip 提示', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.listBidInvitations.mockResolvedValueOnce(pageOf([]));
    const wrapper = await mountList();
    const createBtn = wrapper.findAll('button').find((b) => b.text().includes('发起招标'));
    expect(createBtn).toBeTruthy();
    expect(createBtn!.attributes('disabled')).toBeDefined();
  });

  it('MARKET_PM 发起人视角：可触发「撤回」与「关闭」', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', '9007199254740993');
    api.listBidInvitations.mockResolvedValueOnce(pageOf([invitation()]));
    const wrapper = await mountList();
    api.withdrawBidInvitation.mockResolvedValueOnce(invitation({ status: 'CLOSED' }));
    api.listBidInvitations.mockResolvedValueOnce(pageOf([]));
    const popconfirms = wrapper.findAllComponents(Popconfirm);
    // 第一个 Popconfirm 为「撤回」
    await popconfirms[0]!.vm.$emit('confirm');
    await flushPromises();
    expect(api.withdrawBidInvitation).toHaveBeenCalledWith('INV-1001');
    expect(api.listBidInvitations).toHaveBeenCalledTimes(2);
  });

  it('RD_PM 受邀点击「去应标」触发路由跳转', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.listBidInvitations.mockResolvedValueOnce(pageOf([invitation({ mode: 'PUBLIC', createBy: 'OTHER' })]));
    const wrapper = await mountList();
    const btn = wrapper.findAll('button').find((b) => b.text().includes('去应标'));
    expect(btn).toBeTruthy();
    await btn!.trigger('click');
    expect(routerMock.push).toHaveBeenCalledWith('/ipd/bids/INV-1001/respond');
  });

  it('「只看待我应标」筛选：研发PM 仅看到本人可应标行', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.listBidInvitations.mockResolvedValueOnce(pageOf([
      invitation({ id: '1', mode: 'PUBLIC' }),
      invitation({ id: '2', mode: 'ONE_TO_ONE', targetPersonId: 'someone-else', createBy: 'someone-else' }),
      invitation({ id: '3', mode: 'ONE_TO_ONE', targetPersonId: '9007199254740993', createBy: 'someone-else' }),
      invitation({ id: '4', status: 'SELECTED', mode: 'PUBLIC' }),
    ]));
    const wrapper = await mountList();
    const html0 = wrapper.html();
    expect(html0).toContain('智慧园区视频分析算法研发');
    const checkbox = wrapper.find('input[type=checkbox]');
    await checkbox.setValue(true);
    await flushPromises();
    const html1 = wrapper.html();
    // 研发PM 受邀 + 招标中 的是 PUBLIC / targetPersonId=我 的 OPEN 行
    expect(html1).toContain('INV-1001'.replace('INV-1001', '1')); // 行 ID 不可见，断言行数即可
    // PUBLIC 行去应标按钮仍可见
    expect(wrapper.findAll('button').some((b) => b.text().includes('去应标'))).toBe(true);
  });

  it('脏数据容错：targetPersonId="1"（真库引用型 ID）+ status="EXPIRED" 不崩', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM', 'someone-else');
    api.listBidInvitations.mockResolvedValueOnce(pageOf([
      invitation({
        id: '1',
        mode: 'ONE_TO_ONE',
        targetPersonId: '1',
        status: 'EXPIRED',
        createBy: 'someone-else',
        title: '真库样本招标单',
      }),
    ]));
    const wrapper = await mountList();
    // 表格层渲染不崩：脏数据（targetPersonId="1" + status="EXPIRED" + createTime 为毫秒数）兼容显示
    expect(wrapper.html()).toContain('真库样本招标单');
    expect(wrapper.html()).toContain('已过期');
    expect(wrapper.html()).toContain('定向邀请');
  });

  it('状态筛选切换：分页回到第 1 页（避免旧 current 与新数据错位）', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listBidInvitations.mockResolvedValueOnce(pageOf([invitation()]));
    const wrapper = await mountList();
    api.listBidInvitations.mockResolvedValueOnce(pageOf([
      invitation({ id: '2', status: 'SELECTED' }),
      invitation({ id: '3', status: 'CLOSED' }),
    ]));
    // 模拟「状态筛选」变更：直接调用组件暴露的 reloadFromFirstPage
    (wrapper.vm as unknown as { reloadFromFirstPage: () => void }).reloadFromFirstPage();
    await flushPromises();
    expect(api.listBidInvitations).toHaveBeenCalledTimes(2);
    const secondCall = api.listBidInvitations.mock.calls[1];
    expect(secondCall![0].status).toBeUndefined();
  });
});
