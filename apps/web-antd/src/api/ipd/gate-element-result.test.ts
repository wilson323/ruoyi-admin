/**
 * Gate 要素判定 API 契约测试 + countVetoFailures 硬阻断纯函数。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeGateElementResult,
  countVetoFailures,
  storedElementResult,
  listGateElementViews,
  listGateLegacyItems,
  submitGateElementResult,
  submitGateReview,
} from './gate-element-result';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());

describe('gate element result API contract', () => {
  it('GET /gates/{id}/elements returns seeded 33-element list', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([
      // R30 真值形态：后端 listView 返回 elementId/elementCode/elementName（非 id/code/title）
      { elementId: 'e-1', elementCode: 'G1-01', elementName: 't1', isVeto: true, sortOrder: 1, result: null },
    ]));
    vi.stubGlobal('fetch', fetcher);
    const list = await listGateElementViews('gate-1');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/gates/gate-1/elements');
    expect(list[0]!.isVeto).toBe(true);
  });

  it('POST /gates/{id}/element-results', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'er-1' }));
    vi.stubGlobal('fetch', fetcher);
    await submitGateElementResult('gate-1', { elementId: 'e-1', result: 'PASS' });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/gates/gate-1/element-results');
    expect((fetcher.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });

  // F5（2026-10-07）：G1-1 量化门槛的入参通道。后端 JudgeRequest 早已含这两个字段，
  // 前端契约此前没有它们 ⇒ 门槛在 UI 上永远满足不了（不是校验松，是传不上去）。
  it('POST /gates/{id}/element-results 透传 G1-1 的 verifications / writtenIntents', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'er-1' }));
    vi.stubGlobal('fetch', fetcher);
    await submitGateElementResult('gate-1', { elementId: 'e-1', result: 'PASS', verifications: 5, writtenIntents: 1 });
    const body = JSON.parse(String((fetcher.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ elementId: 'e-1', result: 'PASS', verifications: 5, writtenIntents: 1 });
  });

  it('未填 G1-1 门槛时发 null 而非 0（0 会被后端读成「验证 0 家」并给出误导性拒绝原因）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'er-1' }));
    vi.stubGlobal('fetch', fetcher);
    await submitGateElementResult('gate-1', { elementId: 'e-1', result: 'PASS', verifications: null, writtenIntents: null });
    const body = JSON.parse(String((fetcher.mock.calls[0]![1] as RequestInit).body));
    expect(body.verifications).toBeNull();
    expect(body.writtenIntents).toBeNull();
  });

  it('POST /gates/{id}/element-results/{resultId}/close for condition items', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'er-1' }));
    vi.stubGlobal('fetch', fetcher);
    await closeGateElementResult('gate-1', 'er-1', 'att-1');
    const closeInit = fetcher.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(closeInit.body))).toEqual({ evidence: 'att-1' });
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/gates/gate-1/element-results/er-1/close');
  });

  // R212 ORPHAN-A1：GET /legacy 条件遗留清单（AC-GATE-17）
  it('GET /gates/{id}/legacy returns leftover rows with overdue flag', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([
      { resultId: 'er-2', elementCode: 'G1-02', elementName: '商业模式可行性', result: 'CONDITIONAL',
        leftoverItem: '补充单位经济测算', responsiblePersonId: '7', leftoverDueAt: '2026-09-30',
        leftoverStatus: 'OPEN', closedEvidence: null, overdue: false },
    ]));
    vi.stubGlobal('fetch', fetcher);
    const items = await listGateLegacyItems('gate-1');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/gates/gate-1/legacy');
    expect(items[0]!.leftoverStatus).toBe('OPEN');
    expect(items[0]!.overdue).toBe(false);
  });

  // R212 ORPHAN-A1：POST /submit 提交评审（SEC-FIX-HIGH-1.1-FOLLOWUP 强制输出物 ossId）
  it('POST /gates/{id}/submit sends string ossIds as mandatory outputs（19 位雪花无损透传）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(
      { id: 'gate-1', projectId: '101', gateCode: 'G3', status: 'PENDING', startedAt: '2026-09-24T10:00:00', snapshotFrozen: true },
    ));
    vi.stubGlobal('fetch', fetcher);
    const result = await submitGateReview('gate-1', { materialsOssId: '2096266884247736321', meetingMinutesOssId: '2096266884247736322' });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/gates/gate-1/submit');
    const init = fetcher.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    // 字符串 ID 契约 → 后端 Long 由 Jackson 宽松转换；19 位雪花必须原样透传防精度损失
    expect(JSON.parse(String(init.body))).toEqual({ materialsOssId: '2096266884247736321', meetingMinutesOssId: '2096266884247736322' });
    expect(result.snapshotFrozen).toBe(true);
  });
});

describe('countVetoFailures hardblock', () => {
  it('counts only veto items with FAIL result', () => {
    // R30 真值形态：要素主键字段为 elementId（与后端 listView 对齐）
    const els = [
      { elementId: '1', isVeto: true } as any,
      { elementId: '2', isVeto: false } as any,
      { elementId: '3', isVeto: true } as any,
    ];
    const results = new Map([
      ['1', 'FAIL' as const],
      ['2', 'FAIL' as const],
      ['3', 'PASS' as const],
    ]);
    expect(countVetoFailures(els, results)).toBe(1);
  });

  it('returns 0 when no veto failures', () => {
    expect(countVetoFailures([{ elementId: '1', isVeto: true } as any], new Map())).toBe(0);
  });
});

describe('storedElementResult', () => {
  it('reads backend PASS / CONDITIONAL / FAIL as-is; legacy PASS_WITH_CONDITION → null', () => {
    expect(storedElementResult('CONDITIONAL')).toBe('CONDITIONAL');
    expect(storedElementResult('FAIL')).toBe('FAIL');
    expect(storedElementResult('PASS_WITH_CONDITION')).toBeNull();
    expect(storedElementResult(null)).toBeNull();
  });
});
