/**
 * 招投标 AI 对比 API 契约测试（AI-P2-2 #3；后端 BidAiCompareController POST /bid-invitations/{id}/ai-compare）。
 *
 * 重点覆盖：
 * - runBidAiCompare：请求体 { responseIds } 形状 + id 字符串透传（禁数值化）；
 * - 载荷透传 dimensions 四维对照表 + differences + 用量元信息；
 * - 错误传播（10001 份数闸 / 30001 组长超管闸）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runBidAiCompare, type BidAiCompareView } from './bid-ai-compare';
import { IpdRequestError } from './auth';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-27T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const compareFixture = (overrides: Partial<BidAiCompareView> = {}): BidAiCompareView => ({
  dimensions: [
    { cells: { '2001': '6 个月', '2002': '8 个月' }, difference: '应标 2001 工期更短', dimension: '工期' },
  ],
  differences: ['2001 承诺资源更充足'],
  invitationId: '9007199254740993',
  invitationTitle: '智慧园区视频分析算法研发',
  latencyMs: 830,
  model: 'test-model',
  promptTokens: 700,
  completionTokens: 420,
  responseIds: ['2001', '2002'],
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

describe('bid-ai-compare API — runBidAiCompare', () => {
  it('POST /bid-invitations/{id}/ai-compare：body 为 { responseIds } 字符串列表', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(compareFixture()));
    vi.stubGlobal('fetch', fetcher);
    await runBidAiCompare('9007199254740993', ['2001', '2002']);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/bid-invitations/9007199254740993/ai-compare');
    expect(init.method).toBe('POST');
    // 19 位雪花 ID 字符串透传（禁 Number()）
    expect(JSON.parse(String(init.body))).toEqual({ responseIds: ['2001', '2002'] });
  });

  it('载荷透传：dimensions.cells 以应标 id 为键 + differences + 模型/用量元信息', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(compareFixture()));
    vi.stubGlobal('fetch', fetcher);
    const view = await runBidAiCompare('9007199254740993', ['2001', '2002']);
    expect(view.dimensions).toHaveLength(1);
    expect(view.dimensions[0]).toMatchObject({ dimension: '工期', cells: { '2001': '6 个月', '2002': '8 个月' } });
    expect(view.differences).toEqual(['2001 承诺资源更充足']);
    expect(view).toMatchObject({ model: 'test-model', promptTokens: 700, completionTokens: 420, latencyMs: 830 });
  });

  it('错误传播：10001 份数闸（<2 或 >5）抛 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 400, 10001));
    vi.stubGlobal('fetch', fetcher);
    await expect(runBidAiCompare('9007199254740993', ['2001'])).rejects.toBeInstanceOf(IpdRequestError);
  });

  it('错误传播：30001 非组长/超管抛 IpdRequestError（MARKET_PM/RD_PM 403）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 403, 30001));
    vi.stubGlobal('fetch', fetcher);
    await expect(runBidAiCompare('9007199254740993', ['2001', '2002'])).rejects.toBeInstanceOf(IpdRequestError);
  });
});
