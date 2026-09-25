/**
 * 产品↔项目绑定对称契约测试（R215 A13 补接线；后端 ProductController bind-project/unbind-project）。
 *
 * 重点覆盖：
 * - bindProductProject：projectId 正常传参与空串兜底路径；
 * - unbindProductProject（R215 新增）：与 bind 对称的显式解绑；
 * - 两端点均 POST + query 传参、Void 载荷。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bindProductProject, unbindProductProject } from './product';

const envelope = (data: unknown = null, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-24T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('产品绑定/解绑 API（R215 A13）', () => {
  it('bindProductProject(p-1, 100) → POST /products/p-1/bind-project?projectId=100', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope());
    vi.stubGlobal('fetch', fetcher);
    await bindProductProject('p-1', '100');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/products/p-1/bind-project?projectId=100');
    expect(call[1]?.method).toBe('POST');
  });

  it('bindProductProject 空串 projectId → 查询串整体省略（http.ts 丢空值；后端 @RequestParam 必填会 400，解绑必须走 unbind）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope());
    vi.stubGlobal('fetch', fetcher);
    await bindProductProject('p-1', null);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/products/p-1/bind-project');
  });

  it('unbindProductProject(p-1, 100) → POST /products/p-1/unbind-project?projectId=100（显式解绑）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope());
    vi.stubGlobal('fetch', fetcher);
    await unbindProductProject('p-1', '100');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/products/p-1/unbind-project?projectId=100');
    expect(call[1]?.method).toBe('POST');
  });

  it('unbindProductProject id 做 URL 编码（防路径注入）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope());
    vi.stubGlobal('fetch', fetcher);
    await unbindProductProject('p/1 x', '100');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/products/p%2F1%20x/unbind-project?projectId=100');
  });

  it('HTTP 500 + code!=0 → 抛 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 500, 99999));
    vi.stubGlobal('fetch', fetcher);
    await expect(unbindProductProject('p-1', '100')).rejects.toThrow();
  });
});
