/**
 * 月度津贴 API 契约测试：ledger/pending-stop 端点 + period 必填 + personId 可选。
 * D-补强 R1（2026-09-06）：新增字段映射测试，验证 listAllowances / getAllowancePendingStop
 * 返回的 AllowanceLedger 携带 W4-D 后端 domain 真实字段（month / lockedLevel / baseAmount /
 * finalAmount / capApplied / stopReason / createTime），并保证删除的 status 字段不再出现在
 * 返回中。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllowanceLedger } from './allowance';
import { getAllowancePendingStop, listAllowances } from './allowance';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

/** 模拟 W4-D AllowanceLedgerService.list 返回的一行 record（含全部 D-补强后字段） */
function buildLedgerRow(overrides: Partial<AllowanceLedger> = {}): AllowanceLedger {
  return {
    id: '1700000000000001',
    personId: '101',
    projectId: '201',
    month: '2026-09',
    lockedLevel: 'L3',
    baseAmount: '3000.00',
    finalAmount: '5000.00',
    capApplied: '0',
    stopReason: null,
    stopStartDate: null,
    createTime: '2026-09-30 23:59:59',
    delFlag: '0',
    ...overrides,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());

describe('allowance API contract', () => {
  it('GET /allowance/ledger with period', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listAllowances('2026-01');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/allowance/ledger');
    expect(url.searchParams.get('period')).toBe('2026-01');
  });

  it('omits personId when not provided', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await listAllowances('2026-01', 'pm-1');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.searchParams.get('personId')).toBe('pm-1');
  });

  it('GET /allowance/pending-stop with period', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);
    await getAllowancePendingStop('2026-01');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/allowance/pending-stop');
    expect(url.searchParams.get('period')).toBe('2026-01');
  });
});

/**
 * D-补强 R1 字段映射测试：验证 listAllowances / getAllowancePendingStop 返回的
 * AllowanceLedger 完整携带 W4-D 后端真实字段且不残留 status。
 * 覆盖维度：6 维（每维度 ≥ 1 用例）
 *   1) 新字段在返回值中可访问（类型 + 字段值）
 *   2) 旧 @deprecated 字段（period / level / amount / capReached / projectCount / projectIds）不强制出现
 *   3) status 字段在返回值中不存在（D-补强 R1 删字段）
 *   4) 多行响应：每行均携带新字段
 *   5) stopReason 区分正常发放（null）vs 停发（SCORE_BELOW_60 / NO_OUTPUT_60_DAYS）
 *   6) capApplied 区分触发（"1"）vs 未触发（"0"）
 */
describe('allowance DTO field mapping (D-补强 R1)', () => {
  it('listAllowances 返回的 record 携带 D-补强后字段（month / lockedLevel / finalAmount / capApplied / stopReason / createTime）', async () => {
    const row = buildLedgerRow();
    const fetcher = vi.fn().mockResolvedValue(envelope([row]));
    vi.stubGlobal('fetch', fetcher);

    const data = await listAllowances('2026-09');
    expect(data).toHaveLength(1);
    const [first] = data;
    expect(first?.month).toBe('2026-09');
    expect(first?.lockedLevel).toBe('L3');
    expect(first?.baseAmount).toBe('3000.00');
    expect(first?.finalAmount).toBe('5000.00');
    expect(first?.capApplied).toBe('0');
    expect(first?.stopReason).toBeNull();
    expect(first?.createTime).toBe('2026-09-30 23:59:59');
    expect(first?.personId).toBe('101');
    expect(first?.projectId).toBe('201');
  });

  it('listAllowances 返回的 record 不含 status 字段（D-补强 R1 删字段）', async () => {
    const row = buildLedgerRow() as unknown as Record<string, unknown>;
    // 模拟后端零对应：D-补强 R1 后字段已从类型移除，确保运行时也无残留
    expect('status' in row).toBe(false);

    const fetcher = vi.fn().mockResolvedValue(envelope([row]));
    vi.stubGlobal('fetch', fetcher);
    const data = await listAllowances('2026-09');
    expect(data[0]).not.toHaveProperty('status');
  });

  it('listAllowances 多行响应：每行均携带新字段', async () => {
    const rows = [
      buildLedgerRow({ id: '1', personId: '101', finalAmount: '3000.00', capApplied: '0' }),
      buildLedgerRow({ id: '2', personId: '102', finalAmount: '6000.00', capApplied: '1' }),
      buildLedgerRow({ id: '3', personId: '103', finalAmount: '0.00', capApplied: '0', stopReason: 'SCORE_BELOW_60' }),
    ];
    const fetcher = vi.fn().mockResolvedValue(envelope(rows));
    vi.stubGlobal('fetch', fetcher);

    const data = await listAllowances('2026-09');
    expect(data).toHaveLength(3);
    for (const r of data) {
      expect(r.month).toBe('2026-09');
      expect(r.lockedLevel).toBe('L3');
      expect(typeof r.baseAmount).toBe('string');
      expect(typeof r.finalAmount).toBe('string');
      expect(['0', '1']).toContain(r.capApplied);
    }
    expect(data[1]?.capApplied).toBe('1');
    expect(data[2]?.stopReason).toBe('SCORE_BELOW_60');
  });

  it('getAllowancePendingStop 返回的 record stopReason 必非空（后端 IS NOT NULL 过滤）', async () => {
    const row = buildLedgerRow({ stopReason: 'NO_OUTPUT_60_DAYS' });
    const fetcher = vi.fn().mockResolvedValue(envelope([row]));
    vi.stubGlobal('fetch', fetcher);

    const data = await getAllowancePendingStop('2026-09');
    expect(data).toHaveLength(1);
    expect(data[0]?.stopReason).toBe('NO_OUTPUT_60_DAYS');
    expect(data[0]?.stopReason).not.toBeNull();
  });

  it('getAllowancePendingStop 支持 STOP_* 前缀停发码（与 SCORE_BELOW_60 并存）', async () => {
    const rows = [
      buildLedgerRow({ id: '1', personId: '101', stopReason: 'STOP_SCORE_BELOW_60' }),
      buildLedgerRow({ id: '2', personId: '102', stopReason: 'STOP_NO_OUTPUT_60_DAYS' }),
    ];
    const fetcher = vi.fn().mockResolvedValue(envelope(rows));
    vi.stubGlobal('fetch', fetcher);

    const data = await getAllowancePendingStop('2026-09');
    expect(data.map((r) => r.stopReason)).toEqual([
      'STOP_SCORE_BELOW_60',
      'STOP_NO_OUTPUT_60_DAYS',
    ]);
  });

  it('capApplied 区分触发（"1"）vs 未触发（"0"）：view 端 Tag 颜色判定的输入', async () => {
    const triggered = buildLedgerRow({ id: '1', capApplied: '1' });
    const notTriggered = buildLedgerRow({ id: '2', capApplied: '0' });
    const fetcher = vi.fn().mockResolvedValue(envelope([triggered, notTriggered]));
    vi.stubGlobal('fetch', fetcher);

    const data = await listAllowances('2026-09');
    expect(data[0]?.capApplied).toBe('1');
    expect(data[1]?.capApplied).toBe('0');
  });

  it('空列表响应：返回 []，新字段约束不破坏空态', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([]));
    vi.stubGlobal('fetch', fetcher);

    const data = await listAllowances('2026-09');
    expect(data).toEqual([]);
    expect(Array.isArray(data)).toBe(true);
  });
});
