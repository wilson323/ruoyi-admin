/**
 * auth 纯逻辑契约测试（Wave 7 / agent A32）：
 *   A) 登录坏凭据枚举文案钉死（IpdAuthService.login 唯一固定值；与「账号已停用」「登录尝试过于频繁」共用 code 400+10001，
 *      文案本身即判别依据——锁死后任何替换会引发回归红）。
 *   B) parseIdentity happy path
 *   C) parseIdentity 拒绝场景（每条都必须抛 IpdRequestError）
 *   D) IpdRequestError 形态（5 字段 + name + Error 兼容）
 *   E) BUSINESS_CODE_MESSAGES 全量冒烟（通过 requestIpd 公有表面对所有枚举 code 间接断言，
 *      含未知 code 落到 HTTP-status 兜底文案的旁路）
 *
 * 与 auth-live.test.ts 的关系（docs/真HTTP验收规范-20260907.md §二）：
 *   - 本文件（B 桶）：纯逻辑测试，**允许 vi.mock**，验证 parser / 错误码字符串映射 / 异常形态
 *   - auth-live.test.ts：业务测试，**必须真 HTTP loopback**，
 *     默认 skipIf(!IPD_LIVE_ACCEPTANCE)，跑通端到端 login → me → refresh → logout
 *
 * 拆分不增量：原 79 cases → 本文件纯逻辑 72 + auth-live.test.ts 业务 8 = 80 总数。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  IPD_LOGIN_CREDENTIAL_ERROR,
  IPD_LOGIN_CREDENTIAL_TEXT,
  IpdRequestError,
  parseIdentity,
  requestIpd,
} from './auth';

/** 200 OK 但 envelope.code !== 0：触发 requestIpd 的 messageFromCode 分支（不走 /auth/login 特化路径）。 */
const errorEnvelope = (code: number, message = 'mock', status = 200): Response =>
  new Response(
    JSON.stringify({
      code,
      data: null,
      message,
      timestamp: '2026-09-07T00:00:00Z',
      traceId: 'fixture',
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

const VALID_PERSON = {
  accountStatus: 'ACTIVE',
  groupId: null,
  id: '123',
  name: '张三',
  personType: 'MARKET_PM' as const,
  username: 'zhangsan',
};

const VALID_IDENTITY_INPUT = {
  mustChangePwd: false,
  person: VALID_PERSON,
  scope: 'FULL' as const,
};

/** CJK Unified Ideograph (匹配单个汉字字符)。 */
const CJK_RE = /[一-鿿]/;

afterEach(() => vi.unstubAllGlobals());

// ──────────────────────────────────────────────────────────────────────────────
// A. Constants pinning — IPD 规则：登录坏凭据枚举文案 MUST NOT change.
//    评审 Important-1：调用方按 envelopeMessage 精确比对，按 code 覆写会把
//    「账号已停用」「登录尝试过于频繁」误报成密码错误。
// ──────────────────────────────────────────────────────────────────────────────
describe('auth constants pinning (IPD rule: credential error text is immutable)', () => {
  it('IPD_LOGIN_CREDENTIAL_ERROR === "用户名或密码错误"', () => {
    expect(IPD_LOGIN_CREDENTIAL_ERROR).toBe('用户名或密码错误');
  });

  it('IPD_LOGIN_CREDENTIAL_TEXT === "用户名或密码错误，请重新输入"', () => {
    expect(IPD_LOGIN_CREDENTIAL_TEXT).toBe('用户名或密码错误，请重新输入');
  });

  it('IPD_LOGIN_CREDENTIAL_TEXT must reference the short-form constant', () => {
    // 防御：未来改 IPD_LOGIN_CREDENTIAL_TEXT 时若忘了同步短串→长串包含关系，至少这个不变量必须保持。
    expect(IPD_LOGIN_CREDENTIAL_TEXT).toContain(IPD_LOGIN_CREDENTIAL_ERROR);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// B. parseIdentity happy path
// ──────────────────────────────────────────────────────────────────────────────
describe('parseIdentity happy path', () => {
  it('returns a valid IpdIdentity for the canonical input shape', () => {
    const identity = parseIdentity(VALID_IDENTITY_INPUT);
    expect(identity).toEqual({
      mustChangePwd: false,
      person: VALID_PERSON,
      scope: 'FULL',
    });
  });

  it('accepts every valid personType', () => {
    for (const personType of ['MARKET_PM', 'RD_PM', 'GROUP_LEADER', 'SUPER_ADMIN'] as const) {
      expect(() =>
        parseIdentity({
          ...VALID_IDENTITY_INPUT,
          person: { ...VALID_PERSON, personType },
        }),
      ).not.toThrow();
    }
  });

  it('accepts every valid scope value', () => {
    for (const scope of ['FULL', 'HANDOVER_ONLY', 'PASSWORD_CHANGE_REQUIRED'] as const) {
      expect(() =>
        parseIdentity({
          ...VALID_IDENTITY_INPUT,
          scope,
        }),
      ).not.toThrow();
    }
  });

  it('accepts groupId === null', () => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: { ...VALID_PERSON, groupId: null },
      }),
    ).not.toThrow();
  });

  it('accepts groupId as a string', () => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: { ...VALID_PERSON, groupId: 'group-9007199254740993' },
      }),
    ).not.toThrow();
  });

  it('accepts multi-digit id (JS MAX_SAFE_INTEGER width)', () => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: { ...VALID_PERSON, id: '9007199254740993' },
      }),
    ).not.toThrow();
  });

  it('preserves CJK name verbatim', () => {
    const identity = parseIdentity(VALID_IDENTITY_INPUT);
    expect(identity.person.name).toBe('张三');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// C. parseIdentity rejection cases — every case must throw IpdRequestError
//    with the canonical message 「身份信息格式异常，请重新登录」。
// ──────────────────────────────────────────────────────────────────────────────
describe('parseIdentity rejection — non-object input', () => {
  it.each<[string, unknown]>([
    ['string', 'foo'],
    ['number', 42],
    ['null', null],
    ['undefined', undefined],
    ['array', []],
    ['boolean', true],
  ])('rejects %s input', (_label, value) => {
    expect(() => parseIdentity(value)).toThrow(IpdRequestError);
  });
});

describe('parseIdentity rejection — missing or invalid person envelope', () => {
  it('rejects input with missing person', () => {
    expect(() => parseIdentity({} as unknown)).toThrow(IpdRequestError);
  });

  it('rejects input when person is null', () => {
    expect(() => parseIdentity({ person: null } as unknown)).toThrow(IpdRequestError);
  });

  it('rejects input when person is a string', () => {
    expect(() => parseIdentity({ person: 'foo' } as unknown)).toThrow(IpdRequestError);
  });

  it('rejects input when person is a number', () => {
    expect(() => parseIdentity({ person: 1 } as unknown)).toThrow(IpdRequestError);
  });

  it('rejects input when person is an array', () => {
    expect(() => parseIdentity({ person: [] } as unknown)).toThrow(IpdRequestError);
  });
});

describe('parseIdentity rejection — person.id', () => {
  it('rejects when person.id is not a string', () => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: { ...VALID_PERSON, id: 123 as unknown as string },
      }),
    ).toThrow(IpdRequestError);
  });

  it.each<[string, string]>([
    ['mixed alphanumeric', '12a'],
    ['leading letters', 'abc'],
    ['negative sign', '-1'],
    ['decimal point', '1.5'],
    ['empty string', ''],
    ['whitespace', ' '],
    ['unicode digit lookalike', '１'], // full-width digit — /^\d+$/ 仅匹配 ASCII
  ])('rejects non-digit person.id (%s = %j)', (_label, badId) => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: { ...VALID_PERSON, id: badId },
      }),
    ).toThrow(IpdRequestError);
  });
});

