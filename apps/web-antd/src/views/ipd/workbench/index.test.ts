/** 页03 我的工作台：聚合接口契约 + 身份问候 + 4 metric 卡 + 任务队列五态 + 治理待办计数。 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IpdPersonType } from '../../../api/ipd/auth';
import type { MyInitiatedTaskView, WorkbenchSummary } from '../../../api/ipd/workbench';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import Workbench from './index.vue';

const envelope = (data: unknown, status = 200, code = 0): Response => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const fullSummary: WorkbenchSummary = {
  // P1-4: fullSummary.stats 加 myInitiated: 4（与既有四字段并列）
  stats: { pending: 5, overdue: 2, unread: 3, completed: 7, myInitiated: 4 },
  tasks: [
    {
      id: '1', projectId: '10', projectName: 'Alpha 项目', projectCode: 'P-001',
      actionCode: 'A-1', title: '需求评审', taskType: 'stage_sign',
      status: 'IN_PROGRESS', priority: 'normal', ownerRole: 'MARKET_PM',
      dueDate: Date.now() + 86_400_000, isBlocking: '1', deepLink: '/ipd/projects/10/actions/1',
    },
    {
      id: '2', projectId: '10', projectName: 'Alpha 项目', projectCode: 'P-001',
      actionCode: 'A-2', title: '代码评审', taskType: 'stage_sign',
      status: 'NOT_STARTED', priority: 'normal', ownerRole: 'RD_PM',
      dueDate: Date.now() + 172_800_000, isBlocking: null, deepLink: '/ipd/projects/10/actions/2',
    },
  ],
  deletionPending: 2,
  currentAdvance: {
    projectId: '10', projectCode: 'P-001', projectName: 'Alpha 项目',
    currentStage: 'DEV', actionId: 'A-1', actionName: '实现阶段',
    actionStatus: 'IN_PROGRESS', deepLink: '/ipd/projects/10/actions/1',
  },
};

const emptySummary: WorkbenchSummary = {
  // P1-4: 空态也含 myInitiated: 0
  stats: { pending: 0, overdue: 0, unread: 0, completed: 0, myInitiated: 0 },
  tasks: [],
  deletionPending: 0,
  currentAdvance: null,
};

/** 「我发起的」明细（GET /workbench/my-initiated）。
 *  后端 WorkbenchService.myInitiated 真读 deletion_requests / launch_date_change_requests 两表，
 *  故这里给的是真实形状的行；status 取状态字典内的值，避免断言落在原样英文上。 */
const initiatedRows: MyInitiatedTaskView[] = [
  {
    id: 'DEL-77', taskType: 'DELETION', sourceId: '77', sourceTable: 'deletion_requests',
    title: '删除初审：project #10', status: 'LEADER_REVIEW', initiatorId: '1',
    approverId: null, createdAt: '2026-09-20T10:00:00Z',
  },
  {
    id: 'LD-88', taskType: 'LAUNCH_DATE', sourceId: '88', sourceTable: 'launch_date_change_requests',
    title: '上市日期变更：p10', status: 'ADMIN_REVIEW', initiatorId: '1',
    approverId: null, createdAt: '2026-09-21T10:00:00Z',
  },
];

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
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

