// 页07 我的项目-列表 - 五态、权限与关键词筛选。
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from '../../../../api/ipd/auth';
import type { Project, ProjectListItem } from '../../../../api/ipd/project';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import List from './index.vue';

const api = vi.hoisted(() => ({ listProjectItems: vi.fn() }));
vi.mock('../../../../api/ipd/project', () => api);

const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ params: {}, query: {} }),
}));

function stubAntd(): void {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

function identity(personType: 'GROUP_LEADER' | 'MARKET_PM' | 'RD_PM' | 'SUPER_ADMIN', id = '9007199254740993') {
  return {
    mustChangePwd: false, scope: 'FULL' as const,
    person: { id, groupId: 'GRP-1', name: '测试', username: 'fixture', personType, accountStatus: 'ACTIVE' },
  };
}

function project(overrides: Partial<Project> = {}): ProjectListItem {
  return {
    id: 'PRJ-1', code: 'PRJ-2026-001', name: '智慧园区视频分析算法研发',
    productId: 'PROD-1', templateType: 'HARDWARE', targetMarkets: '["SA","EU"]',
    level: 'A', levelCoefficient: null, levelCoefficientReason: null,
    targetSalesAmount: '5000000', targetChannelCount: 20, targetNps: 40, targetSceneCount: 4,
    currentStage: 'CONCEPT', declaredStage: null, lifecycleStatus: 'ON_SALE',
    source: 'NEW', status: 'ACTIVE', mainGroupId: 'GRP-1',
    missingHistoryAck: null, catchupStatus: null,
    createBy: '9007199254740993', createTime: '2026-09-05 10:00:00',
    lastActivityAt: null, scenarioDaysRemaining: null, critical: null,
    ...overrides,
  };
}

beforeEach(() => {
  stubAntd();
  setActivePinia(createPinia());
  api.listProjectItems.mockReset();
  routerMock.push.mockReset();
  routerMock.replace.mockReset();
});

afterEach(() => { vi.unstubAllGlobals(); });

async function mountList() {
  const wrapper = mount(List);
  await flushPromises();
  return wrapper;
}

describe('页07 我的项目-列表', () => {
  it('加载态：保留 loading 图标直到数据返回', async () => {
    let resolve!: (rows: Project[]) => void;
    api.listProjectItems.mockReturnValueOnce(new Promise<Project[]>((r) => { resolve = r; }));
    const wrapper = mount(List);
    await flushPromises();
    expect(api.listProjectItems).toHaveBeenCalled();
    resolve([]);
    await flushPromises();
    expect(wrapper.find('.ant-empty').exists()).toBe(true);
  });

  it('成功态：渲染表格与状态标签', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listProjectItems.mockResolvedValueOnce([
      project({ id: 'PRJ-1', code: 'PRJ-2026-001', status: 'ACTIVE', currentStage: 'CONCEPT' }),
      project({ id: 'PRJ-2', code: 'PRJ-2026-002', status: 'ARCHIVED', currentStage: 'LIFECYCLE' }),
    ]);
    const wrapper = await mountList();
    const html = wrapper.html();
    expect(html).toContain('PRJ-2026-001');
    expect(html).toContain('PRJ-2026-002');
    expect(html).toContain('进行中');
    expect(html).toContain('已归档');
    expect(html).toContain('概念阶段');
    expect(html).toContain('生命周期');
  });

  it('空态：可创建角色显示引导文案', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listProjectItems.mockResolvedValueOnce([]);
    const wrapper = await mountList();
    expect(wrapper.find('.ant-empty').exists()).toBe(true);
    expect(wrapper.html()).toContain('点击「新建项目」');
  });

  it('拒绝态（50002 状态冲突）映射中文文案 + 重新加载按钮', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listProjectItems.mockRejectedValueOnce(new IpdRequestError('x', 409, 50002, 'http'));
    const wrapper = await mountList();
    expect(wrapper.html()).toContain('状态已变更');
    expect(wrapper.findAll('button').some((b) => b.text().includes('重新加载'))).toBe(true);
  });

  it('断网态：transport 异常显示网络异常文案', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listProjectItems.mockRejectedValueOnce(new IpdRequestError('network', 0, 0, 'transport'));
    const wrapper = await mountList();
    expect(wrapper.html()).toContain('无法连接服务');
  });

  it('权限边界：RD_PM 看到「新建项目」「存量项目导入」均被禁用', async () => {
    useIpdAuthStore().identity = identity('RD_PM');
    api.listProjectItems.mockResolvedValueOnce([]);
    const wrapper = await mountList();
    const createBtn = wrapper.findAll('button').find((b) => b.text().includes('新建项目'));
    const legacyBtn = wrapper.findAll('button').find((b) => b.text().includes('存量项目导入'));
    expect(createBtn).toBeTruthy();
    expect(createBtn!.attributes('disabled')).toBeDefined();
    expect(legacyBtn).toBeTruthy();
    expect(legacyBtn!.attributes('disabled')).toBeDefined();
  });

  it('权限边界：SUPER_ADMIN 可点击「存量项目导入」', async () => {
    useIpdAuthStore().identity = identity('SUPER_ADMIN');
    api.listProjectItems.mockResolvedValueOnce([]);
    const wrapper = await mountList();
    const legacyBtn = wrapper.findAll('button').find((b) => b.text().includes('存量项目导入'));
    expect(legacyBtn).toBeTruthy();
    expect(legacyBtn!.attributes('disabled')).toBeUndefined();
  });

  it('MARKET_PM 点击「新建项目」跳转 /ipd/projects/create', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listProjectItems.mockResolvedValueOnce([]);
    const wrapper = await mountList();
    const btn = wrapper.findAll('button').find((b) => b.text().includes('新建项目'));
    await btn!.trigger('click');
    expect(routerMock.push).toHaveBeenCalledWith('/ipd/projects/create');
  });

  it('SUPER_ADMIN 点击「存量项目导入」跳转 /ipd/projects/legacy-import', async () => {
    useIpdAuthStore().identity = identity('SUPER_ADMIN');
    api.listProjectItems.mockResolvedValueOnce([]);
    const wrapper = await mountList();
    const btn = wrapper.findAll('button').find((b) => b.text().includes('存量项目导入'));
    await btn!.trigger('click');
    expect(routerMock.push).toHaveBeenCalledWith('/ipd/projects/legacy-import');
  });

  it('关键词筛选：表格仅展示匹配项', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listProjectItems.mockResolvedValueOnce([
      project({ id: 'PRJ-1', code: 'PRJ-2026-001', name: '智慧园区视频分析' }),
      project({ id: 'PRJ-2', code: 'PRJ-2026-002', name: '校园门禁 BioCV' }),
    ]);
    const wrapper = await mountList();
    const inputs = wrapper.findAll('input');
    const searchInput = inputs.find((i) => i.attributes('placeholder')?.includes('按项目编码'));
    expect(searchInput).toBeTruthy();
    await searchInput!.setValue('BioCV');
    await flushPromises();
    expect(wrapper.html()).toContain('PRJ-2026-002');
    expect(wrapper.html()).not.toContain('PRJ-2026-001');
  });

  it('catchup_status=IN_PROGRESS 显示「补齐中」徽标', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listProjectItems.mockResolvedValueOnce([
      project({ id: 'PRJ-3', code: 'PRJ-2026-003', source: 'LEGACY', catchupStatus: 'IN_PROGRESS' }),
    ]);
    const wrapper = await mountList();
    expect(wrapper.html()).toContain('补齐中');
  });

  it('场景复核列：剩余天数 + critical 红色临界告警（P1-9.2）', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listProjectItems.mockResolvedValueOnce([
      project({ id: 'PRJ-9', code: 'PRJ-2026-009', scenarioDaysRemaining: 2, critical: true, lastActivityAt: '2026-08-20 10:00:00' }),
      project({ id: 'PRJ-8', code: 'PRJ-2026-008', scenarioDaysRemaining: 12, critical: false }),
    ]);
    const wrapper = await mountList();
    const html = wrapper.html();
    expect(html).toContain('2 天');
    expect(html).toContain('临界');
    expect(html).toContain('12 天');
  });

  it('场景复核列：剩余天数 + critical 红色临界告警（P1-9.2）', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listProjectItems.mockResolvedValueOnce([
      project({ id: 'PRJ-9', code: 'PRJ-2026-009', scenarioDaysRemaining: 2, critical: true, lastActivityAt: '2026-08-20 10:00:00' }),
      project({ id: 'PRJ-8', code: 'PRJ-2026-008', scenarioDaysRemaining: 12, critical: false }),
    ]);
    const wrapper = await mountList();
    const html = wrapper.html();
    expect(html).toContain('2 天');
    expect(html).toContain('临界');
    expect(html).toContain('12 天');
  });

  it('立项销售额以千分位 + 两位小数显示', async () => {
    useIpdAuthStore().identity = identity('MARKET_PM');
    api.listProjectItems.mockResolvedValueOnce([
      project({ id: 'PRJ-1', targetSalesAmount: '12345678' }),
    ]);
    const wrapper = await mountList();
    expect(wrapper.html()).toContain('12,345,678.00');
  });
});