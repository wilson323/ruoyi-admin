// 页37 全流程轨迹（卡 ZK-D2）：三源融合时间线的组件级契约。
//
// 断言范围：
// - 三源（审计 / 工作台 / 奖金池）数据 → 时间线按时间倒序合并渲染；
// - 单源失败时其余两源仍渲染（Promise.allSettled 优雅降级）；
// - 三源全空时落「暂无事件」空态；
// - 类别 Tag 颜色 / 文案与状态机字段对齐（蓝=审计 / 绿=工作台 / 金=奖金池）；
// - 跨源混排而非按 source 分组（验证 toMillis 对 number ms / ISO string 统一处理）；
// - 类别 / 关键词筛选：仅保留目标类别 / 关键词的条目。

import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Timeline from './index.vue';

const envelope = (data: unknown, status = 200, code = 0) => new Response(
  JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const emptyAudit = () => ({ scope: 'OWN' as const, operatorIds: [], page: { records: [], total: 0, current: 1, size: 20, pages: 0 } });
const emptySummary = () => ({ stats: { pending: 0, overdue: 0, unread: 0, completed: 0 }, tasks: [], deletionPending: 0, currentAdvance: null });
const currentAdvance = { projectId: 'P-7', projectCode: null, projectName: '融合演示项目', currentStage: 'DEV', actionId: 'A-100', actionName: '需求评审', actionStatus: 'PENDING', deepLink: '/ipd/project/P-7' };

const auditLogs = [
  { id: 'A2', seq: 102, operatorId: '7', operatorName: '张三', operatorRole: 'SUPER_ADMIN', action: 'APPROVE', entityType: 'projects', entityId: 'P-7', createTime: 1_700_000_000_000 },
  { id: 'A1', seq: 101, operatorId: '5', operatorName: '李四', operatorRole: 'PM', action: 'CREATE', entityType: 'demands', entityId: 'D-9', reason: '客户首提', createTime: 1_699_900_000_000 },
];

const workbenchTasks = [
  { id: 'T1', projectId: 'P-7', projectName: '融合演示项目', projectCode: null, actionCode: 'A-100', title: '需求评审', taskType: 'STAGE_ACTION', status: 'PENDING', priority: 'high', ownerRole: 'MARKET_PM', dueDate: '2026-09-08T10:00:00Z', isBlocking: null, deepLink: '/ipd/project/P-7?action=A-100' },
];

const bonusPools = [
  { id: 'B-1', projectId: 'P-7', projectLevel: 'B', status: 'CONFIRMED', period: '2026Q3', poolRate: '0.05', basePool: '120000.00', coefficient: '1.10', tierCoefficient: '1.0', levelCoefficient: '1.0', achievementRate: '1.0', finalPool: '132000.00', targetSales: null, receiptAmounts: '2400000.00', contributionMarketMin: null, contributionRdMax: null, createTime: '2026-09-05T08:00:00Z' },
];

interface FetchHandlers {
  audit?: () => Response | Promise<Response>;
  summary?: () => Response | Promise<Response>;
  bonus?: () => Response | Promise<Response>;
}

function stubFetch(handlers: FetchHandlers = {}) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && url.startsWith('/api/v1/audit-logs/scope')) {
      return await (handlers.audit ?? (() => envelope(emptyAudit())))();
    }
    if (method === 'GET' && url.startsWith('/api/v1/workbench/summary')) {
      return await (handlers.summary ?? (() => envelope(emptySummary())))();
    }
    if (method === 'GET' && url.startsWith('/api/v1/bonus-pool/list')) {
      return await (handlers.bonus ?? (() => envelope([])))();
    }
    return envelope(null, 404, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

// 三源融合完成收敛：audit + summary 已发出，让出 microtask + 一次 macrotask 收尾。
// 奖金池是顺序调用（项目 ID 推断后），最坏情况需一次额外 macrotask 才进入 finally。
async function mountTimeline(): Promise<{ fetcher: ReturnType<typeof stubFetch>; wrapper: VueWrapper }> {
  const fetcher = (globalThis.fetch as ReturnType<typeof vi.fn>);
  const wrapper = mount(Timeline);
  await vi.waitFor(() => {
    const urls = fetcher.mock.calls.map(([u]) => String(u));
    const ready = urls.some((u) => u.includes('/audit-logs/scope'))
      && urls.some((u) => u.includes('/workbench/summary'));
    if (!ready) throw new Error('audit/summary not yet called');
  }, { timeout: 5000, interval: 20 });
  for (let i = 0; i < 5; i++) await wrapper.vm.$nextTick();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await wrapper.vm.$nextTick();
  return { fetcher, wrapper };
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('页37 全流程轨迹（三源融合）', () => {
  it('三源齐备：按时间倒序合并渲染，类别标签颜色与文案对齐', async () => {
    const fetcher = stubFetch({
      audit: () => envelope({ scope: 'GLOBAL', operatorIds: ['7'], page: { records: auditLogs, total: 2, current: 1, size: 20, pages: 1 } }),
      summary: () => envelope({ ...emptySummary(), tasks: workbenchTasks, currentAdvance }),
      bonus: () => envelope(bonusPools),
    });
    const { wrapper } = await mountTimeline();
    const text = wrapper.text();
    expect(text).toContain('审计：2');
    expect(text).toContain('工作台待办：1');
    expect(text).toContain('奖金池：1');
    expect(text).toContain('审计分层：GLOBAL');
    expect(text).toContain('张三');
    expect(text).toContain('APPROVE');
    expect(text).toContain('李四');
    expect(text).toContain('需求评审');
    expect(text).toContain('奖金池 #B-1');
    expect(text).toContain('CONFIRMED');
    const tagTexts = wrapper.findAll('.ant-tag').map((node) => node.text());
    expect(tagTexts.filter((t) => t === '审计事件').length).toBe(2);
    expect(tagTexts.filter((t) => t === '工作台待办').length).toBe(1);
    expect(tagTexts.filter((t) => t === '奖金池').length).toBe(1);
    const items = wrapper.findAll('.ant-timeline-item');
    expect(items.length).toBe(4);
    // 时间倒序：工作台（2026-09-08）> 奖金池（2026-09-05）> 审计 A2（2023-11）> 审计 A1（2023-11）
    expect(items[0]?.text()).toContain('需求评审');
    expect(items[1]?.text()).toContain('奖金池 #B-1');
    expect(items[2]?.text()).toContain('张三');
    expect(items[items.length - 1]?.text()).toContain('李四');
    expect(items[0]?.text()).toContain('工作台待办');
    expect(items[1]?.text()).toContain('奖金池');
    expect(items[2]?.text()).toContain('审计事件');
    expect(items[3]?.text()).toContain('审计事件');
    expect(fetcher.mock.calls.some(([u]) => String(u).includes('/bonus-pool/list'))).toBe(true);
    wrapper.unmount();
  });

  it('单源失败：审计抛错时工作台 + 奖金池仍渲染，不出现「全部失败」错误条', async () => {
    stubFetch({
      audit: () => new Response(JSON.stringify({}), { status: 500, headers: { 'Content-Type': 'application/json' } }),
      summary: () => envelope({ ...emptySummary(), tasks: workbenchTasks, currentAdvance }),
      bonus: () => envelope(bonusPools),
    });
    const { wrapper } = await mountTimeline();
    const text = wrapper.text();
    expect(text).toContain('工作台待办：1');
    expect(text).toContain('奖金池：1');
    expect(text).toContain('审计：0');
    expect(text).toContain('需求评审');
    expect(text).toContain('奖金池 #B-1');
    expect(wrapper.find('.ant-alert-error').exists()).toBe(false);
    expect(wrapper.find('.ant-alert-warning').exists()).toBe(false);
    wrapper.unmount();
  });

  it('单源失败：奖金池抛错时被静默吞掉，审计 + 工作台正常渲染', async () => {
    const fetcher = stubFetch({
      audit: () => envelope({ scope: 'GROUP', operatorIds: [], page: { records: auditLogs, total: 2, current: 1, size: 20, pages: 1 } }),
      summary: () => envelope({ ...emptySummary(), tasks: workbenchTasks, currentAdvance: { ...currentAdvance, actionId: null, actionName: null, actionStatus: null, deepLink: '' } }),
      bonus: () => { throw new Error('bonus-pool down'); },
    });
    const { wrapper } = await mountTimeline();
    const text = wrapper.text();
    expect(text).toContain('审计：2');
    expect(text).toContain('工作台待办：1');
    expect(text).toContain('奖金池：0');
    expect(text).toContain('审计分层：GROUP');
    expect(text).not.toContain('奖金池 #B-1');
    expect(fetcher.mock.calls.some(([u]) => String(u).includes('/bonus-pool/list'))).toBe(true);
    wrapper.unmount();
  });

  it('三源全空：渲染「暂无事件」空态且无错误条', async () => {
    stubFetch({
      audit: () => envelope({ scope: 'OWN', operatorIds: [], page: { records: [], total: 0, current: 1, size: 20, pages: 0 } }),
      summary: () => envelope(emptySummary()),
      bonus: () => envelope([]),
    });
    const { wrapper } = await mountTimeline();
    expect(wrapper.text()).toContain('暂无事件');
    expect(wrapper.text()).toContain('审计：0');
    expect(wrapper.text()).toContain('工作台待办：0');
    expect(wrapper.text()).toContain('奖金池：0');
    expect(wrapper.text()).toContain('审计分层：OWN');
    expect(wrapper.find('.ant-timeline-item').exists()).toBe(false);
    expect(wrapper.find('.ant-alert-error').exists()).toBe(false);
    expect(wrapper.find('.ant-alert-warning').exists()).toBe(false);
    wrapper.unmount();
  });

  it('类别筛选：仅 BONUS 时其余两源条目不出现在 Timeline 中', async () => {
    const fetcher = stubFetch({
      audit: () => envelope({ scope: 'GLOBAL', operatorIds: [], page: { records: auditLogs, total: 2, current: 1, size: 20, pages: 1 } }),
      summary: () => envelope({ ...emptySummary(), tasks: workbenchTasks, currentAdvance: null }),
      bonus: () => envelope(bonusPools),
    });
    const { wrapper } = await mountTimeline();
    expect(wrapper.findAll('.ant-timeline-item').length).toBe(4);
    // happy-dom 下 ant-design-vue Select 的 dropdown 不可见；用 $emit('update:value', ...) 直接走 v-model 路径
    const select = wrapper.findComponent({ name: 'ASelect' });
    expect(select.exists()).toBe(true);
    (select.vm as unknown as { $emit: (event: string, ...args: unknown[]) => void }).$emit('update:value', 'BONUS');
    await wrapper.vm.$nextTick();
    const items = wrapper.findAll('.ant-timeline-item');
    expect(items.length).toBe(1);
    expect(items[0]?.text()).toContain('奖金池 #B-1');
    expect(items[0]?.text()).not.toContain('APPROVE');
    expect(items[0]?.text()).not.toContain('需求评审');
    expect(fetcher.mock.calls.some(([u]) => String(u).includes('/bonus-pool/list'))).toBe(true);
    wrapper.unmount();
  });

  it('关键词筛选：按「张三」过滤后仅保留审计 A2 一条', async () => {
    const fetcher = stubFetch({
      audit: () => envelope({ scope: 'GLOBAL', operatorIds: [], page: { records: auditLogs, total: 2, current: 1, size: 20, pages: 1 } }),
      summary: () => envelope({ ...emptySummary(), tasks: workbenchTasks, currentAdvance: { ...currentAdvance, actionId: null, actionName: null, actionStatus: null, deepLink: '' } }),
      bonus: () => envelope(bonusPools),
    });
    const { wrapper } = await mountTimeline();
    const input = wrapper.find('input[placeholder="摘要 / 操作人 / 实体"]');
    expect(input.exists()).toBe(true);
    await input.setValue('张三');
    await wrapper.vm.$nextTick();
    const items = wrapper.findAll('.ant-timeline-item');
    expect(items.length).toBe(1);
    expect(items[0]?.text()).toContain('张三');
    expect(items[0]?.text()).toContain('APPROVE');
    expect(fetcher.mock.calls.some(([u]) => String(u).includes('/bonus-pool/list'))).toBe(true);
    wrapper.unmount();
  });

  it('时间倒序：跨源混排而非按 source 分组（A1 最旧须排最末）', async () => {
    // 工作台 dueDate 设成介于两条审计毫秒之间（验证 toMillis 对 number ms / ISO string 统一处理）
    const interleavedTasks = [{
      ...workbenchTasks[0]!,
      dueDate: new Date(1_699_950_000_000).toISOString(),
    }];
    const fetcher = stubFetch({
      audit: () => envelope({ scope: 'GLOBAL', operatorIds: [], page: { records: auditLogs, total: 2, current: 1, size: 20, pages: 1 } }),
      summary: () => envelope({ ...emptySummary(), tasks: interleavedTasks, currentAdvance: null }),
      bonus: () => envelope([]),
    });
    const { wrapper } = await mountTimeline();
    const items = wrapper.findAll('.ant-timeline-item');
    expect(items.length).toBe(3);
    // 顺序：A2（1_700_000_000_000 最新）→ 工作台（1_699_950_000_000）→ A1（1_699_900_000_000 最旧）
    expect(items[0]?.text()).toContain('张三');
    expect(items[1]?.text()).toContain('需求评审');
    expect(items[2]?.text()).toContain('李四');
    expect(items[0]?.text()).toContain('审计事件');
    expect(items[1]?.text()).toContain('工作台待办');
    expect(items[2]?.text()).toContain('审计事件');
    expect(fetcher.mock.calls.some(([u]) => String(u).includes('/bonus-pool/list'))).toBe(true);
    wrapper.unmount();
  });
});