function stubSummary(summary: WorkbenchSummary, error?: unknown): void {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.includes('/workbench/summary')) {
      if (error) throw error;
      return envelope(summary);
    }
    throw new Error(`unexpected fetch: ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
}

function metricValue(wrapper: VueWrapper, label: string): string | undefined {
  const card = wrapper.findAll('.ipd-metric-card').find((c) => c.text().includes(label));
  return card?.find('.ipd-metric-value').text();
}

describe('页03 我的工作台', () => {
  it('初始加载 happy path：fetchWorkbenchSummary 被调用且 4 metric 卡从「—」变为真实值', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubSummary(fullSummary);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => {
      const cards = wrapper.findAll('.ipd-metric-value');
      expect(cards.map((c) => c.text())).toEqual(['5', '2', '3', '7']);
    });
    expect(wrapper.text()).toContain('测试人员');
    expect(wrapper.text()).toContain('Alpha 项目');
    expect(wrapper.text()).toContain('需求评审');
    expect(wrapper.text()).toContain('打开任务教练');
    expect(wrapper.text()).toContain('2项待处理');
    expect(wrapper.text()).toContain('有 2 项删除申请待处理');
    wrapper.unmount();
  });

  it('请求失败：loadError 渲染聚合接口加载失败占位且 metric 卡保持「—」', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubSummary(fullSummary, new TypeError('network unavailable'));
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('聚合接口加载失败'));
    expect(wrapper.text()).toContain('无法连接服务');
    const placeholders = wrapper.findAll('.ipd-metric-value').map((c) => c.text());
    expect(placeholders).toEqual(['—', '—', '—', '—']);
    // 任务列表与当前推进被禁用：任务标题不出现，「打开任务教练」按钮处于禁用态
    expect(wrapper.text()).not.toContain('需求评审');
    const coachBtn = wrapper.findAll('button').find((b) => b.text().includes('打开任务教练'));
    expect(coachBtn).toBeDefined();
    expect(coachBtn!.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('空态：summary 返回空 stats + tasks 时 metric 卡为 0 且渲染空态文案', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubSummary(emptySummary);
    const wrapper = mount(Workbench);
    // 等待 metric 真正更新为 0（证明 summary 已加载且 reactive 更新完成）
    await vi.waitFor(() => expect(metricValue(wrapper, '待我处理')).toBe('0'));
    expect(metricValue(wrapper, '未读通知')).toBe('0');
    expect(metricValue(wrapper, '临期 / 超期')).toBe('0');
    expect(metricValue(wrapper, '已完成')).toBe('0');
    expect(wrapper.text()).toContain('暂无责任任务；已接入聚合器的任务到达会按责任链实时投递到这里。');
    expect(wrapper.text()).toContain('0项待处理');
    expect(wrapper.text()).toContain('暂无待处理删除审批');
    expect(wrapper.text()).toContain('尚无进行中的 IPD 动作');
    wrapper.unmount();
  });

  it('「我发起的」tab：渲染 /workbench/my-initiated 真明细（徽标数与渲染条数一致），空明细不误报「责任任务」', async () => {
    loginAs('MARKET_PM', '测试人员');
    /** summary 走真值；/workbench/tasks 故意失败 → 责任队列回退 summary.tasks（既有降级路径）。 */
    function stub(rows: MyInitiatedTaskView[]): void {
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes('/workbench/summary')) return envelope(fullSummary);
        if (path.includes('/workbench/my-initiated')) return envelope(rows);
        throw new Error(`unexpected fetch: ${path}`);
      });
      vi.stubGlobal('fetch', fetcher);
    }
    const initiatedTab = (w: VueWrapper) => w.findAll('button[role="tab"]').find((b) => b.text().includes('我发起的'));

    // 场景一：有 2 张我发起的单据
    stub(initiatedRows);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('需求评审'));
    await initiatedTab(wrapper)!.trigger('click');

    // 性质一：渲染的是真明细，不是任何「非队列提示」
    await vi.waitFor(() => expect(wrapper.text()).toContain('删除初审：project #10'));
    expect(wrapper.text()).toContain('上市日期变更：p10');
    expect(wrapper.text()).not.toContain('当前没有待处理事项');
    expect(wrapper.text()).not.toContain('我的关注后端未交付');
    // 责任队列的卡不再渲染（「我的当前推进」仍显示项目名，故按任务标题判定）
    expect(wrapper.text()).not.toContain('需求评审');
    expect(wrapper.text()).not.toContain('代码评审');
    // 发起时间不得被渲染成截止日（my-initiated 的 createdAt 不是期限）
    expect(wrapper.text()).not.toContain('09/20 截止');
    // 性质二：徽标数与渲染条数一致——徽标与面板不得互相否认
    const rendered = wrapper.findAll('.ipd-wb-task').length;
    expect(rendered).toBe(initiatedRows.length);
    expect(Number(initiatedTab(wrapper)!.find('.ipd-wb-tab-count').text())).toBe(rendered);
    // 切回「待我处理」恢复责任队列
    const pendingTab = wrapper.findAll('button[role="tab"]').find((b) => b.text().includes('待我处理'));
    await pendingTab!.trigger('click');
    expect(wrapper.text()).toContain('需求评审');
    wrapper.unmount();

    // 场景二：空明细 → 不得套用「责任任务」措辞，也不得回落到非队列提示
    stub([]);
    const empty = mount(Workbench);
    await vi.waitFor(() => expect(empty.text()).toContain('需求评审'));
    await initiatedTab(empty)!.trigger('click');
    await vi.waitFor(() => expect(empty.text()).toContain('暂无我发起的单据。'));
    expect(empty.text()).not.toContain('暂无责任任务');
    expect(empty.text()).not.toContain('当前没有待处理事项');
    empty.unmount();

    // 场景三：明细拉取失败 → 「不知道」不得渲染成「没有」（徽标此时回退 stats.myInitiated，
    // 若面板答「暂无我发起的单据」就与徽标打架）
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/workbench/summary')) return envelope(fullSummary);
      throw new TypeError('network unavailable');
    }));
    const failed = mount(Workbench);
    await vi.waitFor(() => expect(failed.text()).toContain('需求评审'));
    await initiatedTab(failed)!.trigger('click');
    await vi.waitFor(() => expect(failed.text()).toContain('我发起的明细加载失败'));
    expect(failed.text()).not.toContain('暂无我发起的单据');
    failed.unmount();
  });

  it('角色身份问候：4 种 personType 都正确显示人员姓名', async () => {
    const cases: Array<{ name: string; type: IpdPersonType }> = [
      { name: '组长甲', type: 'GROUP_LEADER' },
      { name: '市场乙', type: 'MARKET_PM' },
      { name: '研发丙', type: 'RD_PM' },
      { name: '超管丁', type: 'SUPER_ADMIN' },
    ];
    for (const { name, type } of cases) {
      loginAs(type, name);
      stubSummary(emptySummary);
      const wrapper = mount(Workbench);
      expect(wrapper.text(), `personType=${type}`).toContain(name);
      wrapper.unmount();
    }
  });

  it('未读通知 metric：stats.unread 真实反映到 metric 卡值', async () => {
    loginAs('MARKET_PM', '测试人员');
    const custom: WorkbenchSummary = {
      ...fullSummary,
      stats: { ...fullSummary.stats, unread: 42 },
    };
    stubSummary(custom);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(metricValue(wrapper, '未读通知')).toBe('42'));
    expect(metricValue(wrapper, '待我处理')).toBe('5');
    expect(metricValue(wrapper, '已完成')).toBe('7');
    wrapper.unmount();
  });

  it('再次挂载触发二次拉取：remount 等价于重新进入工作台', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubSummary(emptySummary);
    const first = mount(Workbench);
    await vi.waitFor(() => expect(metricValue(first, '待我处理')).toBe('0'));
    first.unmount();
    const second = mount(Workbench);
    await vi.waitFor(() => expect(metricValue(second, '待我处理')).toBe('0'));
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2);
    second.unmount();
  });

  it('P1-4：「我发起的」tab 徽标接 stats.myInitiated，count=4 渲染「4」', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubSummary(fullSummary);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('Alpha 项目'));
    // 「我发起的」tab 应包含 count 徽标 4
    const initiatedTab = wrapper.findAll('button[role="tab"]').find((b) => b.text().includes('我发起的'));
    expect(initiatedTab).toBeDefined();
    expect(initiatedTab!.text()).toContain('4');
    // 「我的关注」tab 仍保持 null 不渲染徽标（无数据模型，用户拍板停在这里）
    const followedTab = wrapper.findAll('button[role="tab"]').find((b) => b.text().includes('我的关注'));
    expect(followedTab).toBeDefined();
    // count 为 null 时不渲染 .ipd-wb-tab-count 徽标
    const followedBadge = followedTab!.find('.ipd-wb-tab-count');
    expect(followedBadge.exists()).toBe(false);
    wrapper.unmount();
  });

  it('P1-4：旧后端无 myInitiated 字段 → 「我发起的」count 兜底 0，模板 v-if="t.count" 不渲染徽标', async () => {
    loginAs('MARKET_PM', '测试人员');
    // 模拟旧后端：stats 不含 myInitiated 字段
    const legacy: WorkbenchSummary = {
      stats: { pending: 1, overdue: 0, unread: 0, completed: 0 },
      tasks: [],
      deletionPending: 0,
      currentAdvance: null,
    };
    stubSummary(legacy);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(metricValue(wrapper, '待我处理')).toBe('1'));
    const initiatedTab = wrapper.findAll('button[role="tab"]').find((b) => b.text().includes('我发起的'));
    expect(initiatedTab).toBeDefined();
    // 与既有 pending/overdue/completed tab 一致：v-if="t.count" 只在 count>0 时渲染徽标
    // 兜底 0 → 不渲染徽标（原文案「我发起的」后无数字），这是模板既有约定
    const badge = initiatedTab!.find('.ipd-wb-tab-count');
    expect(badge.exists()).toBe(false);
    wrapper.unmount();
  });

  it('待办按三类决定分组：删除审批进待我审核，阻断阶段动作进去决定', async () => {
    loginAs('GROUP_LEADER', '组长甲');
    const summary: WorkbenchSummary = {
      ...fullSummary,
      // P1-4: 该测试主要验 taskType 分组,myInitiated 与本测试无关
      stats: { pending: 3, overdue: 0, unread: 0, completed: 0, myInitiated: 0 },
      tasks: [
        fullSummary.tasks[0]!,
        {
          id: 'DEL-501', projectId: '', projectName: '删除审批', projectCode: 'project',
          actionCode: 'DEL-REVIEW-501', title: '删除初审：project #10', taskType: 'deletion_review',
          status: 'LEADER_REVIEW', priority: 'normal', ownerRole: null,
          dueDate: null, isBlocking: '1', deepLink: '/ipd/deletion/review',
        },
      ],
      deletionPending: 1,
    };
    stubSummary(summary);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('删除初审：project #10'));
    const groups = wrapper.findAll('.ipd-wb-group-title');
    expect(groups.map((g) => g.text())).toEqual([
      expect.stringContaining('待我审核'),
      expect.stringContaining('需要我补充事实'),
      expect.stringContaining('被阻断需我决定'),
    ]);
    const sections = wrapper.findAll('.ipd-wb-group');
    expect(sections[0]!.text()).toContain('删除初审：project #10');
    expect(sections[0]!.text()).toContain('去审核');
    expect(sections[2]!.text()).toContain('需求评审');
    expect(sections[2]!.text()).toContain('去决定');
    // kind 标签：LEADER_REVIEW → 待初审（状态字典）
    const kinds = wrapper.findAll('.ipd-wb-task-kind').map((k) => k.text());
    expect(kinds).toContain('待初审');
    // desc：deletion 卡显示字典文案「删除审批」且无「责任角色」；stage_sign 卡保留责任角色
    const descs = wrapper.findAll('.ipd-wb-task-desc').map((d) => d.text());
    expect(descs.some((d) => d.startsWith('删除审批 · 阻断项'))).toBe(true);
    // D6 白话化：ownerRole 裸码 MARKET_PM 经 roleText 显示为「市场PM」
    expect(descs.some((d) => d.includes('责任角色 市场PM'))).toBe(true);
    wrapper.unmount();
  });
});

// WB-17-1 S0：责任任务队列消费 GET /workbench/tasks 过滤视图（失败回退 /summary tasks）
describe('页03 责任任务队列 · GET /workbench/tasks（WB-17-1 S0）', () => {
  const tasksView = (tasks: WorkbenchSummary['tasks'], bucket: string) => ({
    bucket, type: null, projectId: null, limit: 50,
    total: tasks.length, returned: tasks.length, tasks,
  });

  function stubTasks(summary: WorkbenchSummary, tasksByBucket: Record<string, WorkbenchSummary['tasks']>) {
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      urls.push(path);
      if (path.includes('/workbench/summary')) return envelope(summary);
      if (path.includes('/workbench/tasks')) {
        const bucket = path.includes('bucket=overdue') ? 'overdue' : 'pending';
        return envelope(tasksView(tasksByBucket[bucket] ?? [], bucket));
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    return urls;
  }

  it('初始挂载即拉 /workbench/tasks?bucket=pending 并以过滤视图渲染队列', async () => {
    loginAs('MARKET_PM', '测试人员');
    const urls = stubTasks(fullSummary, {
      pending: [
        {
          id: 'T-1', projectId: '20', projectName: 'Beta 项目', projectCode: 'P-002',
          actionCode: 'A-9', title: '来自 tasks 端点的卡', taskType: 'stage_sign',
          status: 'IN_PROGRESS', priority: 'normal', ownerRole: 'RD_PM',
          dueDate: Date.now() + 86_400_000, isBlocking: '1', deepLink: '/ipd/projects/20/actions/9',
        },
      ],
      overdue: [],
    });
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('来自 tasks 端点的卡'));
    // 队列取自过滤视图而非 summary.tasks（summary 卡不再渲染）
    expect(wrapper.text()).not.toContain('需求评审');
    expect(urls.some((u) => u === '/api/v1/workbench/tasks?bucket=pending')).toBe(true);
    wrapper.unmount();
  });

  it('切到「临期/超期」tab 以 bucket=overdue 重拉，渲染后端过滤结果', async () => {
    loginAs('MARKET_PM', '测试人员');
    const urls = stubTasks(fullSummary, {
      pending: [],
      overdue: [
        {
          id: 'T-2', projectId: '20', projectName: 'Beta 项目', projectCode: 'P-002',
          actionCode: 'A-8', title: '已超期的卡', taskType: 'stage_sign',
          status: 'DELAYED', priority: 'high', ownerRole: 'RD_PM',
          dueDate: Date.now() - 86_400_000, isBlocking: '1', deepLink: '/ipd/projects/20/actions/8',
        },
      ],
    });
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(urls).toContain('/api/v1/workbench/tasks?bucket=pending'));
    const overdueTab = wrapper.findAll('button[role="tab"]').find((b) => b.text().includes('临期/超期'));
    expect(overdueTab).toBeDefined();
    await overdueTab!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('已超期的卡'));
    expect(urls).toContain('/api/v1/workbench/tasks?bucket=overdue');
    wrapper.unmount();
  });

  it('/workbench/tasks 失败：回退 summary.tasks 平铺（诚实降级，不空屏）', async () => {
    loginAs('MARKET_PM', '测试人员');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('/workbench/summary')) return envelope(fullSummary);
      if (path.includes('/workbench/tasks')) throw new TypeError('network unavailable');
      throw new Error(`unexpected fetch: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('需求评审'));
    expect(wrapper.text()).toContain('代码评审');
    wrapper.unmount();
  });
});

