/**
 * 上市复盘 API 契约测试（R215 WP3.1 批次2 = ORPHAN-A9；PostLaunchReviewController 三端点）。
 *
 * 重点覆盖：
 * - fetchPendingReview：GET /post-launch-reviews/pending?projectId=；
 *   无待办时后端抛业务异常（HTTP 200/4xx + code!=0）→ IpdRequestError（前端据此呈现空态）；
 * - scheduleReview：POST body {projectId, launchDate}（yyyy-MM-dd 字符串）；
 * - completeReview：POST /{id}/complete，四项正文缺省时 body 允许为空对象；
 * - ID 字符串化透传。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import { completeReview, fetchPendingReview, scheduleReview } from './post-launch-review';

const envelope = (data: unknown, status = 200, code = 0, message = 'ok'): Response =>
  new Response(
    JSON.stringify({ code, message, data, timestamp: '2026-09-24T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const reviewFixture = {
  id: '2103350000000000001',
  projectId: '9140001',
  scheduledAt: '2026-12-01T00:00:00.000+08:00',
  status: 'PENDING',
  assigneeId: null,
  actualRevenue: null,
  customerFeedback: null,
  kpiAchievement: null,
  lessons: null,
  completedAt: null,
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('上市复盘 API（R215 A9）', () => {
  it('fetchPendingReview(9140001) → GET /post-launch-reviews/pending?projectId=9140001，视图透传', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(reviewFixture));
    vi.stubGlobal('fetch', fetcher);
    const r = await fetchPendingReview('9140001');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/post-launch-reviews/pending?projectId=9140001');
    expect(r.id).toBe('2103350000000000001');
    expect(r.status).toBe('PENDING');
  });

  it('无待办 → 后端业务异常包装为 IpdRequestError（调用方据此呈现空态）', async () => {
    // 后端契约：findPendingByProject 无记录时抛 IpdBusinessException（这里以 HTTP 404 + code 模拟）
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 404, 24001, '该项目暂无待办复盘'));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchPendingReview('9140001')).rejects.toBeInstanceOf(IpdRequestError);
  });

  it('scheduleReview → POST /post-launch-reviews，body 为 {projectId, launchDate:yyyy-MM-dd}', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(reviewFixture));
    vi.stubGlobal('fetch', fetcher);
    await scheduleReview('9140001', '2026-09-01');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/post-launch-reviews');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ projectId: '9140001', launchDate: '2026-09-01' });
  });

  it('completeReview(id, 全空) → POST /{id}/complete，body 允许空对象（四项正文可缺省）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ ...reviewFixture, status: 'COMPLETED', completedAt: '2026-09-24T10:00:00.000+08:00' }));
    vi.stubGlobal('fetch', fetcher);
    const r = await completeReview('2103350000000000001');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/post-launch-reviews/2103350000000000001/complete');
    expect(JSON.parse(call[1].body)).toEqual({});
    expect(r.status).toBe('COMPLETED');
  });

  it('completeReview 带四项正文 → body 原样透传（金额为数字）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(reviewFixture));
    vi.stubGlobal('fetch', fetcher);
    await completeReview('2103350000000000001', {
      actualRevenue: 1200000,
      customerFeedback: '客户满意',
      kpiAchievement: '达标',
      lessons: '供需节奏把控好',
    });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      actualRevenue: 1200000,
      customerFeedback: '客户满意',
      kpiAchievement: '达标',
      lessons: '供需节奏把控好',
    });
  });
});
