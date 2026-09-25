/**
 * 月度切换验收契约测试（R215 GAP-F5；SwitchingAcceptanceController 5 端点）。
 *
 * 重点覆盖（准备包 §F5 用例清单）：
 * - run → POST /switching-acceptance/2026-08/run（month 入 URL 编码位）；
 * - get/list 查询口 query 封装零多余参数；
 * - unlock body 契约：仅 {reason}；reason 4 字 → 前端拦截不发（对齐 @Size(5,500)）；
 * - 报告归一：ranBy/lockedBy/unlockedBy 19 位雪花无损 string；diffRate "0.0123" string 原样；
 *   NON_NULL 缺键 → null 不炸；
 * - month 非法（2026-8 未补零）→ api 层守卫拦截不发；
 * - 权限负例：组长调用 lock 403/30001（ADMIN_WRITE 仅超管）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import {
  getSwitchingAcceptance,
  listSwitchingAcceptance,
  lockSwitchingAcceptance,
  runSwitchingAcceptance,
  unlockSwitchingAcceptance,
} from './switching-acceptance';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

/** 完整报告夹具（BigDecimal 恒 string、Long 双形态、NON_NULL 缺键模拟 unlockReason 等缺省）。 */
const reportFixture = {
  month: '2026-08',
  ranAt: '2026-09-01 02:00:00',
  ranBy: '2096266884247736321', // 超 2^53 雪花：BigNumberSerializer 恒 string 下发
  isLocked: true,
  lockedAt: '2026-09-02 10:00:00',
  lockedBy: 900101, // 安全区间 number 形态
  diffRate: '0.0123', // BigDecimal → ToStringSerializer 恒 string
  passed: true,
  checks: [
    {
      name: 'kpi_score_sum',
      passed: true,
      expected: '3180.50',
      actual: '3180.50',
      diff: '0',
      note: null,
      kpiScoreSum: '3180.50',
      bonusDistributionSum: '3180.50',
    },
    {
      name: 'duplicate_check',
      passed: false,
      expected: '0',
      actual: '1',
      diff: '1',
      note: '检测到 1 条重复发放',
      duplicateCount: 1,
    },
  ],
  summary: { total: 5, passed: 4, failed: 1 },
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('月度切换验收 API（R215 GAP-F5 · SwitchingAcceptanceController）', () => {
  it('run → POST /switching-acceptance/2026-08/run（month 入 URL 路径位，无 body）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(reportFixture));
    vi.stubGlobal('fetch', fetcher);
    const r = await runSwitchingAcceptance('2026-08');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/switching-acceptance/2026-08/run');
    expect(fetcher.mock.calls[0]![1]?.method).toBe('POST');
    expect(fetcher.mock.calls[0]![1]?.body).toBeUndefined();
    expect(r.month).toBe('2026-08');
  });

  it('get → GET …/switching-acceptance/2026-08；list → GET /switching-acceptance（query 零多余参数）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(reportFixture));
    vi.stubGlobal('fetch', fetcher);
    await getSwitchingAcceptance('2026-08');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/switching-acceptance/2026-08');
    expect(fetcher.mock.calls[0]![1]?.method ?? 'GET').toBe('GET');

    const lister = vi.fn().mockResolvedValue(envelope([reportFixture]));
    vi.stubGlobal('fetch', lister);
    const rows = await listSwitchingAcceptance();
    expect(lister.mock.calls[0]![0]).toBe('/api/v1/switching-acceptance');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.month).toBe('2026-08');
  });

  it('lock → POST …/2026-08/lock 无 body；报告归一：三操作人 ID string、diffRate 精度串原样、计数 number、布尔严格', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(reportFixture));
    vi.stubGlobal('fetch', fetcher);
    const r = await lockSwitchingAcceptance('2026-08');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/switching-acceptance/2026-08/lock');
    expect(fetcher.mock.calls[0]![1]?.body).toBeUndefined();
    // 归一断言：19 位雪花逐字符无损（Number() 塌缩防回潮）+ 安全区间 number → string
    expect(r.ranBy).toBe('2096266884247736321');
    expect(r.lockedBy).toBe('900101');
    expect(typeof r.ranBy).toBe('string');
    // BigDecimal 精度串原样透传（禁 parseFloat/Number——展示层不改数值）
    expect(r.diffRate).toBe('0.0123');
    expect(r.checks[0]!.kpiScoreSum).toBe('3180.50');
    expect(r.checks[0]!.diff).toBe('0');
    // 计数类 Number 归一 + 布尔严格 === true
    expect(r.checks[1]!.duplicateCount).toBe(1);
    expect(r.summary).toEqual({ total: 5, passed: 4, failed: 1 });
    expect(r.isLocked).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.checks[1]!.passed).toBe(false);
  });

  it('unlock body 契约：恰一键 {reason}；报告归一 unlockReason/unlockedBy 透传', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      ...reportFixture,
      isLocked: false,
      unlockReason: '重复发放已冲正，重跑对账',
      unlockedAt: '2026-09-03 09:00:00',
      unlockedBy: '2096266884247736321',
    }));
    vi.stubGlobal('fetch', fetcher);
    const r = await unlockSwitchingAcceptance('2026-08', '重复发放已冲正，重跑对账');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/switching-acceptance/2026-08/unlock');
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(Object.keys(body)).toEqual(['reason']);
    expect(body.reason).toBe('重复发放已冲正，重跑对账');
    expect(r.isLocked).toBe(false);
    expect(r.unlockReason).toBe('重复发放已冲正，重跑对账');
    expect(r.unlockedBy).toBe('2096266884247736321');
  });

  it('unlock reason 4 字 → 前端拦截不发（对齐后端 @Size(5,500)；month 非法同拦截）', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(unlockSwitchingAcceptance('2026-08', '太短了')).rejects.toThrow(/5-500/);
    // 501 字超长同拦
    await expect(unlockSwitchingAcceptance('2026-08', 'x'.repeat(501))).rejects.toThrow(/5-500/);
    // month 未补零 2026-8 → api 层守卫拦截，fetch 不被调用
    await expect(runSwitchingAcceptance('2026-8')).rejects.toThrow(/yyyy-MM/);
    await expect(getSwitchingAcceptance('2026/08')).rejects.toThrow(/yyyy-MM/);
    await expect(lockSwitchingAcceptance('2026-13')).rejects.toThrow(/yyyy-MM/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('NON_NULL 缺键 → 归一 null/空结构不炸（最小报告仅 month）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ month: '2026-07' }));
    vi.stubGlobal('fetch', fetcher);
    const r = await getSwitchingAcceptance('2026-07');
    expect(r.month).toBe('2026-07');
    expect(r.ranBy).toBeNull();
    expect(r.diffRate).toBeNull();
    expect(r.isLocked).toBe(false);
    expect(r.checks).toEqual([]);
    expect(r.summary).toEqual({});
  });

  it('权限负例：组长调用 lock 403/30001 → IpdRequestError（ADMIN_WRITE 仅超管）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 403, 30001)));
    const cause = await lockSwitchingAcceptance('2026-08').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(30001);
    expect((cause as IpdRequestError).status).toBe(403);
    await expect(runSwitchingAcceptance('2026-08')).rejects.toBeInstanceOf(IpdRequestError);
    await expect(unlockSwitchingAcceptance('2026-08', '事故恢复解锁理由')).rejects.toBeInstanceOf(IpdRequestError);
  });
});