/* ---------------------------------------------------------------------------
 * 「界面说了话、后端兑现不了」批次（2026-10-03）
 *
 * 这一组断言保护的是「性质」而不是某句具体文案：
 *   1) 不得声称有数据（徽标有数 ≠ 有逐条明细）；
 *   2) 不得把「未交付」写成「你还没做某动作」式的指令型假信息；
 *   3) 不得为 null 编造一个看起来健康的状态码；
 *   4) 不得做出后端兑现不了的无条件承诺。
 * 有人把文案改回肯定句时会变红——变异自证见交付汇报。
 * ------------------------------------------------------------------------- */
describe('页03 工作台 · 未交付能力须如实表达（防假断言回归）', () => {
  /** 队列卡片内的提示块。治理区另有多处 .ipd-wb-empty，必须按容器收窄，否则取到别人。 */
  function queueNotice(wrapper: VueWrapper): string {
    return wrapper.find('.ipd-wb-queue-card .ipd-wb-empty').text();
  }

  function tab(wrapper: VueWrapper, label: string) {
    return wrapper.findAll('button[role="tab"]').find((b) => b.text().includes(label));
  }

  it('「已完成」tab：徽标保留真实计数，面板不得回答「当前没有待处理事项」', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubSummary(fullSummary); // stats.completed = 7
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('需求评审'));

    const completedTab = tab(wrapper, '已完成');
    expect(completedTab).toBeDefined();
    // 徽标那个数是真的（来自 summary），不许删
    expect(completedTab!.text()).toContain('7');

    await completedTab!.trigger('click');
    const notice = queueNotice(wrapper);
    // 性质一：不得否认同屏徽标——后端 /workbench/tasks 对 bucket=completed 显式 400，
    // 没有卡级完成明细，「当前没有待处理事项」回答的是另一件事
    expect(notice).not.toContain('当前没有待处理事项');
    // 性质二：必须如实声明「只有计数、逐条明细未交付」
    expect(notice).toContain('未交付');
    expect(notice).toContain('不做假数据');
    wrapper.unmount();
  });

  it('「我的关注」tab：不得指示用户去点一个不存在的收藏按钮', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubSummary(fullSummary);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('需求评审'));

    const followedTab = tab(wrapper, '我的关注');
    expect(followedTab).toBeDefined();
    await followedTab!.trigger('click');

    const notice = queueNotice(wrapper);
    // 性质：前端源码无收藏入口、后端无收藏数据模型 → 不得把「未交付」写成「你还没收藏」
    expect(notice).not.toContain('点击收藏');
    expect(notice).not.toContain('动作工作区');
    expect(notice).toContain('未交付');
    wrapper.unmount();
  });

  it('currentAdvance.actionStatus 为 null：不得伪造状态码 IDLE，须说出真实含义', async () => {
    loginAs('MARKET_PM', '测试人员');
    // 后端 WorkbenchService.currentAdvance：next != null ? next.getStatus() : null
    // —— 有项目但无「在途 且 命中本角色」的动作时，actionStatus 就是 null
    const noAction: WorkbenchSummary = {
      ...fullSummary,
      currentAdvance: {
        ...fullSummary.currentAdvance!,
        actionId: null,
        actionName: null,
        actionStatus: null,
        deepLink: '/ipd/projects/10/flow',
      },
    };
    stubSummary(noAction);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('Alpha 项目'));

    const meta = wrapper.find('.ipd-wb-current-meta').text();
    // 性质一：null 不得被渲染成一个看起来健康的状态码
    expect(meta).not.toContain('IDLE');
    expect(meta).not.toMatch(/[A-Z_]{3,}/);
    // 性质二：不得留白，必须给出真实含义（可能意味着动作没派给你或缺责任人）
    expect(meta).toContain('没有在途动作命中你的角色');
    wrapper.unmount();
  });

  it('跨角色接力承诺收窄：7 类无生产者的任务类型须被点名且标注未交付', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubSummary(fullSummary);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('需求评审'));

    const text = wrapper.find('.ipd-wb-handoff').text();
    // 性质一：不得再出现后端兑现不了的无条件承诺
    expect(text).not.toContain('每次状态变化会同时完成当前任务');
    // 性质二：必须说明适用范围 + 点名未接入的类型
    expect(text).toContain('未交付');
    expect(text).toContain('共 7 类');
    expect(text).toMatch(/豁免审批|研发替补|退役评审|回执审核|产能审批|变更实施|变更验收/);
    wrapper.unmount();
  });

  it('「无实质产出提醒」：不得渲染名单，须声明后端未交付', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubSummary(fullSummary);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('需求评审'));

    const text = wrapper.find('.ipd-wb-governance').text();
    // 性质：名单数据源不存在 → 必须声明未交付，且不得渲染任何具体人名/项目行
    expect(text).toContain('未交付');
    expect(text).toContain('不做假数据');
    expect(wrapper.findAll('.ipd-wb-nooutput li').length).toBe(0);
    wrapper.unmount();
  });
});

