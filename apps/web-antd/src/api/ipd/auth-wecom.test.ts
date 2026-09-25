/**
 * 企微 Mock 扫码登录契约测试（R215 WP3.1 批次 = ORPHAN-A12；IpdAuthController /auth/wecom/qr-login）。
 *
 * 安全口径（R214/U0）：开关默认关——负例为主：
 * - 开关关：409 + code 50019（QR_LOGIN_NOT_ENABLED）→ IpdRequestError 专用文案、code 原样保留；
 * - 未绑定：404 + 50001「账号未绑定」走通用通道；
 * - 成功路径：与 /auth/login 同构 LoginView（token/expiresIn/person.id 字符串）；
 * - 形状漂移：缺 token/expiresIn 的响应不得入库（protocol 拒绝）。
 */
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpdRequestError } from './auth';
import {
  WECOM_QR_LOGIN_NOT_ENABLED_CODE,
  WECOM_QR_LOGIN_NOT_ENABLED_TEXT,
  wecomQrLogin,
} from './auth-wecom';

const envelope = (data: unknown, status = 200, code = 0, message?: string): Response =>
  new Response(
    JSON.stringify({ code, message: message ?? (code === 0 ? 'success' : '操作失败'), data, timestamp: '2026-09-25T00:00:00Z', traceId: 'fixture' }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const loginViewFixture = {
  token: 'mock-jwt-token',
  tokenType: 'Bearer',
  expiresIn: 7200,
  scope: 'FULL',
  mustChangePwd: false,
  person: {
    id: '7',
    name: '接手人',
    username: '接手人',
    personType: 'MARKET_PM',
    groupId: '12',
    accountStatus: 'ACTIVE',
    permissionCodes: ['ipd:project:read'],
  },
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('企微 Mock 扫码登录（R215 A12）', () => {
  it('wecomQrLogin(u7) → POST /auth/wecom/qr-login，body 只含 wecomUserId，无 Authorization 头（匿名端点）', async () => {
    const fetcher = vi.fn().mockResolvedValue(envelope(loginViewFixture));
    vi.stubGlobal('fetch', fetcher);
    const r = await wecomQrLogin('u7');
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe('/api/v1/auth/wecom/qr-login');
    expect(call[1]?.method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ wecomUserId: 'u7' });
    expect((call[1].headers as Record<string, string>).Authorization).toBeUndefined();
    // LoginView 同构：token/expiresIn 透传，identity 经 parseIdentity 校验（person.id 字符串）
    expect(r.token).toBe('mock-jwt-token');
    expect(r.expiresIn).toBe(7200);
    expect(r.tokenType).toBe('Bearer');
    expect(r.scope).toBe('FULL');
    expect(r.person.id).toBe('7');
    expect(r.person.permissionCodes).toEqual(['ipd:project:read']);
  });

  it('负例（安全口径主路径）：开关关 → 409 + 50019 → IpdRequestError 专用文案，code/status 原样保留', async () => {
    const rejected = vi.fn().mockResolvedValue(
      envelope(null, 409, 50019, '企微扫码登录未启用（需 ipd.auth.qr-login.enabled=true）'),
    );
    vi.stubGlobal('fetch', rejected);
    const cause = await wecomQrLogin('u7').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    const err = cause as IpdRequestError;
    expect(err.code).toBe(WECOM_QR_LOGIN_NOT_ENABLED_CODE);
    expect(err.code).toBe(50019);
    expect(err.status).toBe(409);
    expect(err.message).toBe(WECOM_QR_LOGIN_NOT_ENABLED_TEXT);
    // envelopeMessage 保留后端原文（不泄露开关配置细节之外的语义）
    expect(err.envelopeMessage).toContain('ipd.auth.qr-login.enabled');
  });

  it('负例：未绑定企微 → 404 + 50001「账号未绑定」走 IpdRequestError 通用通道（不泄露在职状态）', async () => {
    const notBound = vi.fn().mockResolvedValue(
      envelope(null, 404, 50001, '账号未绑定，请联系管理员'),
    );
    vi.stubGlobal('fetch', notBound);
    const cause = await wecomQrLogin('ghost-user').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(50001);
    expect((cause as IpdRequestError).status).toBe(404);
  });

  it('负例：形状漂移（缺 token / expiresIn 非正整数）不得当有效会话入库', async () => {
    const drifted = vi.fn().mockResolvedValue(envelope({ ...loginViewFixture, token: '' }));
    vi.stubGlobal('fetch', drifted);
    const cause1 = await wecomQrLogin('u7').catch((e: unknown) => e);
    expect(cause1).toBeInstanceOf(IpdRequestError);
    expect((cause1 as IpdRequestError).kind).toBe('protocol');

    const drifted2 = vi.fn().mockResolvedValue(envelope({ ...loginViewFixture, expiresIn: 0 }));
    vi.stubGlobal('fetch', drifted2);
    const cause2 = await wecomQrLogin('u7').catch((e: unknown) => e);
    expect(cause2).toBeInstanceOf(IpdRequestError);
    expect((cause2 as IpdRequestError).kind).toBe('protocol');
  });

  it('负例：限流（400 + 10001「扫码登录尝试过于频繁」）透传后端原文语义', async () => {
    const limited = vi.fn().mockResolvedValue(
      envelope(null, 400, 10001, '扫码登录尝试过于频繁，请稍后再试'),
    );
    vi.stubGlobal('fetch', limited);
    const cause = await wecomQrLogin('u7').catch((e: unknown) => e);
    expect(cause).toBeInstanceOf(IpdRequestError);
    expect((cause as IpdRequestError).code).toBe(10001);
    expect((cause as IpdRequestError).envelopeMessage).toContain('过于频繁');
  });
});
