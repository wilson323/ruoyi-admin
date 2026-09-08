/** 页03 我的工作台：聚合接口契约 + 身份问候 + 4 metric 卡 + 任务队列五态 + 治理待办计数。 */
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IpdPersonType } from '../../../api/ipd/auth';
import type { WorkbenchSummary } from '../../../api/ipd/workbench';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import Workbench from './index.vue';

const envelope = (data: unknown, status = 200, code = 0): Response => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const fullSummary: WorkbenchSummary = {
  stats: { pending: 5, overdue: 2, unread: 3, completed: 7 },
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
  stats: { pending: 0, overdue: 0, unread: 0, completed: 0 },
  tasks: [],
  deletionPending: 0,
  currentAdvance: null,
};

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
    expect(wrapper.text()).toContain('暂无责任任务；任务到达会按责任链实时投递到这里。');
    expect(wrapper.text()).toContain('0项待处理');
    expect(wrapper.text()).toContain('暂无待处理删除审批');
    expect(wrapper.text()).toContain('尚无进行中的 IPD 动作');
    wrapper.unmount();
  });

  it('Tab 切换：非 pending / overdue tab 渲染文案占位而非任务列表', async () => {
    loginAs('MARKET_PM', '测试人员');
    stubSummary(fullSummary);
    const wrapper = mount(Workbench);
    await vi.waitFor(() => expect(wrapper.text()).toContain('需求评审'));
    // 点击「我发起的」tab（count 为 null 不渲染徽标），任务列表被文案占位替换
    const initiatedTab = wrapper.findAll('button[role="tab"]').find((b) => b.text().includes('我发起的'));
    expect(initiatedTab).toBeDefined();
    await initiatedTab!.trigger('click');
    expect(wrapper.text()).toContain('当前没有待处理事项；新的动作、审批、移交、绩效或整改责任会自动投递到这里。');
    // 任务标题与项目分组不再渲染（注意：「我的当前推进」仍会显示项目名，故按任务标题判定）
    expect(wrapper.text()).not.toContain('需求评审');
    expect(wrapper.text()).not.toContain('代码评审');
    // 切回 pending 看到任务
    const pendingTab = wrapper.findAll('button[role="tab"]').find((b) => b.text().includes('待我处理'));
    await pendingTab!.trigger('click');
    expect(wrapper.text()).toContain('需求评审');
    wrapper.unmount();
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

  it('WB-17-1 P0：deletion_review 任务卡按「删除审批」分组，desc 用 17 类字典文案，kind 显示待初审', async () => {
    loginAs('GROUP_LEADER', '组长甲');
    const summary: WorkbenchSummary = {
      ...fullSummary,
      stats: { pending: 3, overdue: 0, unread: 0, completed: 0 },
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
    // 分组：删除审批独立成组（projectName 分组口径，B4 拍板②）
    const groups = wrapper.findAll('.ipd-wb-group-title');
    expect(groups.some((g) => g.text().includes('删除审批'))).toBe(true);
    // kind 标签：LEADER_REVIEW → 待初审（状态字典）
    const kinds = wrapper.findAll('.ipd-wb-task-kind').map((k) => k.text());
    expect(kinds).toContain('待初审');
    // desc：deletion 卡显示字典文案「删除审批」且无「责任角色」；stage_sign 卡保留责任角色
    const descs = wrapper.findAll('.ipd-wb-task-desc').map((d) => d.text());
    expect(descs.some((d) => d.startsWith('删除审批 · 阻断项'))).toBe(true);
    expect(descs.some((d) => d.includes('责任角色 MARKET_PM'))).toBe(true);
    wrapper.unmount();
  });
});
