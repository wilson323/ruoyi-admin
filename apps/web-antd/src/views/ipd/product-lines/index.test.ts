import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listDiscoverableProductLines,
  listPendingProductLineApplications,
  listProductLineDemands,
  listProductLineProducts,
  listProductLineProjects,
  listProductLines,
} from '../../../api/ipd/product-line';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import ProductLinesPage from './index.vue';

vi.mock('../../../api/ipd/product-line', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listDiscoverableProductLines: vi.fn(),
  listPendingProductLineApplications: vi.fn(),
  listProductLineDemands: vi.fn(),
  listProductLineProducts: vi.fn(),
  listProductLineProjects: vi.fn(),
  listProductLines: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(listProductLines).mockReset();
  vi.mocked(listDiscoverableProductLines).mockReset();
  vi.mocked(listProductLineProducts).mockReset();
  vi.mocked(listProductLineProjects).mockReset();
  vi.mocked(listProductLineDemands).mockReset();
  vi.mocked(listPendingProductLineApplications).mockReset();
  sessionStorage.clear();
});

describe('产品线团队空间目录', () => {
  it('待审批接口失败只影响审批卡；产品和项目保留，局部重试后恢复申请', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useIpdAuthStore().identity = {
      mustChangePwd: false,
      scope: 'FULL',
      person: {
        accountStatus: 'ACTIVE', groupId: null, id: '7', name: '空间组长',
        personType: 'MARKET_PM', username: 'line-leader',
      },
    };
    const line = { id: '101', code: 'ACCESS', name: '门禁', leaderPersonId: '7', status: 'ACTIVE' };
    vi.mocked(listProductLines).mockResolvedValue([line]);
    vi.mocked(listDiscoverableProductLines).mockResolvedValue([line]);
    vi.mocked(listProductLineProducts).mockResolvedValue([{ id: '201', code: 'P201', name: '门禁产品', status: 'ON_SALE' }, { id: '202', code: 'P202', name: '在研产品', status: 'IN_RD' }]);
    vi.mocked(listProductLineDemands).mockResolvedValue([]);
    vi.mocked(listProductLineProjects).mockResolvedValue([{
      id: '301', code: 'J301', name: '门禁项目', currentStage: '概念', status: 'ACTIVE',
    }]);
    vi.mocked(listPendingProductLineApplications)
      .mockRejectedValueOnce(new Error('审批接口暂不可用'))
      .mockResolvedValueOnce([{ personId: '8', status: 'PENDING', reviewedBy: null }]);

    const wrapper = mount(ProductLinesPage, {
      global: { plugins: [pinia], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    try {
      await vi.waitFor(() => expect(wrapper.text()).toContain('审批接口暂不可用'));
      expect(wrapper.text()).toContain('门禁产品');
      expect(wrapper.text()).toContain('门禁项目');
      expect(wrapper.text()).toContain('在售 1 个，在研 1 个，其他状态 0 个');
      expect(wrapper.text()).not.toContain('空间目录加载失败');
      expect(wrapper.text()).not.toContain('暂无待审批申请');

      const retry = wrapper.findAll('button').find((button) => button.text().includes('重试加载申请'));
      expect(retry).toBeDefined();
      await retry!.trigger('click');
      await vi.waitFor(() => expect(wrapper.text()).toContain('申请人 Person ID：8'));
      expect(wrapper.text()).not.toContain('审批接口暂不可用');
      expect(wrapper.text()).toContain('门禁产品');
      expect(wrapper.text()).toContain('门禁项目');
      expect(listPendingProductLineApplications).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
  });
});
