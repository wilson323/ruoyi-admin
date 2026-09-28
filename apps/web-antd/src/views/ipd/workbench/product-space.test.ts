/**
 * 页03 工作台·产品空间（=工作空间）：
 * 空间选择器切换真数据重载 + 第一个项目阶段进度四态 + 待办快捷入口数据范围过滤。
 * 全部走模块 mock 真实契约函数（无固定示例/模拟下拉/写死数组渲染）。
 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IpdPersonType } from '../../../api/ipd/auth';
import type { Product } from '../../../api/ipd/product';
import type {
  ProductWorkspace,
  WorkspaceProject,
} from '../../../api/ipd/product-workspace';
import type { Project } from '../../../api/ipd/project';
import type { StageAction } from '../../../api/ipd/stage-action';
import type { WorkbenchSummary, WorkbenchTask } from '../../../api/ipd/workbench';
import { listProducts } from '../../../api/ipd/product';
import { fetchProductWorkspace } from '../../../api/ipd/product-workspace';
import { getProject } from '../../../api/ipd/project';
import { listStageActions } from '../../../api/ipd/stage-action';
import {
  fetchMyInitiated,
  fetchMyPendingApprovals,
  fetchWorkbenchSummary,
  fetchWorkbenchTasks,
} from '../../../api/ipd/workbench';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import { taskTypeText } from '../_shared/ipd-enums';
import Workbench from './index.vue';

vi.mock('../../../api/ipd/product', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listProducts: vi.fn(),
}));
vi.mock('../../../api/ipd/product-workspace', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchProductWorkspace: vi.fn(),
}));
vi.mock('../../../api/ipd/project', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getProject: vi.fn(),
}));
vi.mock('../../../api/ipd/stage-action', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listStageActions: vi.fn(),
}));
vi.mock('../../../api/ipd/workbench', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchMyInitiated: vi.fn(),
  fetchMyPendingApprovals: vi.fn(),
  fetchWorkbenchSummary: vi.fn(),
  fetchWorkbenchTasks: vi.fn(),
}));

/* ---------- fixtures（真实契约形状，字段与 api/ipd 接口对齐） ---------- */

const summary: WorkbenchSummary = {
  stats: { pending: 0, overdue: 0, unread: 0, completed: 0, myInitiated: 0 },
  tasks: [],
  deletionPending: 0,
  currentAdvance: null,
};

function makeProduct(id: string, productName: string): Product {
  return {
    groupId: 'G1',
    id,
    modelCode: null,
    productCode: `PC-${id}`,
    productName,
    projectId: null,
    source: 'PM_NEW',
    status: 'ACTIVE',
  };
}

function makeWorkspaceProject(id: string, name: string, currentStage: null | string): WorkspaceProject {
  return {
    code: `PRJ-${id}`,
    currentStage,
    id,
    launchDate: null,
    name,
    status: 'ACTIVE',
    updatedAt: null,
  };
}

function makeWorkspace(product: Product, projects: WorkspaceProject[]): ProductWorkspace {
  return {
    demands: [],
    metrics: {
      activeProjects: projects.length,
      closedProjects: 0,
      feedback: 0,
      themes: 0,
    },
    product: {
      groupId: product.groupId,
      id: product.id,
      modelCode: product.modelCode,
      productCode: product.productCode,
      productName: product.productName,
      projectId: product.projectId,
      source: product.source,
      status: product.status,
    },
    projects,
  };
}

function makeProject(id: string, name: string, currentStage: null | string): Project {
  return {
    id,
    code: `PRJ-${id}`,
    name,
    productId: 'P-1',
    templateType: 'HARDWARE',
    targetMarkets: null,
    level: 'A',
    levelCoefficient: null,
    levelCoefficientReason: null,
    targetSalesAmount: null,
    targetChannelCount: null,
    targetNps: null,
    targetSceneCount: null,
    currentStage,
    declaredStage: null,
    lifecycleStatus: null,
    source: 'NEW',
    missingHistoryAck: null,
    catchupStatus: null,
    status: 'ACTIVE',
    mainGroupId: 'G1',
  };
}

function makeAction(
  id: string,
  projectId: string,
  status: string,
  isBlocking: null | string = null,
): StageAction {
  return {
    actionCode: `ACT-${id}`,
    actionName: `动作${id}`,
    depth: 'DEEP',
    id,
    isBlocking,
    projectId,
    status,
  };
}

