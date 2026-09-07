/**
 * http.ts 入口契约测试：buildQuery 查询串拼装、四种动词到 authenticatedRequest 的委派、空查询省略、返回值透传。
 * 仅覆盖 IPD 业务统一入口的胶水逻辑：业务 envelope 校验在 useIpdAuthStore.authenticatedRequest 层单独覆盖，
 * 此处通过 vi.mock 将其隔离，避免与 auth store 自身测试产生耦合。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ipdGet, ipdPost, ipdPut } from './http';

vi.mock('../../store/ipd-auth', () => ({
  useIpdAuthStore: vi.fn(),
}));

import { useIpdAuthStore } from '../../store/ipd-auth';

const mockedUseIpdAuthStore = vi.mocked(useIpdAuthStore);

let authRequest: ReturnType<typeof vi.fn>;

beforeEach(() => {
  authRequest = vi.fn();
  mockedUseIpdAuthStore.mockReturnValue({
    authenticatedRequest: authRequest,
  } as unknown as ReturnType<typeof useIpdAuthStore>);
});

afterEach(() => {
  vi.clearAllMocks();
});

function lastCall(): { args: unknown[] } {
  expect(authRequest).toHaveBeenCalledTimes(1);
  const call = authRequest.mock.calls[0];
  expect(call).toBeDefined();
  return { args: call as unknown[] };
}

describe('buildQuery — 查询串拼装', () => {
  it('丢弃 null / undefined / 空字符串，保留字符串原样、数字与布尔经 String() 强转', async () => {
    authRequest.mockResolvedValueOnce({ ok: true });
    await ipdGet('/api/v1/foo', {
      a: 'x',
      b: undefined,
      c: null,
      d: '',
      e: 42,
      f: true,
    });

    const { args } = lastCall();
    expect(args[0]).toBe('/api/v1/foo?a=x&e=42&f=true');
    // 第二参数未传入 method/body，不应是 { method: undefined } 这类显式对象。
    expect(args[1]).toBeUndefined();
  });

  it('字符串值不做多余编码之外的转换（URLSearchParams 原生行为）', async () => {
    authRequest.mockResolvedValueOnce({});
    await ipdGet('/api/v1/bar', { name: 'hello-world', level: 'L3' });
    const { args } = lastCall();
    expect(args[0]).toBe('/api/v1/bar?name=hello-world&level=L3');
  });

  it('浮点数与负数同样经 String() 强转', async () => {
    authRequest.mockResolvedValueOnce({});
    await ipdGet('/api/v1/baz', { amount: 3.14, offset: -5, zero: 0 });
    const { args } = lastCall();
    expect(args[0]).toBe('/api/v1/baz?amount=3.14&offset=-5&zero=0');
  });

  it('对象全为 null/undefined/空串时返回空字符串而非 "??"', async () => {
    authRequest.mockResolvedValueOnce({});
    await ipdGet('/api/v1/empty', { a: undefined, b: null, c: '' });
    const { args } = lastCall();
    expect(args[0]).toBe('/api/v1/empty');
  });
});

describe('动词委派到 authenticatedRequest', () => {
  it('ipdGet 仅传 path（带查询串），不附加 method/body', async () => {
    authRequest.mockResolvedValueOnce({ items: [] });
    const result = await ipdGet<{ items: unknown[] }>('/api/v1/items', { page: 1, size: 20 });
    const { args } = lastCall();
    expect(args[0]).toBe('/api/v1/items?page=1&size=20');
    expect(args[1]).toBeUndefined();
    expect(result).toEqual({ items: [] });
  });

  it('ipdPost 同时传 path + 查询串，附加 method=POST 与 body', async () => {
    authRequest.mockResolvedValueOnce({ id: 'NEW' });
    const body = { name: 'n', amount: '100.00' };
    const result = await ipdPost<{ id: string }>(
      '/api/v1/things',
      body,
      { projectId: '100' },
    );
    const { args } = lastCall();
    expect(args[0]).toBe('/api/v1/things?projectId=100');
    expect(args[1]).toEqual({ body, method: 'POST' });
    expect(result).toEqual({ id: 'NEW' });
  });

  it('ipdPost 无 body 与无 query 时，仍固定传 method=POST，path 不带 ?', async () => {
    authRequest.mockResolvedValueOnce({ ok: true });
    await ipdPost('/api/v1/ping');
    const { args } = lastCall();
    expect(args[0]).toBe('/api/v1/ping');
    expect(args[1]).toEqual({ body: undefined, method: 'POST' });
  });

  it('ipdPut 传 path（无 query），附加 method=PUT 与 body', async () => {
    authRequest.mockResolvedValueOnce({ updated: 1 });
    const body = { name: 'renamed', level: 'L5' };
    const result = await ipdPut<{ updated: number }>('/api/v1/things/9001', body);
    const { args } = lastCall();
    expect(args[0]).toBe('/api/v1/things/9001');
    expect(args[1]).toEqual({ body, method: 'PUT' });
    expect(result).toEqual({ updated: 1 });
  });

  it('ipdPut 不接受 query 参数（签名保证）—— query 不会出现在 path 上', async () => {
    authRequest.mockResolvedValueOnce({});
    // ipdPut 签名只有 (path, body)，即使 buildQuery 不可达也必须保持 path 不被追加 ?
    await ipdPut('/api/v1/static', { kind: 'KEEP' });
    const { args } = lastCall();
    expect(args[0]).toBe('/api/v1/static');
    expect(args[0]).not.toContain('?');
  });
});

describe('空查询省略', () => {
  it('ipdGet 无第二参数时 path 不带 ?', async () => {
    authRequest.mockResolvedValueOnce({});
    await ipdGet('/api/v1/x');
    const { args } = lastCall();
    expect(args[0]).toBe('/api/v1/x');
    expect(args[0]).not.toContain('?');
  });

  it('ipdGet 第二参数为空对象 {} 时 path 不带 ?', async () => {
    authRequest.mockResolvedValueOnce({});
    await ipdGet('/api/v1/x', {});
    const { args } = lastCall();
    expect(args[0]).toBe('/api/v1/x');
    expect(args[0]).not.toContain('?');
  });
});

describe('返回值透传', () => {
  it('authenticatedRequest 的原始返回值原样透传给调用方（保持引用）', async () => {
    const payload = { code: 0, rows: [{ id: '1' }, { id: '2' }] };
    authRequest.mockResolvedValueOnce(payload);
    const result = await ipdGet<typeof payload>('/api/v1/rows');
    expect(result).toBe(payload);
  });

  it('authenticatedRequest 返回 falsy 值也能透传（null / 0）', async () => {
    authRequest.mockResolvedValueOnce(null);
    await expect(ipdGet('/api/v1/null')).resolves.toBeNull();

    authRequest.mockResolvedValueOnce(0);
    await expect(ipdGet('/api/v1/zero')).resolves.toBe(0);
  });

  it('authenticatedRequest reject 的错误原样抛给调用方', async () => {
    const boom = new Error('upstream 502');
    authRequest.mockRejectedValueOnce(boom);
    await expect(ipdGet('/api/v1/down')).rejects.toBe(boom);
  });
});
