/**
 * 审计域 API 契约测试：scope 分页参数、验链四态、重建端点、payload 容错解析、项目过滤。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIpdAuthStore } from '../../store/ipd-auth';
import {
  type AuditLog,
  exportAuditByScope,
  filterAuditByEntity,
  pageAuditByScope,
  parseAuditPayload,
  rebuildAuditChain,
  verifyAuditChain,
} from './audit';

const envelope = (data: unknown) =>
  new Response(
    JSON.stringify({ code: 0, message: 'success', data, timestamp: '2026-09-05T00:00:00Z', traceId: 'fixture' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

beforeEach(() => {
  sessionStorage.clear();
  setActivePinia(createPinia());
  const auth = useIpdAuthStore();
  auth.token = 'test-session';
});
afterEach(() => vi.unstubAllGlobals());

describe('audit scope paging contract', () => {
  it('requests /audit-logs/scope with paging params only (backend accepts no cursor)', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      envelope({ scope: 'OWN', operatorIds: ['9007199254740993'], page: { records: [], total: 0, current: 2, size: 20, pages: 0 } }),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await pageAuditByScope(2, 20);
    expect(result.scope).toBe('OWN');
    const url = new URL(fetcher.mock.calls[0]![0] as string, 'http://ipd.local');
    expect(url.pathname).toBe('/api/v1/audit-logs/scope');
    expect(url.searchParams.get('pageNo')).toBe('2');
    expect(url.searchParams.get('pageSize')).toBe('20');
    // 后端不收 beforeSeq（曾误发被静默丢弃）——契约保证永不发送。
    expect(url.searchParams.has('beforeSeq')).toBe(false);
  });

  it('keeps verify GET and rebuild POST on the admin-only endpoints', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(envelope({ broken: 0, hashBroken: 0, gaps: 0, chain: 'OK', total: 334, genesis: 'GENESIS' }))
      .mockResolvedValueOnce(envelope({ exported: 334, scope: 'GLOBAL' }))
      .mockResolvedValueOnce(envelope({ fixed: 3 }));
    vi.stubGlobal('fetch', fetcher);
    const verdict = await verifyAuditChain();
    expect(verdict.chain).toBe('OK');
    await exportAuditByScope();
    const rebuild = await rebuildAuditChain();
    expect(rebuild.fixed).toBe(3);
    const calls = fetcher.mock.calls.map((call) => [call[0] as string, (call[1] as RequestInit).method] as const);
    expect(calls).toEqual([
      ['/api/v1/audit-logs/verify', 'GET'],
      ['/api/v1/audit-logs/export/scope', 'GET'],
      ['/api/v1/audit-logs/rebuild-chain', 'POST'],
    ]);
  });
});

describe('audit payload parsing and project filtering', () => {
  it('parses JSON objects, tolerates invalid payloads, and treats blanks as null', () => {
    expect(parseAuditPayload('{"status":"ACTIVE"}')).toEqual({ status: 'ACTIVE' });
    expect(parseAuditPayload('not-json')).toBe('not-json');
    expect(parseAuditPayload('')).toBeNull();
    expect(parseAuditPayload(undefined)).toBeNull();
    expect(parseAuditPayload(null)).toBeNull();
    expect(parseAuditPayload('42')).toBe('42');
  });

  it('filters current-page logs to the requested project entity', () => {
    const logs: AuditLog[] = [
      { id: '1', seq: 3, operatorId: '9', action: 'UPDATE', entityId: '42' },
      { id: '2', seq: 2, operatorId: '9', action: 'CREATE', entityId: '43' },
      { id: '3', seq: 1, operatorId: '9', action: 'TRANSIT' },
    ];
    expect(filterAuditByEntity(logs, '42')).toHaveLength(1);
    expect(filterAuditByEntity(logs, '42')[0]!.action).toBe('UPDATE');
    expect(filterAuditByEntity(logs, '999')).toHaveLength(0);
  });
});
