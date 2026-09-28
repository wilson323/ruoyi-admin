/**
 * 招投标 AI 起草 / 应标完整性检查 API 契约测试（AI-P2-2 #1/#2；
 * 后端 BidAiDraftController POST /bid-invitations/ai-draft、
 * BidResponseCheckController POST /bid-invitations/{id}/ai-completeness-check）。
 *
 * 重点覆盖：
 * - draftBidInvitationDoc：body { brief, projectId, title } 形状 + id 字符串透传（禁数值化）；
 * - checkBidResponseCompleteness：body { responseNote } + id 路径编码；
 * - 载荷透传草稿 v1 视图 / 逐条检查表 + 用量元信息；
 * - 错误传播（10001 参数闸 / 404 招标单不存在 / 90001 生成失败或 FAIL:PARSE）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import {
  checkBidResponseCompleteness,
  draftBidInvitationDoc,
  type BidCheckView,
  type BidDraftView,
} from './bid-ai-suite';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-27T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const draftFixture = (overrides: Partial<BidDraftView> = {}): BidDraftView => ({
  content: '# 招标书正文…\n## 起草说明\n- 假设1：工期按行业惯例 90 天',
  docId: '9007199254740993',
  latencyMs: 720,
  model: 'test-model',
  status: 'GENERATED',
  title: '智慧园区视频分析算法研发',
  tokenCompletion: 640,
  tokenPrompt: 510,
  ...overrides,
});

const checkFixture = (overrides: Partial<BidCheckView> = {}): BidCheckView => ({
  checks: [
    { evidence: '方案提及 7x24 响应', requirement: '7x24 支持', status: 'MET' },
    { evidence: '未提及', requirement: '温测报告', status: 'MISSING' },
  ],
  completionTokens: 260,
  invitationId: '9007199254740993',
  invitationTitle: '智慧园区视频分析算法研发',
  latencyMs: 900,
  model: 'test-model',
  summary: '主要缺口在温测报告',
  tokenPrompt: 120,
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

describe('bid-ai-suite API — draftBidInvitationDoc', () => {
  it('POST /bid-invitations/ai-draft：body 为 { brief, projectId, title }，id 字符串透传', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(draftFixture()));
    vi.stubGlobal('fetch', fetcher);
    await draftBidInvitationDoc('9007199254740993', '智慧园区视频分析算法研发', 'PM 原始需求');
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/bid-invitations/ai-draft');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      brief: 'PM 原始需求',
      projectId: '9007199254740993',
      title: '智慧园区视频分析算法研发',
    });
  });

  it('载荷透传：草稿 v1 视图（docId 字符串 / status / 模型与用量元信息）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(draftFixture()));
    vi.stubGlobal('fetch', fetcher);
    const view = await draftBidInvitationDoc('9007199254740993', 't', 'b');
    expect(view.docId).toBe('9007199254740993');
    expect(view.status).toBe('GENERATED');
    expect(view).toMatchObject({ model: 'test-model', tokenPrompt: 510, tokenCompletion: 640, latencyMs: 720 });
    expect(view.content).toContain('起草说明');
  });

  it('错误传播：10001 参数闸 / 90001 生成失败抛 IpdRequestError（不出半成品草稿）', async () => {
    for (const [status, code] of [[400, 10001], [500, 90001]] as Array<[number, number]>) {
      const fetcher = vi.fn().mockResolvedValue(envelope(null, status, code));
      vi.stubGlobal('fetch', fetcher);
      await expect(draftBidInvitationDoc('9007199254740993', 't', 'b')).rejects.toBeInstanceOf(IpdRequestError);
    }
  });
});

describe('bid-ai-suite API — checkBidResponseCompleteness', () => {
  it('POST /bid-invitations/{id}/ai-completeness-check：body 为 { responseNote }，id 路径编码', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(checkFixture()));
    vi.stubGlobal('fetch', fetcher);
    await checkBidResponseCompleteness('9007199254740993', '我方方案：7x24 响应');
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/bid-invitations/9007199254740993/ai-completeness-check');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ responseNote: '我方方案：7x24 响应' });
  });

  it('载荷透传：checks 逐条状态（MET/PARTIAL/MISSING 白名单）+ summary + 用量元信息', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(checkFixture({
      checks: [
        { evidence: '提及', requirement: '7x24 支持', status: 'MET' },
        { evidence: '仅提及四季度', requirement: 'Q4 交付', status: 'PARTIAL' },
        { evidence: '未提及', requirement: '温测报告', status: 'MISSING' },
      ],
    })));
    vi.stubGlobal('fetch', fetcher);
    const view = await checkBidResponseCompleteness('9007199254740993', '方案');
    expect(view.checks.map((row) => row.status)).toEqual(['MET', 'PARTIAL', 'MISSING']);
    expect(view.summary).toBe('主要缺口在温测报告');
    expect(view).toMatchObject({ model: 'test-model', tokenPrompt: 120, completionTokens: 260 });
  });

  it('错误传播：404 招标单不存在 / 90001 FAIL:PARSE 抛 IpdRequestError（不静默补表）', async () => {
    for (const [status, code] of [[404, 50001], [500, 90001]] as Array<[number, number]>) {
      const fetcher = vi.fn().mockResolvedValue(envelope(null, status, code));
      vi.stubGlobal('fetch', fetcher);
      await expect(checkBidResponseCompleteness('9007199254740993', '方案')).rejects.toBeInstanceOf(IpdRequestError);
    }
  });
});
