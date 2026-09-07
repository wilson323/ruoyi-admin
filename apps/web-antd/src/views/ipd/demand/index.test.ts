/**
 * 页40 需求管理：4 业务流 + 状态机 + 错误路径。
 *
 * 设计原则（与 portal/status/index.test.ts 一致）：
 * - API 层用 vi.mock 在模块层替换为 vi.fn；view 层只验证挂载/交互/渲染契约。
 * - happy-dom + antd-vue 4.x：Alert 用 :description 断言；Modal/Select 用 findComponent 驱动 v-model。
 *
 * 覆盖矩阵：
 *   F1. 列表/筛选 — onMounted 拉取 + 状态过滤本地化 + 超管可见产品下拉
 *   F2. 详情/加载 — 错误路径 / 空态 / 数据完整渲染
 *   F3. 状态机 — canStart/canPlan/canLink + onTriage 推进 EVALUATING/SCHEDULED
 *   F4. 关联项目弹窗 — openLinkModal + confirmLink + 模态确认
 *   F5. 双 tab 切换 — 产品需求 ↔ 项目需求
 */
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDemands, linkDemandProject, triageDemand } from '../../../api/ipd/demand';
import { listProducts } from '../../../api/ipd/product';
import type { Product } from '../../../api/ipd/product';
import { listProjects } from '../../../api/ipd/project';
import type { Project } from '../../../api/ipd/project';
import type { IpdDemand } from '../../../api/ipd/demand';
import type { IpdPersonType } from '../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import DemandPage from './index.vue';

// ──────────────────────────────────────────────────────────────────────────────
// 模块层 mock：保留导出形状，便于类型推断；将副作用替换为 vi.fn。
// ──────────────────────────────────────────────────────────────────────────────
vi.mock('../../../api/ipd/demand', () => ({
  fetchDemands: vi.fn(),
  linkDemandProject: vi.fn(),
  triageDemand: vi.fn(),
}));

vi.mock('../../../api/ipd/product', () => ({
  listProducts: vi.fn(),
}));

vi.mock('../../../api/ipd/project', () => ({
  listProjects: vi.fn(),
}));

const fetchDemandsMock = vi.mocked(fetchDemands);
const triageDemandMock = vi.mocked(triageDemand);
const linkDemandProjectMock = vi.mocked(linkDemandProject);
const listProductsMock = vi.mocked(listProducts);
const listProjectsMock = vi.mocked(listProjects);

const demand = (overrides: Partial<IpdDemand> = {}): IpdDemand => ({
  createdAt: 1700000000000,
  customerName: '某某公司',
  id: '101',
  marketPmId: null,
  marketPmName: null,
  productId: 'p-001',
  productName: 'ZK-X100',
  projectId: null,
  rdPmId: null,
  rdPmName: null,
  source: 'PORTAL_GUEST',
  status: 'SUBMITTED',
  submitterName: '张三',
  title: '希望支持批量导出',
  ...overrides,
});

const productFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'p-001',
  modelCode: 'ZK-X100',
  productCode: 'X100',
  productName: 'ZK-X100 产品',
  groupId: null,
  projectId: null,
  source: 'PM_NEW',
  status: 'ACTIVE',
  ...overrides,
});

const projectFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'p-500',
  code: 'P-500',
  name: '智慧园区一体机',
  productId: 'p-001',
  templateType: 'HARDWARE',
  targetMarkets: null,
  level: 'S',
  levelCoefficient: '1.20',
  levelCoefficientReason: 'S 级',
  targetSalesAmount: null,
  targetChannelCount: 30,
  targetNps: 60,
  targetSceneCount: 5,
  currentStage: 'CONCEPT',
  declaredStage: null,
  lifecycleStatus: 'TEAMING',
  source: 'NEW',
  missingHistoryAck: null,
  catchupStatus: null,
  status: 'DRAFT',
  mainGroupId: 'g-1',
  ...overrides,
});

