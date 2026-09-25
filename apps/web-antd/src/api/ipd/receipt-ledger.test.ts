/**
 * 回款台账 API 契约测试（R212 桶表 #75-77 = ORPHAN-A5；看板卡 ab1fb0bd；
 * ReceiptLedgerController 三端点：by-project / POST 录入 / refunds 冲减）。
 *
 * 重点覆盖：
 * - listReceiptLedgersByProject：GET /receipt-ledgers/by-project/{projectId} 路径参数编码；
 * - createReceiptLedger：POST body {projectId, receiptMonth(YYYY-MM), receiptAmount, ...}，
 *   可选字段缺省不传（voucherHash 前端不采集）；
 * - refundReceiptLedger：POST /receipt-ledgers/{projectId}/refunds body {month, refundAmount}；
 * - ID 字符串化透传（19 位雪花 ID 保精度）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createReceiptLedger,
  listReceiptLedgersByProject,
  refundReceiptLedger,
} from './receipt-ledger';

const envelope = (data: unknown, status = 200, code = 0, message = 'ok'): Response =>
  new Response(
    JSON.stringify({ code, message, data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const ledgerFixture = {
  id: '2103460000000000123',
  projectId: '9140001',
  bonusPoolId: null,
  receiptMonth: '2026-08',
  receiptAmount: '1500000.00',
  refundAmount: '0',
  netAmount: '1500000.00',
  voucherUrl: null,
  voucherHash: null,
  source: 'RECEIPT',
  windowStart: '2026-03-01 00:00:00',
  windowEnd: '2026-09-01 00:00:00',
  inWindow: true,
  createTime: '2026-09-25 10:00:00',
};

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => vi.unstubAllGlobals());

describe('回款台账 API（ORPHAN-A5）', () => {
  it('listReceiptLedgersByProject(9140001) → GET /receipt-ledgers/by-project/9140001', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope([ledgerFixture]));
    vi.stubGlobal('fetch', fetcher);
    const rows = await listReceiptLedgersByProject('9140001');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/receipt-ledgers/by-project/9140001');
    expect((fetcher.mock.calls[0]![1] as RequestInit | undefined)?.method).toBe('GET'); // authenticatedRequest 显式 GET
    expect(rows[0]!.id).toBe('2103460000000000123');
    expect(rows[0]!.source).toBe('RECEIPT');
  });

  it('createReceiptLedger → POST /receipt-ledgers，body 含 projectId/receiptMonth/receiptAmount；可选缺省不传', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(ledgerFixture));
    vi.stubGlobal('fetch', fetcher);
    await createReceiptLedger({
      projectId: '9140001', receiptMonth: '2026-08', receiptAmount: 1_500_000,
    });
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/receipt-ledgers');
    expect((call[1] as RequestInit).method).toBe('POST');
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({ projectId: '9140001', receiptMonth: '2026-08', receiptAmount: 1_500_000 });
    expect(body).not.toHaveProperty('voucherHash'); // 前端不采集哈希
    expect(body).not.toHaveProperty('source'); // 服务端定死 RECEIPT
  });

  it('createReceiptLedger 带退款与凭证 → 原样透传', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(ledgerFixture));
    vi.stubGlobal('fetch', fetcher);
    await createReceiptLedger({
      projectId: '9140001', receiptMonth: '2026-08', receiptAmount: 1_500_000,
      refundAmount: 200, voucherUrl: 'https://oss.example/voucher/2026-08.pdf',
    });
    expect(JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      projectId: '9140001', receiptMonth: '2026-08', receiptAmount: 1_500_000,
      refundAmount: 200, voucherUrl: 'https://oss.example/voucher/2026-08.pdf',
    });
  });

  it('refundReceiptLedger → POST /receipt-ledgers/{projectId}/refunds，body {month, refundAmount}', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ ...ledgerFixture, refundAmount: '5000.00' }));
    vi.stubGlobal('fetch', fetcher);
    const updated = await refundReceiptLedger('9140001', { month: '2026-08', refundAmount: 5_000 });
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/receipt-ledgers/9140001/refunds');
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ month: '2026-08', refundAmount: 5_000 });
    expect(updated.refundAmount).toBe('5000.00');
  });

  it('后端业务异常（code!=0，如窗口外退款拒绝）→ 调用方收 IpdRequestError 语义由 http 层保证（此处断言非 2xx 包装）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 400, 31001, '退款窗口外拒绝回溯'));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      refundReceiptLedger('9140001', { month: '2025-01', refundAmount: 1 }),
    ).rejects.toThrow();
  });
});
