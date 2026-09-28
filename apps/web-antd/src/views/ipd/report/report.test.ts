// 报表分析页组件级验证：mock 真实 /api/v1/report 契约（project-summary/export/*），
// 断言月度汇总表渲染、month 必填查询参数、项目汇总导出、奖金导出权限位
// （非组长隐藏）与原型 analytics 区登记文案。

import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiSuggest } from '../../../api/ipd/ai-suggest';
import Report from './index.vue';

// 模块层 mock：L2 AI 建议入口（C08 零直写——建议调用替换为 vi.fn，不触达网络）。
vi.mock('../../../api/ipd/ai-suggest', () => ({ aiSuggest: vi.fn() }));

const response = (data: unknown, status = 200, code = 0, message?: string) => new Response(
  JSON.stringify({ code, message: message ?? (code ? '请求不合法' : 'success'), data, timestamp: '2026-09-06T00:00:00Z', traceId: 'fixture' }),
  { status, headers: { 'Content-Type': 'application/json' } },
);

const summaryRow = {
  allowanceFinalAmount: '12800.50',
  allowanceRowCount: 2,
  avgWeightedScore: '86.4',
  bonusFinalPool: '36000',
  bonusRowCount: 1,
  month: '2026-08',
  projectCode: 'P-001',
  projectId: '1',
  projectName: '演示项目',
  scoreRowCount: 2,
};

const exportResult = {
  exportedAt: '2026-09-06T08:30:00Z',
  exportedBy: '超级管理员',
  exportType: 'PROJECT_SUMMARY',
  filters: { month: '2026-08' },
  headers: ['项目编号', '项目名称', '津贴核算', '奖金池'],
  rows: [{ '项目编号': 'P-001' }],
  totalCount: 1,
};

beforeEach(() => { setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** 幂等 mock：按 month 分发，导出端点返回结构化结果。 */
function stubApi() {
  setActivePinia(createPinia());
  const calls: { method: string; url: string }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ method: 'GET', url });
    if (url.startsWith('/api/v1/report/project-summary')) {
      // 两页数据：供翻页用例验证 pageNo 递增
      return response({ current: 1, pages: 2, records: [summaryRow], size: 20, total: 25 });
    }
    if (url.startsWith('/api/v1/report/export/')) return response(exportResult);
    return response(null, 404, 40400);
  });
  vi.stubGlobal('fetch', fetcher);
  return calls;
}

