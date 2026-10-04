/**
 * 需求详情视图 + 路由登记契约（R215-E2E-C 看板卡 f4445a05）。
 *
 * 覆盖矩阵：
 * - 路由存在性：ipd.ts 登记 IpdRequirementDetail（path requirements/:id，hideInMenu + activePath）；
 * - 视图成功态：19 位雪花 id 原样渲染（string 透传，无精度丢失）+ VO 14 字段展示；
 * - 视图错误态：fetchDemandDetail 抛 IpdRequestError → 加载失败 Alert + 重新加载按钮。
 *
 * 设计原则（与 demand/index.test.ts 一致）：API 层 vi.mock 模块级替换，view 层只验渲染契约。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import { IpdRequestError } from '../../../../api/ipd/auth';
import { fetchDemandDetail, listDemandAttachments, downloadDemandAttachment } from '../../../../api/ipd/demand';
import type { IpdDemand } from '../../../../api/ipd/demand';
import { ipdLayoutRoute } from '../../../../router/routes/modules/ipd';
import DemandDetail from './index.vue';

vi.mock('../../../../api/ipd/demand', () => ({
  fetchDemandDetail: vi.fn(),
  listDemandAttachments: vi.fn(),
  downloadDemandAttachment: vi.fn(),
}));

const fetchDetailMock = vi.mocked(fetchDemandDetail);

const SNOWFLAKE = '2103330885699985410';

const detailFixture = (overrides: Partial<IpdDemand> = {}): IpdDemand => ({
  createdAt: 1700000000000,
  customerName: '某某公司',
  id: SNOWFLAKE,
  marketPmId: '900103',
  marketPmName: '市场PM李',
  productId: '7001',
  productName: 'ZK-X100',
  projectId: '9140001',
  rdPmId: '900104',
  rdPmName: '研发PM王',
  source: 'PORTAL_GUEST',
  status: 'SUBMITTED',
  submitterName: '张三',
  title: '希望支持批量导出',
  ...overrides,
});

let router: Router;

async function mountAt(id: string) {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: { template: '<div>list</div>' }, path: '/ipd/requirements' },
      { component: DemandDetail, path: '/ipd/requirements/:id' },
    ],
  });
  router.push(`/ipd/requirements/${id}`);
  await router.isReady();
  return mount(DemandDetail, { global: { plugins: [createPinia(), router] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchDetailMock.mockReset();
  vi.mocked(listDemandAttachments).mockReset().mockResolvedValue([]);
  vi.mocked(downloadDemandAttachment).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('路由登记（R215-E2E-C 缺口二：前端无 :id 路由）', () => {
  it('ipd.ts 登记 IpdRequirementDetail：requirements/:id + hideInMenu + activePath 回列表', () => {
    const children = (ipdLayoutRoute.children ?? []) as Array<{
      meta?: Record<string, unknown>;
      name?: string;
      path?: string;
    }>;
    const detailRoute = children.find((r) => r.name === 'IpdRequirementDetail');
    expect(detailRoute, '需求详情路由必须登记在 /ipd children 下').toBeDefined();
    expect(detailRoute?.path).toBe('requirements/:id');
    expect(detailRoute?.meta).toMatchObject({
      activePath: '/ipd/requirements',
      hideInMenu: true,
      title: '需求详情',
    });
  });
});

describe('需求详情视图', () => {
  it('成功态：19 位雪花 id 原样渲染 + VO 字段齐全（string 透传无精度丢失）', async () => {
    fetchDetailMock.mockResolvedValue(detailFixture());
    const wrapper = await mountAt(SNOWFLAKE);
    await flushPromises();
    await vi.waitFor(() => expect(fetchDetailMock).toHaveBeenCalledWith(SNOWFLAKE));

    const text = wrapper.text();
    expect(text).toContain(SNOWFLAKE); // 不被 Number() 截成 ...985400
    expect(text).not.toContain('2103330885699985400');
    expect(text).toContain('希望支持批量导出');
    expect(text).toContain('某某公司');
    expect(text).toContain('张三');
    expect(text).toContain('ZK-X100');
    expect(text).toContain('9140001');
    expect(text).toContain('市场PM李');
    expect(text).toContain('研发PM王');
    expect(text).toContain('游客门户');
    expect(text).toContain('新提交');
    wrapper.unmount();
  });

  it('错误态：fetchDemandDetail 抛 IpdRequestError → 加载失败 Alert + 重新加载', async () => {
    fetchDetailMock.mockRejectedValue(new IpdRequestError('需求不存在', 404, 10004, 'http'));
    const wrapper = await mountAt(SNOWFLAKE);
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.text()).toContain('加载失败'));

    expect(wrapper.text()).toContain('需求不存在');
    expect(wrapper.findComponent(DemandDetail).text()).toContain('重新加载');
    wrapper.unmount();
  });
});

describe('附件对象授权读取与下载', () => {
  it('清单显示文件名大小，下载走受保护接口，失败可见', async () => {
    fetchDetailMock.mockResolvedValue(detailFixture());
    vi.mocked(listDemandAttachments).mockResolvedValue([{ key: 'filekey01', fileName: '规格.pdf', fileSize: 9 }]);
    vi.mocked(downloadDemandAttachment).mockRejectedValue(new IpdRequestError('无权读取此需求附件', 403, 30001));
    const wrapper = await mountAt(SNOWFLAKE); await flushPromises();
    expect(listDemandAttachments).toHaveBeenCalledWith(SNOWFLAKE);
    expect(wrapper.find('[data-testid="demand-attachments"]').text()).toContain('规格.pdf（9 字节）');
    await wrapper.findAll('button').find((button) => button.text().replace(/\s/g, '') === '下载')!.trigger('click'); await flushPromises();
    expect(downloadDemandAttachment).toHaveBeenCalledWith(SNOWFLAKE, 'filekey01');
    expect(wrapper.text()).toContain('无权读取此需求附件'); wrapper.unmount();
  });
  it('附件权限拒绝不会显示可下载文件', async () => {
    fetchDetailMock.mockResolvedValue(detailFixture()); vi.mocked(listDemandAttachments).mockRejectedValue(new IpdRequestError('权限不足',403,30001));
    const wrapper = await mountAt(SNOWFLAKE); await flushPromises();
    expect(wrapper.find('[data-testid="demand-attachments"]').text()).toContain('权限不足');
    expect(wrapper.findAll('button').some((button) => button.text().replace(/\s/g, '') === '下载')).toBe(false); wrapper.unmount();
  });
});
