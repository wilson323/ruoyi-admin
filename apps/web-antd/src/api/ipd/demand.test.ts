/**
 * 需求池 API 契约测试（页40 需求管理；后端 DemandController）。
 *
 * 重点覆盖：
 * - fetchDemands 列表：productId 可选过滤；demands/total 字段透传；
 * - triageDemand 分流：POST /demands/{id}/triage、body 序列化；
 * - linkDemandProject 关联项目：POST /demands/{id}/link-project、body 仅含 projectId；
 * - URL 编码（id 含特殊字符不抛错）；
 * - 错误传播（HTTP 4xx + envelope.code != 0 → IpdRequestError）；
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import { fetchDemands, linkDemandProject, triageDemand } from './demand';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-07T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const demandFixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '101',
  title: '希望支持批量导出',
  customerName: '某某公司',
  submitterName: '张三',
  source: 'PORTAL_GUEST',
  status: 'SUBMITTED',
  productId: null,
  productName: null,
  projectId: null,
  marketPmId: null,
  marketPmName: null,
  rdPmId: null,
  rdPmName: null,
  createdAt: 1700000000000,
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

describe('demand API — fetchDemands 列表', () => {
  it('无 query：GET /demands 不带查询串，返回 demands/total', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      demands: [demandFixture({ id: '1' }), demandFixture({ id: '2', status: 'ACCEPTED' })],
      total: 2,
    }));
    vi.stubGlobal('fetch', fetcher);
    const result = await fetchDemands();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/demands');
    expect(result.total).toBe(2);
    expect(result.demands).toHaveLength(2);
    expect(result.demands[0]).toMatchObject({ id: '1', status: 'SUBMITTED' });
  });

  it('带 productId：编码进查询串', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ demands: [], total: 0 }));
    vi.stubGlobal('fetch', fetcher);
    await fetchDemands({ productId: 'p-001' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/demands?productId=p-001');
  });

  it('带 status：编码进查询串', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ demands: [], total: 0 }));
    vi.stubGlobal('fetch', fetcher);
    await fetchDemands({ status: 'EVALUATING' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/demands?status=EVALUATING');
  });

  it('productId + status：两个参数同时编码', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ demands: [], total: 0 }));
    vi.stubGlobal('fetch', fetcher);
    await fetchDemands({ productId: 'p-001', status: 'SCHEDULED' });
    const url = fetcher.mock.calls[0]?.[0] as string;
    expect(url).toContain('productId=p-001');
    expect(url).toContain('status=SCHEDULED');
  });

  it('空 productId 与无 status：视为无 query，不带 ?productId=', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ demands: [], total: 0 }));
    vi.stubGlobal('fetch', fetcher);
    await fetchDemands({ productId: '' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/demands');
  });
});

describe('demand API — triageDemand 分流', () => {
  it('POST /demands/{id}/triage，body 包含 status + 可选双 PM', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: '101', status: 'EVALUATING' }));
    vi.stubGlobal('fetch', fetcher);
    const result = await triageDemand('101', {
      marketPmId: 'm-1',
      rdPmId: 'r-1',
      status: 'EVALUATING',
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/demands/101/triage');
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toEqual({ status: 'EVALUATING', marketPmId: 'm-1', rdPmId: 'r-1' });
    expect(result).toEqual({ id: '101', status: 'EVALUATING' });
  });

  it('仅传 status 不指定 PM：body 仅含 status', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: '202', status: 'SCHEDULED' }));
    vi.stubGlobal('fetch', fetcher);
    await triageDemand('202', { status: 'SCHEDULED' });
    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toEqual({ status: 'SCHEDULED' });
  });

  it('id 含特殊字符：走 encodeURIComponent 编码（与 project.ts getProject 对齐）', async () => {
    // W6 A24 调研 + W9 A37 修复：triageDemand 与 linkDemandProject 现统一走 encodeURIComponent，
    // 与 project.ts 的 getProject/advanceProjectStage 等保持契约一致。
    // 真实场景 ID 为 Long 字符串（无特殊字符），行为等价；但特殊字符 ID 现在安全。
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'a b/c', status: 'CLOSED' }));
    vi.stubGlobal('fetch', fetcher);
    await triageDemand('a b/c', { status: 'CLOSED' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/demands/a%20b%2Fc/triage');
  });

  it('id 含 + / ? 等特殊字符：编码后查询语义不被破坏', async () => {
    // encodeURIComponent 不编码 -_.!~*'() 但会编码 + ? # / & = 等 URL 保留字符；
    // 这保证后端解析时 id 仍是完整字符串而非被截断或误判为查询参数分隔符。
    const fetcher = vi.fn().mockResolvedValue(envelope({ id: 'a+b?c', status: 'ARCHIVED' }));
    vi.stubGlobal('fetch', fetcher);
    await triageDemand('a+b?c', { status: 'ARCHIVED' });
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/demands/a%2Bb%3Fc/triage');
  });
});

describe('demand API — linkDemandProject 关联项目', () => {
  it('POST /demands/{id}/link-project，body 仅含 projectId', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      id: '101',
      projectId: 'p-500',
      status: 'SCHEDULED',
    }));
    vi.stubGlobal('fetch', fetcher);
    const result = await linkDemandProject('101', 'p-500');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/demands/101/link-project');
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toEqual({ projectId: 'p-500' });
    expect(result).toEqual({ id: '101', projectId: 'p-500', status: 'SCHEDULED' });
  });

  it('绑定后服务端置 SCHEDULED：返回 status 反映后端状态', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      id: '303', projectId: 'p-X', status: 'SCHEDULED',
    }));
    vi.stubGlobal('fetch', fetcher);
    const result = await linkDemandProject('303', 'p-X');
    expect(result.status).toBe('SCHEDULED');
  });

  it('id 含特殊字符：link-project 路径也走 encodeURIComponent', async () => {
    // 与 triageDemand 同源修复；保证两个端点对 id 的处理一致。
    const fetcher = vi.fn().mockResolvedValue(envelope({
      id: 'a b/c', projectId: 'p-1', status: 'SCHEDULED',
    }));
    vi.stubGlobal('fetch', fetcher);
    await linkDemandProject('a b/c', 'p-1');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/demands/a%20b%2Fc/link-project');
  });
});

describe('demand API — 错误传播', () => {
  it('HTTP 400 + envelope.code != 0 抛 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 400, 10001));
    vi.stubGlobal('fetch', fetcher);
    await expect(fetchDemands()).rejects.toBeInstanceOf(IpdRequestError);
  });

  it('linkDemandProject 在权限不足时抛 IpdRequestError', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(null, 403, 30001));
    vi.stubGlobal('fetch', fetcher);
    await expect(linkDemandProject('101', 'p-500')).rejects.toBeInstanceOf(IpdRequestError);
  });
});