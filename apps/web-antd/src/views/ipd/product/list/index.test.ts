// 页16 产品管理-产品目录：五态（加载/列表/空态/拒绝/断网）+ 过滤分页 + 状态切换 + 跳转。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import List from './index.vue';

const api = vi.hoisted(() => ({
  batchImportProducts: vi.fn(),
  changeProductStatus: vi.fn(),
  listProductGroups: vi.fn(),
  listProducts: vi.fn(),
}));
vi.mock('../../../../api/ipd/product', () => api);

const routerMock = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => routerMock, useRoute: () => ({ params: {} }) }));

function stubAntd(): void {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

const products = [
  { id: '1', productCode: 'PD-1001', productName: '智能门锁 X1', modelCode: 'X1-V2', groupId: '10', source: 'ADMIN_IMPORT', status: 'ON_SALE', projectId: null },
  { id: '2', productCode: 'PD-1002', productName: '智能门锁 X1 Pro', modelCode: null, groupId: '10', source: 'PM_NEW', status: 'IN_RD', projectId: '5001' },
  { id: '3', productCode: 'PD-1003', productName: '智能门锁 Mini', modelCode: null, groupId: '11', source: 'PM_NEW', status: 'INACTIVE', projectId: null },
];
const groups = [
  { id: '10', groupName: '智能门锁组', description: null, leaderPersonId: '8', parentId: null },
  { id: '11', groupName: '智能摄像头组', description: null, leaderPersonId: '9', parentId: null },
];

const buttonText = (button: { text(): string }) => button.text().replace(/\s+/g, '');

beforeEach(() => {
  stubAntd();
  setActivePinia(createPinia());
  api.batchImportProducts.mockReset();
  api.changeProductStatus.mockReset();
  api.listProductGroups.mockReset();
  api.listProducts.mockReset();
  routerMock.push.mockReset();
  setDefaults();
});

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

async function mountList() {
  const wrapper = mount(List);
  await flushPromises();
  await vi.waitFor(() => {
    if (wrapper.find('.ant-spin').exists()) throw new Error('still loading');
  });
  return wrapper;
}

function setDefaults() {
  api.listProducts.mockResolvedValue(products);
  api.listProductGroups.mockResolvedValue(groups);
}

describe('页16 产品管理-产品目录', () => {
  it('列表态：渲染 3 行 + 状态标签 + 来源标签 + 归属产品组 + 绑定项目 ID', async () => {
    const wrapper = await mountList();
    expect(wrapper.text()).toContain('PD-1001');
    expect(wrapper.text()).toContain('智能门锁 X1');
    expect(wrapper.text()).toContain('在售');
    expect(wrapper.text()).toContain('超管导入');
    expect(wrapper.text()).toContain('在研');
    expect(wrapper.text()).toContain('PM 新增');
    expect(wrapper.text()).toContain('智能门锁组');
    expect(wrapper.text()).toContain('#5001');
    expect(api.listProducts).toHaveBeenCalled();
    expect(api.listProductGroups).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('空态：列表为空显示引导文案', async () => {
    api.listProducts.mockResolvedValue([]);
    api.listProductGroups.mockResolvedValue([]);
    const wrapper = await mountList();
    expect(wrapper.text()).toContain('暂无产品记录');
    wrapper.unmount();
  });

  it('拒绝（30001）展示后端中文文案', async () => {
    api.listProducts.mockRejectedValue(new Error('权限不足'));
    api.listProductGroups.mockResolvedValue(groups);
    const wrapper = await mountList();
    expect(wrapper.text()).toContain('权限不足');
    wrapper.unmount();
  });

  it('断网：失败后提供「重新加载」按钮并可重试成功', async () => {
    const offline = new IpdRequestError('无法连接服务，请检查网络后重试', 0, 0, 'transport');
    api.listProducts.mockRejectedValueOnce(offline).mockResolvedValueOnce(products);
    api.listProductGroups.mockResolvedValue(groups);
    const wrapper = await mountList();
    expect(wrapper.text()).toContain('无法连接服务');
    expect(wrapper.html()).toContain('重新加载');
    const retry = wrapper.findAll('button').find((b) => buttonText(b) === '重新加载');
    expect(retry).toBeTruthy();
    await retry!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('PD-1001'));
    expect(api.listProducts).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('关键词「Mini」过滤：3 行收敛到 1 行', async () => {
    const wrapper = await mountList();
    const input = wrapper.find('input');
    await input.setValue('Mini');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('PD-1003');
      expect(wrapper.text()).not.toContain('PD-1001');
    });
    wrapper.unmount();
  });

  it('点击「编辑」跳转 /ipd/products/:productId/edit', async () => {
    const wrapper = await mountList();
    const edit = wrapper.findAll('button').find((b) => buttonText(b) === '编辑');
    expect(edit).toBeTruthy();
    await edit!.trigger('click');
    expect(routerMock.push).toHaveBeenCalledWith('/ipd/products/1/edit');
    wrapper.unmount();
  });

  it('点击「新增产品」跳转 /ipd/products/create', async () => {
    const wrapper = await mountList();
    const add = wrapper.findAll('button').find((b) => buttonText(b) === '新增产品');
    expect(add).toBeTruthy();
    await add!.trigger('click');
    expect(routerMock.push).toHaveBeenCalledWith('/ipd/products/create');
    wrapper.unmount();
  });

  it('在售行点「停用」调用 changeProductStatus(id, INACTIVE) 并刷新', async () => {
    api.changeProductStatus.mockResolvedValue(undefined);
    const wrapper = await mountList();
    const stop = wrapper.findAll('button').find((b) => buttonText(b) === '停用');
    expect(stop).toBeTruthy();
    await stop!.trigger('click');
    await vi.waitFor(() => {
      expect(api.changeProductStatus).toHaveBeenCalledWith('1', 'INACTIVE');
    });
    await vi.waitFor(() => expect(api.listProducts).toHaveBeenCalledTimes(2));
    wrapper.unmount();
  });
});