describe('IPD report page (prototype ProcessAnalyticsPage adaptation)', () => {
  it('renders the monthly summary table with real contract data', async () => {
    stubApi();
    const wrapper = mount(Report);
    await vi.waitFor(() => expect(wrapper.text()).toContain('演示项目'));
    // 原型 Frame 标题/副标题原文
    expect(wrapper.text()).toContain('报表分析');
    expect(wrapper.text()).toContain('不公开个人排行榜');
    // 汇总行：金额两位小数 + 行数 + 加权分
    expect(wrapper.text()).toContain('P-001');
    expect(wrapper.text()).toContain('12,800.50');
    expect(wrapper.text()).toContain('36,000.00');
    expect(wrapper.text()).toContain('86.4');
    // 奖金导出权限位：未登录（无身份）不显示导出按钮
    expect(wrapper.text()).toContain('奖金台账仅组长/超管可导出');
    wrapper.unmount();
  });

  it('queries with the month parameter and paginates', async () => {
    const calls = stubApi();
    const wrapper = mount(Report);
    await vi.waitFor(() => expect(wrapper.text()).toContain('演示项目'));
    const first = calls.find((call) => call.url.includes('project-summary'));
    // 页面默认当前月（currentMonth()），此处只验参数形态不锁具体月份
    expect(first?.url).toMatch(/month=\d{4}-\d{2}/);
    expect(first?.url).toContain('pageNo=1');
    expect(first?.url).toContain('pageSize=20');
    // 翻页请求带页码
    await wrapper.findAll('button').find((button) => button.text() === '下一页')!.trigger('click');
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url.includes('pageNo=2'))).toBe(true);
    });
    wrapper.unmount();
  });

  it('exports the project summary through the real endpoint', async () => {
    stubApi();
    const wrapper = mount(Report);
    await vi.waitFor(() => expect(wrapper.text()).toContain('演示项目'));
    await wrapper.findAll('button').find((button) => button.text().includes('项目汇总导出'))!.trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('导出结果 · PROJECT_SUMMARY'));
    expect(wrapper.text()).toContain('项目编号');
    expect(wrapper.text()).toContain('超级管理员');
    wrapper.unmount();
  });

  it('renders the prototype analytics shell with pending registration', async () => {
    stubApi();
    const wrapper = mount(Report);
    await vi.waitFor(() => expect(wrapper.text()).toContain('演示项目'));
    // 原型四卡与建议卡原文；数值区显示「—」不造假
    expect(wrapper.text()).toContain('一次质量通过率');
    expect(wrapper.text()).toContain('审批退回率');
    expect(wrapper.text()).toContain('招募平均周期');
    expect(wrapper.text()).toContain('流程事件');
    expect(wrapper.text()).toContain('优先治理高频质量退回动作');
    expect(wrapper.text()).toContain('缩短跨角色审批等待');
    expect(wrapper.text()).toContain('正在积累周期样本');
    // 真缺口登记条
    expect(wrapper.text()).toContain('/api/analytics/process');
    wrapper.unmount();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// L2 每页 AI 入口（2026-09-28）：report.trend-analyze（userPrompt 素材必填）
// ──────────────────────────────────────────────────────────────────────────────

/** L2 AI 测试视图：非结构化场景（无卡）+ 非降级 → 纯文本 + 「采纳到表单」按钮。 */
const suggestView = (scene: string, markdown: string) => ({
  aiModel: 'mock-mini', card: null, completionTokens: 1, degraded: false,
  latencyMs: 5, markdown, promptTokens: 1, scene,
});

describe('L2 AI 入口（report.trend-analyze）', () => {
  it('report.trend-analyze：按钮存在、素材触发 scene、adopt 回传宿主（C08 零直写）', async () => {
    const aiSuggestMock = vi.mocked(aiSuggest);
    aiSuggestMock.mockReset();
    aiSuggestMock.mockResolvedValue(suggestView('report.trend-analyze', '## 趋势分析\n- 连续三月上升'));
    // 自写 fetch 记录器：保留 method 供 C08 零写断言（stubApi 固定记 GET 不够力）
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ method: (init?.method ?? 'GET').toUpperCase(), url });
      if (url.startsWith('/api/v1/report/project-summary')) {
        return response({ current: 1, pages: 1, records: [summaryRow], size: 20, total: 1 });
      }
      return response(null, 404, 40400);
    }));
    const wrapper = mount(Report);
    await vi.waitFor(() => expect(wrapper.text()).toContain('演示项目'));

    // ① 按钮存在（同页已挂 report.nl-query，趋势入口并列）
    const runBtn = wrapper.find('[data-testid="report-ai-trend"] [data-testid="ai-suggest-run"]');
    expect(runBtn.exists()).toBe(true);
    expect(runBtn.text()).toContain('AI 报表趋势分析');

    // ② 触发 scene 正确（needsPrompt：先填素材再发起）
    await wrapper.get('[data-testid="report-ai-trend"] [data-testid="ai-suggest-prompt"]')
      .setValue('近三月奖金池 30k→33k→36k');
    await runBtn.trigger('click');
    await vi.waitFor(() => expect(aiSuggestMock).toHaveBeenCalledWith(
      'report.trend-analyze',
      expect.objectContaining({ userPrompt: '近三月奖金池 30k→33k→36k' }),
    ));

    // ③ adopt 回传宿主（仅本地提示，不写库）
    await wrapper.get('[data-testid="report-ai-trend"] [data-testid="ai-suggest-adopt"]').trigger('click');
    const ack = wrapper.find('[data-testid="report-ai-adopted"]');
    expect(ack.exists()).toBe(true);
    expect(ack.text()).toContain('已回传宿主');
    expect(ack.text()).toContain('report.trend-analyze');
    expect(ack.text()).toContain('不写库');
    // C08 零直写：导出登记等写端点零触达，页面侧只见读请求
    expect(calls.some((call) => call.url.includes('/export/'))).toBe(false);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    wrapper.unmount();
  });
});