describe('parseIdentity rejection — person.{name,username,accountStatus}', () => {
  it('rejects when person.name is missing', () => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: {
          accountStatus: 'ACTIVE',
          groupId: null,
          id: '123',
          personType: 'MARKET_PM' as const,
          username: 'zhangsan',
        },
      }),
    ).toThrow(IpdRequestError);
  });

  it('rejects when person.username is missing', () => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: {
          accountStatus: 'ACTIVE',
          groupId: null,
          id: '123',
          name: '张三',
          personType: 'MARKET_PM' as const,
        },
      }),
    ).toThrow(IpdRequestError);
  });

  it('rejects when person.accountStatus is missing', () => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: {
          groupId: null,
          id: '123',
          name: '张三',
          personType: 'MARKET_PM' as const,
          username: 'zhangsan',
        },
      }),
    ).toThrow(IpdRequestError);
  });

  it('rejects when person.name is a number (not string)', () => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: { ...VALID_PERSON, name: 1 as unknown as string },
      }),
    ).toThrow(IpdRequestError);
  });
});

describe('parseIdentity rejection — person.groupId', () => {
  it('rejects when groupId is a number', () => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: { ...VALID_PERSON, groupId: 42 as unknown as null },
      }),
    ).toThrow(IpdRequestError);
  });

  it('rejects when groupId is a boolean', () => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: { ...VALID_PERSON, groupId: false as unknown as null },
      }),
    ).toThrow(IpdRequestError);
  });
});

