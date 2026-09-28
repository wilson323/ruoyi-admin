/**
 * Gate 评审材料 AI 预审 API 契约测试（AI-P2-1；后端 GatePrecheckController POST /gates/{gateId}/precheck）。
 *
 * 重点覆盖：
 * - runGatePrecheck：无请求体 POST、gateId 路径编码；
 * - 载荷透传 summary / items / materials / aiChecklist / blocking / decisionWritten；
 * - degraded 分支（AI 失败仍返回结构化统计）；错误传播；
 * - runArbitrationDivergences（R240）：分歧行 + AI 归纳透传，零分歧/AI 降级分支。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import {
  runArbitrationDivergences,
  runGatePrecheck,
  type GateArbitrationDivergencesView,
  type GatePrecheckView,
} from './gate-precheck';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-27T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const precheckFixture = (overrides: Partial<GatePrecheckView> = {}): GatePrecheckView => ({
  aiChecklist: { aiModel: 'intent_match', degraded: false, markdown: '- 检查清单' },
  blocking: false,
  decisionWritten: false,
  gateCode: 'GATE-CONCEPT',
  gateId: '5',
  items: [
    {
      conditionNote: null,
      evidenceRef: 'oss://evi/1',
      elementId: 'e-1',
      leftoverStatus: null,
      result: 'PASS',
      status: 'COVERED',
    },
  ],
  latencyMs: 12,
  materials: {
    gateId: '5',
    isReady: true,
    items: [{ actionCode: 'ACT-1', actionId: 'a-1', actionName: '市场需求评审', isReady: true, required: 1, uploaded: 1 }],
    missing: 0,
    projectId: '101',
    total: 1,
    uploaded: 1,
  },
  projectId: '101',
  summary: { covered: 1, missing: 0, partial: 0, total: 1 },
  ...overrides,
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('gate-precheck API — runGatePrecheck', () => {
  it('POST /gates/{gateId}/precheck：无请求体，gateId 编码进路径', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(precheckFixture()));
    vi.stubGlobal('fetch', fetcher);
    await runGatePrecheck('5');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/gates/5/precheck');
    expect((fetcher.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe('POST');
    // 卡面硬约束：无请求体（不写 Gate 决策、无状态变更）
    expect((fetcher.mock.calls[0]?.[1] as RequestInit | undefined)?.body).toBeUndefined();
  });

  it('载荷透传：summary 计数 + items 证据定位 + blocking/decisionWritten 恒 false', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(precheckFixture()));
    vi.stubGlobal('fetch', fetcher);
    const view = await runGatePrecheck('5');
    expect(view.summary).toEqual({ covered: 1, missing: 0, partial: 0, total: 1 });
    expect(view.items[0]).toMatchObject({ elementId: 'e-1', status: 'COVERED', evidenceRef: 'oss://evi/1' });
    expect(view.blocking).toBe(false);
    expect(view.decisionWritten).toBe(false);
  });

  it('AI 降级分支：aiChecklist.degraded=true 且结构化统计照常返回', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(precheckFixture({
      aiChecklist: { aiModel: null, degraded: true, markdown: 'AI 预审清单暂不可用' },
    })));
    vi.stubGlobal('fetch', fetcher);
    const view = await runGatePrecheck('5');
    expect(view.aiChecklist.degraded).toBe(true);
    expect(view.summary.total).toBe(1);
  });

  it('错误传播：HTTP 500 + envelope.code != 0 抛 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 500, 90001));
    vi.stubGlobal('fetch', fetcher);
    await expect(runGatePrecheck('5')).rejects.toBeInstanceOf(IpdRequestError);
  });
});

describe('gate-precheck API — runArbitrationDivergences', () => {
  const arbitrationFixture = (
    overrides: Partial<GateArbitrationDivergencesView> = {},
  ): GateArbitrationDivergencesView => ({
    aiSummary: { aiModel: 'test-model', degraded: false, markdown: '- 轮1：温测口径分歧' },
    blocking: false,
    decisionWritten: false,
    divergences: [
      { marketDecision: 'APPROVE', marketOpinion: '按计划走', round: 1, rdDecision: 'REJECT', rdOpinion: '样机未过温测' },
    ],
    gateId: '5',
    latencyMs: 88,
    round: 2,
    ...overrides,
  });

  it('POST /gates/{gateId}/arbitration-divergences：无请求体（只读参考）+ id 字符串透传', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(arbitrationFixture()));
    vi.stubGlobal('fetch', fetcher);
    await runArbitrationDivergences('9007199254740993');
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/gates/9007199254740993/arbitration-divergences');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('载荷透传：divergences 分歧行 + aiSummary 归纳 + blocking/decisionWritten 恒 false', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(arbitrationFixture()));
    vi.stubGlobal('fetch', fetcher);
    const view = await runArbitrationDivergences('5');
    expect(view.divergences[0]).toMatchObject({ round: 1, marketDecision: 'APPROVE', rdDecision: 'REJECT' });
    expect(view.aiSummary.markdown).toBe('- 轮1：温测口径分歧');
    expect(view.aiSummary.degraded).toBe(false);
    expect(view.blocking).toBe(false);
    expect(view.decisionWritten).toBe(false);
    expect(view.round).toBe(2);
  });

  it('零分歧分支：divergences=[] 且 aiSummary 给确定性结论（aiModel=null）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(arbitrationFixture({
      aiSummary: { aiModel: null, degraded: false, markdown: '无分歧点：各轮双 PM 决策一致或存在未签评审行。' },
      divergences: [],
    })));
    vi.stubGlobal('fetch', fetcher);
    const view = await runArbitrationDivergences('5');
    expect(view.divergences).toEqual([]);
    expect(view.aiSummary.aiModel).toBeNull();
    expect(view.aiSummary.markdown).toContain('无分歧点');
  });

  it('AI 降级分支：aiSummary.degraded=true 且结构化分歧数据照常返回；错误传播抛 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(arbitrationFixture({
      aiSummary: { aiModel: null, degraded: true, markdown: 'AI 分歧点归纳暂不可用' },
    })));
    vi.stubGlobal('fetch', fetcher);
    const view = await runArbitrationDivergences('5');
    expect(view.aiSummary.degraded).toBe(true);
    expect(view.divergences).toHaveLength(1);

    const failing = vi.fn().mockResolvedValue(envelope(null, 500, 90001));
    vi.stubGlobal('fetch', failing);
    await expect(runArbitrationDivergences('5')).rejects.toBeInstanceOf(IpdRequestError);
  });
});
