import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPlatformAccessCodes } from './auth';

/**
 * 2026-10-07 非超管平台按钮断链修复：换票后补取映射账号平台 RBAC 码（fetchPlatformAccessCodes）。
 * 契约：
 * - 成功：解析 data.permissions 字符串数组（过滤非字符串/空串）；
 * - 网络异常 / 非 2xx / 形状异常：一律空数组返回（best-effort 降级，绝不抛错）——
 *   调用方（renewPlatformSession）据此保证会话建立不被平台码补装失败阻断。
 * 通道：原生 fetch 直取 /api/system/user/getInfo（避开 requestClient 的 401 换票重入拦截）。
 */
function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function statusResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

describe('fetchPlatformAccessCodes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('成功：解析并过滤 data.permissions（非字符串/空串剔除）', async () => {
    const fetcher = vi.fn(async () =>
      okJson({
        code: 200,
        data: { permissions: ['system:info:add', '', 42, null, 'ipd:project:list'] },
      }),
    );
    vi.stubGlobal('fetch', fetcher);

    await expect(fetchPlatformAccessCodes('plat-t', 'cid-1')).resolves.toEqual([
      'system:info:add',
      'ipd:project:list',
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/system/user/getInfo',
      expect.objectContaining({
        headers: { Authorization: 'Bearer plat-t', ClientID: 'cid-1' },
        method: 'GET',
      }),
    );
  });

  it('非 2xx（401）：返回空数组，不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => statusResponse(401)));
    await expect(fetchPlatformAccessCodes('t', 'c')).resolves.toEqual([]);
  });

  it('形状异常（permissions 非数组）：返回空数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ code: 200, data: { permissions: 'nope' } })));
    await expect(fetchPlatformAccessCodes('t', 'c')).resolves.toEqual([]);
  });

  it('网络异常（fetch reject）：返回空数组，不抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    await expect(fetchPlatformAccessCodes('t', 'c')).resolves.toEqual([]);
  });
});