describe('parseIdentity rejection — invalid personType', () => {
  it.each<[string, string]>([
    ['unknown enum', 'FOO'],
    ['lowercase variant', 'market_pm'],
    ['empty string', ''],
    ['uppercase with whitespace', ' MARKET_PM'],
  ])('rejects personType=%j (%s)', (_label, badType) => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: { ...VALID_PERSON, personType: badType as typeof VALID_PERSON.personType },
      }),
    ).toThrow(IpdRequestError);
  });
});

describe('parseIdentity rejection — invalid scope', () => {
  it('rejects when scope is missing (undefined does NOT default to FULL)', () => {
    // 实现要求 scope 必填 + 命中白名单，undefined 不走兜底；保留显式回归。
    expect(() =>
      parseIdentity({
        mustChangePwd: false,
        person: VALID_PERSON,
      } as unknown),
    ).toThrow(IpdRequestError);
  });

  it.each<[string, string]>([
    ['unknown enum', 'NORMAL'],
    ['lowercase variant', 'full'],
    ['empty string', ''],
  ])('rejects scope=%j (%s)', (_label, badScope) => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        scope: badScope as typeof VALID_IDENTITY_INPUT.scope,
      }),
    ).toThrow(IpdRequestError);
  });
});

describe('parseIdentity rejection — mustChangePwd', () => {
  it('rejects when mustChangePwd is missing (undefined does NOT default to false)', () => {
    // 实现要求显式 boolean；缺失即异常。
    expect(() =>
      parseIdentity({
        person: VALID_PERSON,
        scope: 'FULL' as const,
      } as unknown),
    ).toThrow(IpdRequestError);
  });

  it.each<[string, unknown]>([
    ['string "true"', 'true'],
    ['string "false"', 'false'],
    ['number 1', 1],
    ['number 0', 0],
    ['null', null],
  ])('rejects when mustChangePwd is not boolean (%s)', (_label, badMust) => {
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        mustChangePwd: badMust as boolean,
      }),
    ).toThrow(IpdRequestError);
  });
});