function loginAs(personType: IpdPersonType, name = '测试人员'): void {
  const auth = useIpdAuthStore();
  auth.identity = {
    mustChangePwd: false,
    scope: 'FULL',
    person: {
      accountStatus: 'ACTIVE',
      groupId: personType === 'SUPER_ADMIN' ? null : 'G1',
      id: '1',
      name,
      personType,
      username: `fixture-${personType}`,
    },
  };
}

async function mountDemand() {
  const pinia = createPinia();
  setActivePinia(pinia);
  // 不在此处预填 listProducts/listProjects mock：让各测试用例按需配置（避免覆盖用例自身的 mockResolvedValue）。
  // 用例未配置时，vi.fn() 默认返回 undefined，组件的 try/catch 会兜底为空数组，行为无害。
  const wrapper = mount(DemandPage, { global: { plugins: [pinia] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchDemandsMock.mockReset();
  triageDemandMock.mockReset();
  linkDemandProjectMock.mockReset();
  listProductsMock.mockReset();
  listProjectsMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// ──────────────────────────────────────────────────────────────────────────────
// F1. 列表/筛选
// ──────────────────────────────────────────────────────────────────────────────
describe('F1. 列表/筛选', () => {
  it('onMounted 调用 fetchDemands（无过滤），渲染所有 status 标签', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({
      demands: [
        demand({ id: '1', status: 'SUBMITTED' }),
        demand({ id: '2', status: 'EVALUATING' }),
        demand({ id: '3', status: 'SCHEDULED' }),
      ],
      total: 3,
    });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalledTimes(1));
    expect(fetchDemandsMock.mock.calls[0]?.[0]).toBeUndefined();
    expect(wrapper.text()).toContain('新提交');
    expect(wrapper.text()).toContain('分析中');
    expect(wrapper.text()).toContain('已规划');
    wrapper.unmount();
  });

  it('状态筛选本地化：点击「已规划」只显示 SCHEDULED 状态的需求', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({
      demands: [
        demand({ id: '1', status: 'SUBMITTED' }),
        demand({ id: '2', status: 'SCHEDULED' }),
        demand({ id: '3', status: 'ARCHIVED' }),
      ],
      total: 3,
    });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    // 默认显示全部 — 3 条都在
    const articlesBefore = wrapper.findAll('.ipd-req-demand-list article');
    expect(articlesBefore.length).toBe(3);
    // 点击已规划按钮（取包含「已规划」文字的 segmented 按钮）
    const buttons = wrapper.findAll('.ipd-req-segmented button');
    const scheduledBtn = buttons.find((b) => b.text().includes('已规划'));
    expect(scheduledBtn).toBeDefined();
    await scheduledBtn!.trigger('click');
    const articlesAfter = wrapper.findAll('.ipd-req-demand-list article');
    expect(articlesAfter.length).toBe(1);
    expect(wrapper.text()).not.toContain('已规划' + '#' && false); // sanity
    // 只剩 SCHEDULED id=2
    expect(wrapper.text()).toContain('#2');
    expect(wrapper.text()).not.toContain('#1');
    wrapper.unmount();
  });

  it('超管可见产品下拉；非超管不渲染产品下拉', async () => {
    // 超管身份 + 产品列表
    const pinia = createPinia();
    setActivePinia(pinia);
    const auth = useIpdAuthStore();
    auth.identity = {
      mustChangePwd: false, scope: 'FULL',
      person: {
        accountStatus: 'ACTIVE', groupId: null, id: '1',
        name: '超管甲', personType: 'SUPER_ADMIN', username: 'super',
      },
    };
    listProductsMock.mockResolvedValue([
      productFixture() as unknown as Product,
      productFixture({ id: 'p-002', productName: 'ZK-Y200', modelCode: 'ZK-Y200', productCode: 'Y200' }) as unknown as Product,
    ]);
    listProjectsMock.mockResolvedValue([]);
    fetchDemandsMock.mockResolvedValue({ demands: [demand()], total: 1 });
    const wrapper = mount(DemandPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    const productSelect = wrapper.find('[data-testid="demand-product-filter"]');
    expect(productSelect.exists(), '超管必须看到产品下拉').toBe(true);
    wrapper.unmount();

    // 非超管：不可见
    const wrapper2 = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    expect(wrapper2.find('[data-testid="demand-product-filter"]').exists()).toBe(false);
    wrapper2.unmount();
  });

  it('超管切换产品：onProductFilterChange 触发 fetchDemands 带 productId', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const auth = useIpdAuthStore();
    auth.identity = {
      mustChangePwd: false, scope: 'FULL',
      person: {
        accountStatus: 'ACTIVE', groupId: null, id: '1',
        name: '超管', personType: 'SUPER_ADMIN', username: 'super',
      },
    };
    listProductsMock.mockResolvedValue([
      productFixture() as unknown as Product,
      productFixture({ id: 'p-002' }) as unknown as Product,
    ]);
    listProjectsMock.mockResolvedValue([]);
    fetchDemandsMock.mockResolvedValue({ demands: [], total: 0 });
    const wrapper = mount(DemandPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalledTimes(1));
    expect(fetchDemandsMock.mock.calls[0]?.[0]).toBeUndefined();

    const select = wrapper.find('[data-testid="demand-product-filter"]');
    expect(select.exists()).toBe(true);
    // 模拟选择产品 p-002
    await select.setValue('p-002');
    // change 事件触发 loadDemands()
    await flushPromises();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalledTimes(2));
    expect(fetchDemandsMock.mock.calls[1]?.[0]).toEqual({ productId: 'p-002' });
    wrapper.unmount();
  });

  it('产品指标卡：需求总量/待分析/未匹配产品/已进入项目 数值来自后端数据', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({
      demands: [
        demand({ id: '1', status: 'SUBMITTED' }),       // 待分析（SUBMITTED）+ 已进入项目否
        demand({ id: '2', status: 'ACCEPTED' }),        // 待分析（ACCEPTED）
        demand({ id: '3', status: 'SCHEDULED', productId: null }), // 未匹配
        demand({ id: '4', status: 'SCHEDULED', projectId: 'p-500' }), // 已进入项目
        demand({ id: '5', status: 'ARCHIVED' }),
      ],
      total: 5,
    });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    const cards = wrapper.findAll('[data-testid="demand-metrics"] .ipd-req-metric');
    expect(cards.length).toBe(4);
    // 产品需求总量 = 5
    expect(cards[0]!.find('strong').text()).toBe('5');
    // 待分析 = SUBMITTED+ACCEPTED = 2
    expect(cards[1]!.find('strong').text()).toBe('2');
    // 未匹配产品 = 1（id=3 productId=null）
    expect(cards[2]!.find('strong').text()).toBe('1');
    // 已进入项目 = 1
    expect(cards[3]!.find('strong').text()).toBe('1');
    wrapper.unmount();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// F2. 详情/加载（错误路径 + 空态）
// ──────────────────────────────────────────────────────────────────────────────
describe('F2. 详情/加载', () => {
  it('fetchDemands 拒绝：loadError 渲染，列表展示空态', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockRejectedValue(new Error('需求池接口加载失败'));
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(wrapper.find('.ipd-req-load-error').exists()).toBe(true));
    expect(wrapper.find('.ipd-req-load-error').text()).toContain('需求池接口加载失败');
    // 注：空态 v-if="!loadError && ..." 与 loadError 互斥，故此处只断言错误条带；
    // 空态文案渲染由「空数据」测试覆盖。
    wrapper.unmount();
  });

  it('空数据：直接渲染空态卡片，不渲染任何 article', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({ demands: [], total: 0 });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    expect(wrapper.findAll('.ipd-req-demand-list article').length).toBe(0);
    expect(wrapper.text()).toContain('当前筛选下暂无产品需求');
    wrapper.unmount();
  });

  it('需求卡片渲染：来源徽章、客户、提交人、标题、产品名、PM 名称', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({
      demands: [demand({
        id: '777',
        source: 'PORTAL_GUEST',
        customerName: '某某公司',
        submitterName: '李四',
        title: '希望支持批量导出报表',
        productName: 'ZK-X100',
        marketPmName: '市场张三',
        rdPmName: '研发李四',
      })],
      total: 1,
    });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    const text = wrapper.text();
    expect(text).toContain('游客'); // 来源徽章 PORTAL_GUEST
    expect(text).toContain('#777');
    expect(text).toContain('某某公司');
    expect(text).toContain('李四');
    expect(text).toContain('希望支持批量导出报表');
    expect(text).toContain('ZK-X100');
    expect(text).toContain('市场张三');
    expect(text).toContain('研发李四');
    wrapper.unmount();
  });

  it('需求为内部来源：徽章显示「内部」', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({
      demands: [demand({ id: '999', source: 'INTERNAL' })],
      total: 1,
    });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    // 同时存在「游客」segmented 按钮等不判定；只看徽章 span
    const badge = wrapper.find('.ipd-req-source-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.classes()).not.toContain('guest');
    expect(badge.text()).toContain('内部');
    wrapper.unmount();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// F3. 状态机 + onTriage 动作链
// ──────────────────────────────────────────────────────────────────────────────
describe('F3. 状态机 + 动作链', () => {
  it('canStart：SUBMITTED/ACCEPTED 显示「开始分析」按钮；点击触发 triageDemand(EVALUATING) 并刷新列表', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValueOnce({
      demands: [demand({ id: '1', status: 'SUBMITTED' })],
      total: 1,
    });
    // triage 后再拉一次
    fetchDemandsMock.mockResolvedValueOnce({
      demands: [demand({ id: '1', status: 'EVALUATING' })],
      total: 1,
    });
    triageDemandMock.mockResolvedValue({ id: '1', status: 'EVALUATING' });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());

    const startBtn = wrapper.findAll('.ipd-req-demand-actions button')
      .find((b) => b.text().includes('开始分析'));
    expect(startBtn).toBeDefined();
    await startBtn!.trigger('click');
    await vi.waitFor(() => expect(triageDemandMock).toHaveBeenCalledWith('1', { status: 'EVALUATING' }));
    // 触发 loadDemands 后再次调用 fetchDemands
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalledTimes(2));
    wrapper.unmount();
  });

  it('canPlan：EVALUATING 显示「纳入规划」按钮；点击触发 triageDemand(SCHEDULED)', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValueOnce({
      demands: [demand({ id: '2', status: 'EVALUATING' })],
      total: 1,
    }).mockResolvedValueOnce({ demands: [], total: 0 });
    triageDemandMock.mockResolvedValue({ id: '2', status: 'SCHEDULED' });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());

    const planBtn = wrapper.findAll('.ipd-req-demand-actions button')
      .find((b) => b.text().includes('纳入规划'));
    expect(planBtn).toBeDefined();
    await planBtn!.trigger('click');
    await vi.waitFor(() => expect(triageDemandMock).toHaveBeenCalledWith('2', { status: 'SCHEDULED' }));
    wrapper.unmount();
  });

  it('canLink：未关联项目 + EVALUATING/SCHEDULED 显示「关联项目」按钮', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({
      demands: [
        demand({ id: '3', status: 'EVALUATING', projectId: null }),
        demand({ id: '4', status: 'SCHEDULED', projectId: null }),
        // 已关联项目 — 不显示
        demand({ id: '5', status: 'SCHEDULED', projectId: 'p-X' }),
        // SUBMITTED — 不显示
        demand({ id: '6', status: 'SUBMITTED', projectId: null }),
      ],
      total: 4,
    });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    const linkBtns = wrapper.findAll('.ipd-req-demand-actions button.ipd-req-primary-link');
    expect(linkBtns.length).toBe(2);
    expect(linkBtns[0]!.text()).toContain('关联项目');
    wrapper.unmount();
  });

  it('onTriage 失败：triageDemand 抛错时不抛到测试，列表不刷新（fetchDemands 仅 1 次）', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({
      demands: [demand({ id: '9', status: 'SUBMITTED' })],
      total: 1,
    });
    triageDemandMock.mockRejectedValue(new Error('分流失败，请稍后重试'));
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalledTimes(1));

    const startBtn = wrapper.findAll('.ipd-req-demand-actions button')
      .find((b) => b.text().includes('开始分析'));
    await startBtn!.trigger('click');
    await vi.waitFor(() => expect(triageDemandMock).toHaveBeenCalled());
    await flushPromises();
    // 失败不刷新：fetchDemands 仍为 1 次
    expect(fetchDemandsMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// F4. 关联项目弹窗
// ──────────────────────────────────────────────────────────────────────────────
describe('F4. 关联项目弹窗', () => {
  it('点击「关联项目」打开模态：title 与项目列表填充 options', async () => {
    loginAs('MARKET_PM');
    listProjectsMock.mockResolvedValue([
      projectFixture({ id: 'p-A', code: 'P-A', name: '项目甲' }) as unknown as Project,
      projectFixture({ id: 'p-B', code: 'P-B', name: '项目乙' }) as unknown as Project,
    ]);
    fetchDemandsMock.mockResolvedValue({
      demands: [demand({ id: '11', status: 'EVALUATING' })],
      total: 1,
    });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());

    const linkBtn = wrapper.find('.ipd-req-primary-link');
    expect(linkBtn.exists()).toBe(true);
    await linkBtn.trigger('click');
    await flushPromises();
    // 模态 teleport 到 document.body：从 wrapper.text() 读不到，从 body 读
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('关联 IPD 项目');
    expect(bodyText).toContain('#11');
    wrapper.unmount();
  });

  it('confirmLink：选中项目并确认后调用 linkDemandProject 并刷新列表', async () => {
    loginAs('MARKET_PM');
    listProjectsMock.mockResolvedValue([
      projectFixture({ id: 'p-A', code: 'P-A', name: '项目甲' }) as unknown as Project,
    ]);
    fetchDemandsMock.mockResolvedValueOnce({
      demands: [demand({ id: '12', status: 'EVALUATING' })],
      total: 1,
    }).mockResolvedValueOnce({ demands: [], total: 0 });
    linkDemandProjectMock.mockResolvedValue({ id: '12', projectId: 'p-A', status: 'SCHEDULED' });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());

    // 打开弹窗
    await wrapper.find('.ipd-req-primary-link').trigger('click');
    await flushPromises();
    // 驱动 Select v-model（antd-vue 4.x happy-dom：dropdown 不可开，emit 替代）
    // 模态 teleport 到 body，findComponent 仍能命中（vue-test-utils 跨 teleport 解析）。
    const select = wrapper.findComponent({ name: 'ASelect' });
    expect(select.exists(), 'ASelect 必须渲染').toBe(true);
    await select.vm.$emit('update:value', 'p-A');
    await flushPromises();

    // 触发 Modal 的 OK 按钮（confirm 路径）
    // 模态在 body 里，用 document.querySelector 找
    const okBtn = Array.from(document.querySelectorAll('.ant-modal button'))
      .find((b) => (b.textContent ?? '').includes('确认关联'));
    expect(okBtn, '确认关联按钮必须在 .ant-modal 内渲染').toBeDefined();
    okBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() =>
      expect(linkDemandProjectMock).toHaveBeenCalledWith('12', 'p-A'),
    );
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalledTimes(2));
    wrapper.unmount();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// F5. 双 tab 切换
// ──────────────────────────────────────────────────────────────────────────────
describe('F5. 双 tab 切换', () => {
  it('默认显示产品需求 tab；点击「项目需求」渲染表格', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({
      demands: [
        demand({ id: '21', projectId: null }),         // 仅产品需求
        demand({ id: '22', projectId: 'p-500', title: '子需求' }), // 同时属于项目需求
      ],
      total: 2,
    });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());

    // 产品 tab：渲染 2 条 article
    expect(wrapper.findAll('.ipd-req-demand-list article').length).toBe(2);

    // 切到项目需求 tab
    const projectTab = wrapper.findAll('.ipd-req-switch button').find((b) => b.text().includes('项目需求'));
    expect(projectTab).toBeDefined();
    await projectTab!.trigger('click');
    await flushPromises();

    // 项目需求表格存在 + 只显示关联项目的需求
    expect(wrapper.find('[data-testid="project-demand-table"]').exists()).toBe(true);
    const projectRows = wrapper.findAll('[data-testid="project-demand-table"] .ipd-req-row').filter(
      (r) => !r.classes().includes('head'),
    );
    expect(projectRows.length).toBe(1);
    expect(wrapper.text()).toContain('子需求');
    expect(wrapper.text()).not.toContain('#21');
    wrapper.unmount();
  });

  it('项目需求 tab 空态：所有 demand 都未关联项目时显示空态文案', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({
      demands: [demand({ id: '31', projectId: null })],
      total: 1,
    });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    const projectTab = wrapper.findAll('.ipd-req-switch button').find((b) => b.text().includes('项目需求'));
    await projectTab!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('当前筛选下暂无项目需求');
    wrapper.unmount();
  });

  it('项目需求 metric 卡：全部 / 评估中 / 已规划 / 处理中 数值正确', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({
      demands: [
        demand({ id: '41', status: 'EVALUATING', projectId: 'p-A' }),
        demand({ id: '42', status: 'EVALUATING', projectId: 'p-A' }),
        demand({ id: '43', status: 'SCHEDULED', projectId: 'p-A' }),
        demand({ id: '44', status: 'PROCESSING', projectId: 'p-A' }),
        demand({ id: '45', status: 'SUBMITTED', projectId: null }), // 不计入
      ],
      total: 5,
    });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    const projectTab = wrapper.findAll('.ipd-req-switch button').find((b) => b.text().includes('项目需求'));
    await projectTab!.trigger('click');
    await flushPromises();

    const cards = wrapper.findAll('[data-testid="project-demand-metrics"] .ipd-req-metric');
    expect(cards.length).toBe(4);
    expect(cards[0]!.find('strong').text()).toBe('4'); // 全部需求
    expect(cards[1]!.find('strong').text()).toBe('2'); // 评估中
    expect(cards[2]!.find('strong').text()).toBe('1'); // 已规划
    expect(cards[3]!.find('strong').text()).toBe('1'); // 处理中
    wrapper.unmount();
  });

  it('项目名称查找：已关联项目的需求展示项目名（通过 listProjects 映射）', async () => {
    loginAs('MARKET_PM');
    listProjectsMock.mockResolvedValue([
      projectFixture({ id: 'p-500', name: '智慧园区一体机', code: 'P-500' }) as unknown as Project,
    ]);
    fetchDemandsMock.mockResolvedValue({
      demands: [demand({ id: '51', status: 'SCHEDULED', projectId: 'p-500' })],
      total: 1,
    });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    const projectTab = wrapper.findAll('.ipd-req-switch button').find((b) => b.text().includes('项目需求'));
    await projectTab!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('智慧园区一体机');
    wrapper.unmount();
  });

  it('ZK-IPD §五.5 业务规则 Alert：description 文本由 zk-ipd-rules 渲染（含 §五.5 标记）', async () => {
    loginAs('MARKET_PM');
    fetchDemandsMock.mockResolvedValue({ demands: [], total: 0 });
    const wrapper = await mountDemand();
    await vi.waitFor(() => expect(fetchDemandsMock).toHaveBeenCalled());
    // Alert 内 message="ZK-IPD 需求池规则"
    expect(wrapper.text()).toContain('ZK-IPD 需求池规则');
    // description 由需求池规则拼接
    expect(wrapper.text()).toContain('产品组长初审');
    expect(wrapper.text()).toContain('超级管理员终审');
    expect(wrapper.text()).toContain('§五.5');
    wrapper.unmount();
  });
});