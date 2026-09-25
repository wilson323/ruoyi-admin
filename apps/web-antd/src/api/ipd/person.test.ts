/**
 * 人员治理 API 契约测试（R215 WP3.1 批次2 = ORPHAN-A11；PersonController resign/wecom-unbind）。
 *
 * 重点覆盖：
 * - resignPerson：POST /persons/{id}/resign + body {reason} + ResignView 透传；
 * - unbindWecom：POST /persons/{id}/wecom/unbind + PersonView（weComUserId 脱敏）；
 * - id URL 编码；错误传播。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import { rehirePerson, resignPerson, unbindWecom } from './person';

const envelope = (data: unknown, status = 200, code = 0): Response =>
  new Response(
    JSON.stringify({ code, message: code === 0 ? 'success' : '操作失败', data, timestamp: '2026-09-24T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const resignFixture = {
  idempotent: false,
  pendingProjects: 2,
  message: '离职已触发，待移交 2 个项目',
  wecomUnbound: true,
  sessionsRevoked: true,
  notificationsSent: 3,
};

const unbindFixture = {
  id: '900101',
  name: '张三',
  employmentStatus: 'ACTIVE',
  accountStatus: 'ACTIVE',
  wecomUserId: '***',
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('人员治理 API（R215 A11）', () => {
  it('resignPerson(900101) → POST /persons/900101/resign，body 只含 reason，透传 ResignView', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(resignFixture));
    vi.stubGlobal('fetch', fetcher);
    const r = await resignPerson('900101', '转岗离职');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/persons/900101/resign');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ reason: '转岗离职' });
    expect(r.pendingProjects).toBe(2);
    expect(r.wecomUnbound).toBe(true);
    expect(r.sessionsRevoked).toBe(true);
    expect(r.notificationsSent).toBe(3);
  });

  it('unbindWecom(900101) → POST /persons/900101/wecom/unbind，PersonView 透传（脱敏 ***）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(unbindFixture));
    vi.stubGlobal('fetch', fetcher);
    const r = await unbindWecom('900101', '企微账号更换');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/persons/900101/wecom/unbind');
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ reason: '企微账号更换' });
    expect(r.wecomUserId).toBe('***');
    expect(r.accountStatus).toBe('ACTIVE');
  });

  it('id URL 编码（防路径注入）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(unbindFixture));
    vi.stubGlobal('fetch', fetcher);
    await unbindWecom('90/01 x', 'r');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/persons/90%2F01%20x/wecom/unbind');
  });

  it('幂等离职（idempotent=true）与 403 权限拒绝均走 IpdRequestError 通道', async () => {
    // idempotent=true 是正常 200 响应内容，不是错误
    const fetcher = vi.fn().mockResolvedValue(envelope({ ...resignFixture, idempotent: true, pendingProjects: 0 }));
    vi.stubGlobal('fetch', fetcher);
    const r = await resignPerson('900101', '重复触发');
    expect(r.idempotent).toBe(true);

    const denied = vi.fn().mockResolvedValue(envelope(null, 403, 30001));
    vi.stubGlobal('fetch', denied);
    await expect(unbindWecom('900101', 'r')).rejects.toBeInstanceOf(IpdRequestError);
  });
});

describe('人员复职（R215 GAP-F3 · PersonController#rehire AC-USER-09）', () => {
  it('rehirePerson(900101) → POST /persons/900101/rehire，note 省略时 body {}（不塞 null/空串）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({ ...unbindFixture, employmentStatus: 'ACTIVE', accountStatus: 'ACTIVE' }));
    vi.stubGlobal('fetch', fetcher);
    const r = await rehirePerson('900101');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/persons/900101/rehire');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({});
    expect(r.employmentStatus).toBe('ACTIVE');
  });

  it('rehirePerson(id, 返岗说明) → body 仅含 note 单键', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(unbindFixture));
    vi.stubGlobal('fetch', fetcher);
    await rehirePerson('900101', '返岗说明');
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ note: '返岗说明' });
  });

  it('PersonView 透传：id 恒 string + wecomUserId 后端脱敏 "***"', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope({
      id: '2096266884247736321', name: '李四', employmentStatus: 'ACTIVE', accountStatus: 'ACTIVE', wecomUserId: '***',
    }));
    vi.stubGlobal('fetch', fetcher);
    const r = await rehirePerson('2096266884247736321');
    expect(typeof r.id).toBe('string');
    expect(r.id).toBe('2096266884247736321'); // 19 位雪花逐字符无损（后端 String.valueOf，PersonController.java:61）
    expect(r.wecomUserId).toBe('***');
  });

  it('19 位雪花 personId → URL 逐字符无损（禁 Number 塌缩）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(unbindFixture));
    vi.stubGlobal('fetch', fetcher);
    await rehirePerson('2096266884247736321', 'n');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/persons/2096266884247736321/rehire');
  });

  it('权限负例：非组长/超管 403/30001 → IpdRequestError（requireLeaderOrAdmin）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 403, 30001)));
    await expect(rehirePerson('900101')).rejects.toBeInstanceOf(IpdRequestError);
  });

  it('状态冲突：DISABLED 账户复职被 50002 拒「需先解禁」→ 错误透传不吞', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope(null, 409, 50002)));
    const cause = await rehirePerson('900101').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(50002);
  });
});