function makeTask(
  id: string,
  projectId: string,
  title: string,
  deepLink: string,
): WorkbenchTask {
  return {
    id,
    projectId,
    projectName: `项目${projectId}`,
    projectCode: `PRJ-${projectId}`,
    actionCode: `ACT-${id}`,
    title,
    taskType: 'stage_sign',
    status: 'IN_PROGRESS',
    priority: 'normal',
    ownerRole: 'RD_PM',
    dueDate: Date.now() + 86_400_000,
    isBlocking: '1',
    deepLink,
  };
}

type MaybeError<T> = Error | T;

interface Scenario {
  actions?: Record<string, MaybeError<StageAction[]>>;
  details?: Record<string, MaybeError<Project>>;
  products?: MaybeError<Product[]>;
  tasks?: MaybeError<WorkbenchTask[]>;
  workspaces?: Record<string, MaybeError<ProductWorkspace>>;
}

function stubApis(scenario: Scenario): void {
  vi.mocked(fetchWorkbenchSummary).mockResolvedValue(summary);
  vi.mocked(fetchMyInitiated).mockResolvedValue([]);
  vi.mocked(fetchMyPendingApprovals).mockResolvedValue([]);
  if (scenario.products instanceof Error) {
    vi.mocked(listProducts).mockRejectedValue(scenario.products);
  } else {
    vi.mocked(listProducts).mockResolvedValue(scenario.products ?? []);
  }
  vi.mocked(fetchProductWorkspace).mockImplementation(async (id: string) => {
    const ws = scenario.workspaces?.[id];
    if (ws instanceof Error) throw ws;
    if (!ws) throw new Error(`unexpected workspace: ${id}`);
    return ws;
  });
  vi.mocked(getProject).mockImplementation(async (id: string) => {
    const detail = scenario.details?.[id];
    if (detail instanceof Error) throw detail;
    if (!detail) throw new Error(`unexpected project: ${id}`);
    return detail;
  });
  vi.mocked(listStageActions).mockImplementation(async (id: string) => {
    const rows = scenario.actions?.[id];
    if (rows instanceof Error) throw rows;
    return rows ?? [];
  });
  const tasks = scenario.tasks ?? [];
  if (tasks instanceof Error) {
    vi.mocked(fetchWorkbenchTasks).mockRejectedValue(tasks);
  } else {
    vi.mocked(fetchWorkbenchTasks).mockResolvedValue({
      bucket: 'pending',
      limit: 50,
      projectId: null,
      returned: tasks.length,
      tasks,
      total: tasks.length,
      type: null,
    });
  }
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function loginAs(personType: IpdPersonType, name: string): void {
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

function mountWorkbench(): { push: ReturnType<typeof vi.fn>; wrapper: VueWrapper } {
  const push = vi.fn().mockResolvedValue(undefined);
  const wrapper = mount(Workbench, {
    global: {
      mocks: { $router: { push } },
      stubs: { AiSuggest: true, AiTaskTodoDrawer: true },
    },
  });
  return { push, wrapper };
}

function activeStageLabel(wrapper: VueWrapper): string {
  return wrapper.find('[data-testid="wb-stage-item"].is-active').text();
}

/* ---------- 场景数据：两个产品空间，内容与数据范围互不相同 ---------- */

const productA = makeProduct('sp-1', '指纹锁空间');
const productB = makeProduct('sp-2', '门禁空间');
const projectA = makeWorkspaceProject('2001', 'Alpha 项目', 'DEV');
const projectB = makeWorkspaceProject('2002', 'Beta 项目', 'VALID');

describe('页03 工作台·产品空间（=工作空间）', () => {
  it('切换产品空间：fetchProductWorkspace 以新空间 id 重拉，渲染该空间第一个项目名称与真实阶段（不同空间不同内容）', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubApis({
      actions: {
        '2001': [makeAction('a1', '2001', 'DONE'), makeAction('a2', '2001', 'IN_PROGRESS', '1')],
        '2002': [makeAction('b1', '2002', 'DONE')],
      },
      details: {
        '2001': makeProject('2001', 'Alpha 项目', 'DEV'),
        '2002': makeProject('2002', 'Beta 项目', 'VALID'),
      },
      products: [productA, productB],
      tasks: [],
      workspaces: {
        'sp-1': makeWorkspace(productA, [projectA]),
        'sp-2': makeWorkspace(productB, [projectB]),
      },
    });
    const { wrapper } = mountWorkbench();

    // 默认选中第一个产品空间：渲染其第一个项目 + DEV 高亮（rail 就绪=阶段进度加载完成）
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Alpha 项目 · 阶段进度');
      expect(wrapper.find('[data-testid="wb-stage-rail"]').exists()).toBe(true);
    });
    expect(activeStageLabel(wrapper)).toContain('开发');
    expect(wrapper.text()).toContain('当前阶段：开发阶段');
    expect(wrapper.text()).toContain('动作总数 2');
    expect(wrapper.text()).toContain('阻断待办 1');

    // 切到第二个产品空间：以新 id 重拉，渲染新空间第一个项目与阶段
    const select = wrapper.find('[data-testid="workbench-space-select"]');
    await select.setValue('sp-2');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Beta 项目 · 阶段进度');
      expect(wrapper.find('[data-testid="wb-stage-rail"]').exists()).toBe(true);
    });
    expect(activeStageLabel(wrapper)).toContain('验证');
    expect(wrapper.text()).not.toContain('Alpha 项目');
    expect(vi.mocked(fetchProductWorkspace).mock.calls.map((c) => c[0])).toEqual(['sp-1', 'sp-2']);
    expect(vi.mocked(getProject).mock.calls.map((c) => c[0])).toEqual(['2001', '2002']);
    // 待办数据范围同步切换（space-progress 上报 scope → todo 过滤）
    expect(wrapper.text()).toContain('当前产品空间：门禁空间');
    wrapper.unmount();
  });

  it('第一个项目不存在：projects 为空 → 「待补充」态，不渲染阶段 rail 假数据', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubApis({
      products: [productA],
      tasks: [],
      workspaces: { 'sp-1': makeWorkspace(productA, []) },
    });
    const { wrapper } = mountWorkbench();

    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="wb-space-progress-no-project"]').exists()).toBe(true),
    );
    expect(wrapper.text()).toContain('该产品空间暂无项目，待补充');
    // 无假 rail：六阶段骨架与进度数字都不渲染
    expect(wrapper.find('[data-testid="wb-stage-rail"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="wb-stage-item"]')).toHaveLength(0);
    expect(wrapper.find('[data-testid="wb-action-stats"]').exists()).toBe(false);
    // projects 为空时不再打 getProject / listStageActions
    expect(vi.mocked(getProject)).not.toHaveBeenCalled();
    expect(vi.mocked(listStageActions)).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('阶段进度接口失败：「加载失败」+ 重试按钮；点重试重发请求，mock 恢复成功后渲染恢复', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubApis({
      actions: { '2001': new Error('stage-actions down') },
      details: { '2001': new Error('project down') },
      products: [productA],
      tasks: [],
      workspaces: { 'sp-1': makeWorkspace(productA, [projectA]) },
    });
    const { wrapper } = mountWorkbench();

    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="wb-space-progress-error"]').exists()).toBe(true),
    );
    expect(wrapper.text()).toContain('阶段进度加载失败');
    const retry = wrapper.find('[data-testid="wb-space-progress-retry"]');
    expect(retry.exists()).toBe(true);
    expect(wrapper.find('[data-testid="wb-stage-rail"]').exists()).toBe(false);

    // 接口恢复：点重试 = 重跑该空间加载（真实重发请求）
    vi.mocked(getProject).mockResolvedValue(makeProject('2001', 'Alpha 项目', 'DEV'));
    vi.mocked(listStageActions).mockResolvedValue([makeAction('a1', '2001', 'DONE')]);
    await retry.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Alpha 项目 · 阶段进度'));
    expect(wrapper.findAll('[data-testid="wb-stage-item"]')).toHaveLength(6);
    expect(activeStageLabel(wrapper)).toContain('开发');
    expect(vi.mocked(fetchProductWorkspace)).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('待办快捷入口：按当前产品空间 projectIds 过滤（空间外不显示），「去处理」按 deepLink 跳转', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubApis({
      actions: { '2001': [makeAction('a1', '2001', 'DONE')] },
      details: { '2001': makeProject('2001', 'Alpha 项目', 'DEV') },
      products: [productA],
      tasks: [
        makeTask('t-1', '2001', '签署阶段准入', '/ipd/projects/2001/actions/7'),
        makeTask('t-2', '9999', '空间外任务甲', '/ipd/projects/9999/actions/8'),
        makeTask('t-3', '8888', '空间外任务乙', '/ipd/projects/8888/actions/9'),
      ],
      workspaces: { 'sp-1': makeWorkspace(productA, [projectA]) },
    });
    const { push, wrapper } = mountWorkbench();

    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="wb-todo-item"]')).toHaveLength(1));
    // 卡头：当前产品空间 + 过滤后计数（3 条里仅 1 条属于本空间）；断言域限定在待办快捷入口卡
    const todoCard = wrapper.find('[data-testid="wb-todo-quick"]');
    expect(todoCard.text()).toContain('当前产品空间：指纹锁空间 · 1 项');
    expect(todoCard.text()).toContain('签署阶段准入');
    expect(todoCard.text()).not.toContain('空间外任务甲');
    expect(todoCard.text()).not.toContain('空间外任务乙');
    // 真实接口参数（bucket=pending, limit=50）
    expect(vi.mocked(fetchWorkbenchTasks)).toHaveBeenCalledWith({ bucket: 'pending', limit: 50 });
    // 每条含 taskType / 状态 / 截止 + 「去处理」直达 deepLink
    expect(todoCard.text()).toContain(taskTypeText('stage_sign'));
    expect(todoCard.text()).toContain('进行中');
    expect(todoCard.text()).toContain('截止');
    await wrapper.find('[data-testid="wb-todo-go"]').trigger('click');
    expect(push).toHaveBeenCalledWith('/ipd/projects/2001/actions/7');
    wrapper.unmount();
  });

  it('产品空间为空：整块空态「暂无产品空间」，不渲染模拟下拉/示例数据', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubApis({ products: [], tasks: [] });
    const { wrapper } = mountWorkbench();

    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="workbench-space-empty"]').exists()).toBe(true),
    );
    expect(wrapper.text()).toContain('暂无产品空间');
    expect(wrapper.find('[data-testid="workbench-space-select"]').exists()).toBe(false);
    expect(wrapper.findAll('select option')).toHaveLength(0);
    expect(wrapper.find('[data-testid="wb-space-progress"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="wb-todo-quick"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('待办接口失败：「待办数据加载失败」+ 重试，不把失败渲染成 0/成功；重试成功后恢复列表', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubApis({
      actions: { '2001': [makeAction('a1', '2001', 'DONE')] },
      details: { '2001': makeProject('2001', 'Alpha 项目', 'DEV') },
      products: [productA],
      tasks: new Error('workbench tasks down'),
      workspaces: { 'sp-1': makeWorkspace(productA, [projectA]) },
    });
    const { wrapper } = mountWorkbench();

    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="wb-todo-quick-error"]').exists()).toBe(true),
    );
    const todoCard = wrapper.find('[data-testid="wb-todo-quick"]');
    expect(todoCard.text()).toContain('待办数据加载失败');
    // 失败不得假绿：不渲染空态成功、不渲染 0 计数、不渲染任务行
    expect(todoCard.text()).not.toContain('该产品空间暂无待办');
    expect(todoCard.text()).not.toContain('0 项');
    expect(todoCard.text()).not.toContain('去处理');
    expect(wrapper.findAll('[data-testid="wb-todo-item"]')).toHaveLength(0);

    // 真实重试按钮：点击重发请求，成功后渲染列表
    vi.mocked(fetchWorkbenchTasks).mockResolvedValue({
      bucket: 'pending',
      limit: 50,
      projectId: null,
      returned: 1,
      tasks: [makeTask('t-1', '2001', '签署阶段准入', '/ipd/projects/2001/actions/7')],
      total: 1,
      type: null,
    });
    await wrapper.find('[data-testid="wb-todo-quick-retry"]').trigger('click');
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="wb-todo-item"]')).toHaveLength(1));
    expect(todoCard.text()).toContain('当前产品空间：指纹锁空间 · 1 项');
    wrapper.unmount();
  });

  it('产品空间列表接口失败：产品空间加载失败 + 重试（不渲染模拟下拉）', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubApis({ products: new Error('products down'), tasks: [] });
    const { wrapper } = mountWorkbench();

    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="workbench-space-error"]').exists()).toBe(true),
    );
    expect(wrapper.text()).toContain('产品空间加载失败');
    expect(wrapper.find('[data-testid="workbench-space-select"]').exists()).toBe(false);

    vi.mocked(listProducts).mockResolvedValue([productA]);
    stubApis({
      actions: { '2001': [makeAction('a1', '2001', 'DONE')] },
      details: { '2001': makeProject('2001', 'Alpha 项目', 'DEV') },
      products: [productA],
      tasks: [],
      workspaces: { 'sp-1': makeWorkspace(productA, [projectA]) },
    });
    await wrapper.find('[data-testid="workbench-space-retry"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="workbench-space-select"]').exists()).toBe(true),
    );
    expect(wrapper.text()).toContain('Alpha 项目 · 阶段进度');
    wrapper.unmount();
  });
});
