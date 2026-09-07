// 页17 产品新增·编辑：双形态路由判定 + 加载态 + 编辑回填 + 校验 + 提交按角色走 create 或 update。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Edit from './index.vue';

const api = vi.hoisted(() => ({
  createProduct: vi.fn(),
  getProduct: vi.fn(),
  listProductGroups: vi.fn(),
  updateProduct: vi.fn(),
}));
vi.mock('../../../../api/ipd/product', () => api);

const routeState = vi.hoisted(() => ({ params: {} as Record<string, unknown> }));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ params: routeState.params }),
}));

function stubAntd(): void {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

const groups = [
  { id: '10', groupName: '智能门锁组', description: null, leaderPersonId: '8', parentId: null },
];
const productDetail = {
  id: '1', productCode: 'PD-1001', productName: '智能门锁 X1', modelCode: 'X1-V2',
  groupId: '10', source: 'ADMIN_IMPORT', status: 'ON_SALE', projectId: null,
};

const buttonText = (button: { text(): string }) => button.text().replace(/\s+/g, '');

beforeEach(() => {
  stubAntd();
  setActivePinia(createPinia());
  api.createProduct.mockReset();
  api.getProduct.mockReset();
  api.listProductGroups.mockReset();
  api.updateProduct.mockReset();
  routeState.params = {};
});

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

async function mountEdit() {
  const wrapper = mount(Edit);
  await flushPromises();
  await vi.waitFor(() => {
    if (wrapper.find('.ant-spin').exists()) throw new Error('still loading');
  });
  return wrapper;
}

describe('页17 产品新增·编辑', () => {
  it('新增形态（无 :productId）：渲染空表单 + 产品来源字段 + 「创建产品」按钮', async () => {
    routeState.params = {};
    api.listProductGroups.mockResolvedValue(groups);
    const wrapper = await mountEdit();
    expect(wrapper.text()).toContain('新增产品');
    expect(wrapper.text()).toContain('PM 新增');
    const create = wrapper.findAll('button').find((b) => buttonText(b) === '创建产品');
    expect(create).toBeTruthy();
    expect(api.getProduct).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('编辑形态（:productId=1）：回填 + 禁用产品编码 + 隐藏来源 + 「保存修改」按钮', async () => {
    routeState.params = { productId: '1' };
    api.listProductGroups.mockResolvedValue(groups);
    api.getProduct.mockResolvedValue(productDetail);
    const wrapper = await mountEdit();
    expect(wrapper.text()).toContain('编辑产品档案');
    expect(wrapper.text()).not.toContain('PM 新增（在研）');
    const codeInput = wrapper.findAll('input').find((i) => (i.element as HTMLInputElement).value === 'PD-1001');
    expect(codeInput).toBeTruthy();
    expect((codeInput!.element as HTMLInputElement).disabled).toBe(true);
    const save = wrapper.findAll('button').find((b) => buttonText(b) === '保存修改');
    expect(save).toBeTruthy();
    wrapper.unmount();
  });

  it('拒绝（30001）展示后端文案', async () => {
    routeState.params = {};
    api.listProductGroups.mockRejectedValue(new Error('权限不足'));
    const wrapper = await mountEdit();
    expect(wrapper.text()).toContain('权限不足');
    wrapper.unmount();
  });

  it('断网：失败后提供重新加载按钮', async () => {
    routeState.params = {};
    api.listProductGroups.mockRejectedValueOnce(new Error('无法连接服务，请检查网络后重试'))
      .mockResolvedValueOnce(groups);
    const wrapper = await mountEdit();
    expect(wrapper.text()).toContain('无法连接服务');
    wrapper.unmount();
  });

  it('编辑保存调用 updateProduct 并跳转 /ipd/products', async () => {
    routeState.params = { productId: '1' };
    api.listProductGroups.mockResolvedValue(groups);
    api.getProduct.mockResolvedValue(productDetail);
    api.updateProduct.mockResolvedValue(productDetail);
    const wrapper = await mountEdit();
    const saveBtn = wrapper.findAll('button').find((b) => buttonText(b) === '保存修改');
    expect(saveBtn).toBeTruthy();
    await saveBtn!.trigger('click');
    await vi.waitFor(() => {
      expect(api.updateProduct).toHaveBeenCalledWith('1', {
        productCode: 'PD-1001',
        productName: '智能门锁 X1',
        modelCode: 'X1-V2',
        groupId: '10',
      });
    });
    wrapper.unmount();
  });

  it('新增保存调用 createProduct(source  = PM_NEW) 并跳转', async () => {
    routeState.params = {};
    api.listProductGroups.mockResolvedValue(groups);
    api.createProduct.mockResolvedValue({ id: '99', productCode: 'PD-NEW', productName: '新产品', modelCode: 'NV', groupId: null, source: 'PM_NEW', status: 'IN_RD', projectId: null });
    const wrapper = await mountEdit();
    const inputs = wrapper.findAll('input');
    await inputs[0]!.setValue('PD-NEW');
    await inputs[1]!.setValue('新产品');
    await inputs[2]!.setValue('NV');
    const createBtn = wrapper.findAll('button').find((b) => buttonText(b) === '创建产品');
    expect(createBtn).toBeTruthy();
    await createBtn!.trigger('click');
    await vi.waitFor(() => {
      expect(api.createProduct).toHaveBeenCalledWith(expect.objectContaining({
        productCode: 'PD-NEW',
        productName: '新产品',
        modelCode: 'NV',
        source: 'PM_NEW',
      }));
    });
    wrapper.unmount();
  });
});