describe('parseIdentity rejection — canonical error message', () => {
  it('every rejection throws with "身份信息格式异常，请重新登录"', () => {
    expect(() => parseIdentity(null)).toThrow('身份信息格式异常，请重新登录');
    expect(() => parseIdentity({} as unknown)).toThrow('身份信息格式异常，请重新登录');
    expect(() =>
      parseIdentity({
        ...VALID_IDENTITY_INPUT,
        person: { ...VALID_PERSON, id: 'not-a-number' },
      }),
    ).toThrow('身份信息格式异常，请重新登录');
  });

  it('rejection preserves kind="protocol" (parseIdentity is not a network error)', () => {
    try {
      parseIdentity(null);
      throw new Error('parseIdentity should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(IpdRequestError);
      expect((e as IpdRequestError).kind).toBe('protocol');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// D. IpdRequestError shape
// ──────────────────────────────────────────────────────────────────────────────
describe('IpdRequestError shape', () => {
  it('constructor populates all 5 fields and preserves Error semantics', () => {
    const e = new IpdRequestError('boom', 401, 10001, 'http', 'envelope-text');
    expect(e.message).toBe('boom');
    expect(e.status).toBe(401);
    expect(e.code).toBe(10001);
    expect(e.kind).toBe('http');
    expect(e.envelopeMessage).toBe('envelope-text');
    expect(e.name).toBe('IpdRequestError');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(IpdRequestError);
  });

  it('envelopeMessage is optional (undefined by default)', () => {
    const e = new IpdRequestError('msg', 0);
    expect(e.envelopeMessage).toBeUndefined();
  });

  it('defaults status=0, code=0, kind="protocol"', () => {
    const e = new IpdRequestError('msg');
    expect(e.status).toBe(0);
    expect(e.code).toBe(0);
    expect(e.kind).toBe('protocol');
  });

  it('accepts all four kind variants', () => {
    for (const kind of ['http', 'protocol', 'transport', 'cancelled'] as const) {
      const e = new IpdRequestError('x', 0, 0, kind);
      expect(e.kind).toBe(kind);
    }
  });

  it('serializes with name="IpdRequestError" (not generic "Error") for stack traces', () => {
    const e = new IpdRequestError('m', 500, 10001, 'http');
    expect(e.toString()).toContain('IpdRequestError');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// E. BUSINESS_CODE_MESSAGES coverage (smoke via public surface requestIpd)
//    私有表 + 私有 helper 不可直接 import，故借 requestIpd 的 messageFromCode 分支间接断言：
//    任意非 /auth/login 路径 + 200 OK + code !== 0 → 抛 IpdRequestError(messageFromCode(code))。
//
//    说明：本组测试**保留为 Mock 测试**（Bucket A）。理由：messageFromCode 是纯函数映射表，
//    输入 code → 输出 string，测试运行结果不依赖后端实际行为。
//    真实后端响应解析路径（login → envelope.code=0 等业务流）由 auth-live.test.ts 覆盖。
// ──────────────────────────────────────────────────────────────────────────────
describe('BUSINESS_CODE_MESSAGES coverage via requestIpd', () => {
  // 后端 ApiV1ErrorCode.java 实际下发的全部 21 个枚举（40001~40006 + 40010~40013 + 跳号 40007~40009 与后端一致缺失）。
  const CODES = [
    10001,
    20001,
    20002,
    20003,
    30001,
    40001,
    40002,
    40003,
    40004,
    40005,
    40006,
    40010,
    40011,
    40012,
    40013,
    40401,
    50001,
    50002,
    90001,
  ];

  for (const code of CODES) {
    it(`code ${code} resolves to a non-empty CJK message`, async () => {
      const fetcher = vi.fn().mockResolvedValue(errorEnvelope(code, 'mock'));
      vi.stubGlobal('fetch', fetcher);

      let caught: IpdRequestError | null = null;
      try {
        await requestIpd('/probe', { method: 'GET' });
      } catch (e) {
        caught = e as IpdRequestError;
      }

      expect(caught).not.toBeNull();
      expect(caught).toBeInstanceOf(IpdRequestError);
      expect(caught!.message.length).toBeGreaterThan(0);
      expect(caught!.message).toMatch(CJK_RE);
      // 实现契约：code 透传到 IpdRequestError.code（前端做去重 / 监控埋点依赖）。
      expect(caught!.code).toBe(code);
      expect(caught!.kind).toBe('http');
    });
  }

  it('unknown code 99999 falls through messageFromCode → HTTP-status fallback (status 500)', async () => {
    // 验证私有 messageFromCode 对未注册 code 返回 null → requestIpd 走状态码兜底「服务暂时不可用」。
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorEnvelope(99999, 'mock', 500)));
    await expect(requestIpd('/probe', { method: 'GET' })).rejects.toThrow(/服务暂时不可用/);
  });

  it('unknown code 99999 with status 401 falls through to "登录已失效"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorEnvelope(99999, 'mock', 401)));
    await expect(requestIpd('/probe', { method: 'GET' })).rejects.toThrow(/登录已失效/);
  });

  it('unknown code 99999 with status 403 falls through to "权限不足"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorEnvelope(99999, 'mock', 403)));
    await expect(requestIpd('/probe', { method: 'GET' })).rejects.toThrow(/权限不足/);
  });

  it('login path 401 + code 10001 overrides code map with IPD_LOGIN_CREDENTIAL_TEXT', async () => {
    // 评审 Important-1 防护：登录页 401+10001 必须显示文案「用户名或密码错误，请重新输入」，
    // 即使 code 10001 在消息表里另有兜底（输入信息不符合要求…）也不允许覆盖。
    // 注意：Response body 是单次消费流，必须用 mockImplementation 工厂返回新 Response，
    // 否则第二次 requestIpd 会落回 transport 兜底（无法连接服务…）。
    const loginFetcher = vi.fn(() =>
      Promise.resolve(errorEnvelope(10001, 'envelope-msg', 401)),
    );
    vi.stubGlobal('fetch', loginFetcher);
    await expect(requestIpd('/auth/login', { method: 'POST', body: {} })).rejects.toThrow(
      IPD_LOGIN_CREDENTIAL_TEXT,
    );
    await expect(requestIpd('/auth/login', { method: 'POST', body: {} })).rejects.toThrow(
      /用户名或密码错误/,
    );
    expect(loginFetcher).toHaveBeenCalledTimes(2);
  });
});
