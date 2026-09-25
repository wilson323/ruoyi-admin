/**
 * R212 ORPHAN-A1：列席 3 端点（MEDIUM-1.3）契约测试。
 * 真值：GateReviewController GET/POST /gates/{gateId}/observers*（2026-09-24 磁盘核实）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GATE_OBSERVER_ROLE_OPTIONS,
  inviteGateObservers,
  listGateObservers,
  submitGateObserverOpinion,
} from './gate-review';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-24T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());

describe('gate observers API contract (MEDIUM-1.3)', () => {
  it('GET /gates/{gateId}/observers returns observer rows', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([
      { id: '11', gateId: '5', observerId: '7', role: 'SALES', attended: null, opinion: null, invitedAt: 1789388463000 },
    ]));
    vi.stubGlobal('fetch', fetcher);
    const rows = await listGateObservers('5');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/gates/5/observers');
    expect((fetcher.mock.calls[0]![1] as RequestInit | undefined)?.method ?? 'GET').toBe('GET');
    expect(rows[0]!.observerId).toBe('7');
    expect(rows[0]!.role).toBe('SALES');
  });

  it('POST /gates/{gateId}/observers/invite sends string personIds（19 位雪花无损透传）+ whitelisted role', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ gateId: '5', role: 'QUALITY', invitedCount: 2 }));
    vi.stubGlobal('fetch', fetcher);
    const result = await inviteGateObservers('5', ['2096266884247736321', '2096266884247736322'], 'QUALITY');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/gates/5/observers/invite');
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    // 字符串 ID 契约 → 后端 Long 由 Jackson 宽松转换；19 位雪花必须原样透传防精度损失
    expect(JSON.parse(String(init.body))).toEqual({ observerIds: ['2096266884247736321', '2096266884247736322'], role: 'QUALITY' });
    expect(result.invitedCount).toBe(2);
  });

  it('POST /gates/{gateId}/observers/{observerId}/opinion sends opinion body', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(
      { id: '11', gateId: '5', observerId: '7', role: 'SALES', attended: 1, opinion: '同意上市', invitedAt: 1789388463000 },
    ));
    vi.stubGlobal('fetch', fetcher);
    const row = await submitGateObserverOpinion('5', '7', '同意上市');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/gates/5/observers/7/opinion');
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ opinion: '同意上市' });
    expect(row.opinion).toBe('同意上市');
  });

  it('role options match backend OBSERVER_ROLES whitelist (5 roles)', () => {
    expect(GATE_OBSERVER_ROLE_OPTIONS.map((o) => o.value).sort()).toEqual(
      ['AFTERSALES', 'COMPLIANCE', 'QUALITY', 'SALES', 'SUPPLY'],
    );
  });
});
