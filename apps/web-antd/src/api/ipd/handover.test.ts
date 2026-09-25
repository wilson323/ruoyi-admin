/**
 * 移交域补端点契约测试（R215 WP3.1 批次 = ORPHAN-A8；HandoverController archive/monthly-attribution）。
 *
 * 重点覆盖：
 * - archiveHandover：POST /handovers/{id}/archive（无 body）+ HandoverView 透传；
 * - getMonthlyAttribution：GET /handovers/monthly-attribution?projectId&month 查询串拼装；
 * - 归档仅 COMPLETED（50002 状态机拒绝）与月份格式非法（50010）走 IpdRequestError 通道。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import { archiveHandover, getMonthlyAttribution } from './handover';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const handoverFixture = {
  id: '22',
  projectId: '2',
  fromPersonId: '7',
  toPersonId: '8',
  handoverRole: 'MARKET_PM',
  status: 'COMPLETED',
  note: '已完成的市场责任交接',
  confirmedAt: '2026-09-05T10:00:00Z',
  completedAt: '2026-09-06T09:00:00Z',
};

const attributionFixture = [
  {
    personId: '7',
    personName: '接手人',
    role: 'MARKET_PM',
    fromDate: '2026-09-01',
    toDate: '2026-09-30',
    daysInRole: 30,
    source: 'BINDING',
  },
  {
    personId: '8',
    personName: '原负责人',
    role: 'MARKET_PM',
    fromDate: null,
    toDate: '2026-08-31',
    daysInRole: 0,
    source: 'TRANSFER',
  },
];

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('移交域补端点（R215 A8）', () => {
  it('archiveHandover(22) → POST /handovers/22/archive，无请求体，透传 HandoverView', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(handoverFixture));
    vi.stubGlobal('fetch', fetcher);
    const r = await archiveHandover('22');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/handovers/22/archive');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.body).toBeUndefined();
    expect(r.status).toBe('COMPLETED');
    expect(r.id).toBe('22');
  });

  it('归档非 COMPLETED 记录被拒（live 实测 400/10001，message 携带精确原因）', async () => {
    // live 证据 2026-09-25：超管 archive DRAFT 900001 → 400/10001「仅 COMPLETED 移交可归档（当前 DRAFT）」
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 400, 10001));
    vi.stubGlobal('fetch', fetcher);
    const cause = await archiveHandover('21').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(10001);
    expect((cause as IpdRequestError).status).toBe(400);
  });

  it('getMonthlyAttribution(2, 2026-09) → GET /handovers/monthly-attribution?projectId=2&month=2026-09', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(attributionFixture));
    vi.stubGlobal('fetch', fetcher);
    const rows = await getMonthlyAttribution('2', '2026-09');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/handovers/monthly-attribution?projectId=2&month=2026-09');
    expect(call[1]?.method ?? 'GET').toBe('GET');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.personId).toBe('7');
    expect(rows[0]!.daysInRole).toBe(30);
    expect(rows[0]!.source).toBe('BINDING');
    expect(rows[1]!.fromDate).toBeNull();
  });

  it('月份格式非法（live 实测 400/10001）与跨组越权（403/30001）均走 IpdRequestError 通道', async () => {
    // live 证据 2026-09-25：month=2026-9 → 400/10001「项目 ID 与月份（yyyy-MM）不能为空且格式正确」
    const badMonth = vi.fn().mockResolvedValue(envelope(null, 400, 10001));
    vi.stubGlobal('fetch', badMonth);
    const cause1 = await getMonthlyAttribution('2', '2026-9').catch((e: unknown) => e);
    expect(cause1).toBeInstanceOf(IpdRequestError);
    expect((cause1 as IpdRequestError).code).toBe(10001);

    const denied = vi.fn().mockResolvedValue(envelope(null, 403, 30001));
    vi.stubGlobal('fetch', denied);
    const cause2 = await getMonthlyAttribution('999', '2026-09').catch((e: unknown) => e);
    expect(cause2).toBeInstanceOf(IpdRequestError);
    expect((cause2 as IpdRequestError).code).toBe(30001);
  });
});