describe('R232 P2-04 站内待办接线（待办直达 AI 审批卡）', () => {
  it('「站内待办」按钮打开抽屉：收件箱（NotificationService 载荷）+ 任务时间线按项目加载', async () => {
    loginAs('MARKET_PM', '测试人员');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('/workbench/summary')) return envelope(fullSummary);
      return envelope([]);
    });
    vi.stubGlobal('fetch', fetcher);
    const wrapper = mount(Workbench, { attachTo: document.body });
    await vi.waitFor(() => expect(wrapper.find('[data-testid="workbench-todo-btn"]').exists()).toBe(true));
    expect(document.body.textContent ?? '').not.toContain('待我处理（kind=ACTION）');
    await wrapper.find('[data-testid="workbench-todo-btn"]').trigger('click');
    // 抽屉 teleports 到 body：待办区块出现 = 抽屉已开
    await vi.waitFor(() => {
      expect(document.body.textContent ?? '').toContain('待我处理（kind=ACTION）');
    });
    // 数据面复用 NotificationService 载荷（GET /api/v1/notifications）+ R221 任务列表（?projectId=10）；
    // 两请求异步分批到达，waitFor 等齐（抽屉标题是静态渲染，不能作请求就绪信号）
    await vi.waitFor(() => {
      const urls = fetcher.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('/api/v1/notifications'))).toBe(true);
      expect(urls.some((u) => u.includes('/api/v1/ai-agent-tasks?projectId=10'))).toBe(true);
    });
    wrapper.unmount();
  });
});
