export type IpdScope = 'FULL' | 'HANDOVER_ONLY' | 'PASSWORD_CHANGE_REQUIRED';
export type IpdPersonType = 'GROUP_LEADER' | 'MARKET_PM' | 'RD_PM' | 'SUPER_ADMIN';

export interface IpdPerson {
  accountStatus: string;
  groupId: null | string;
  id: string;
  name: string;
  personType: IpdPersonType;
  username: string;
}

export interface IpdIdentity {
  mustChangePwd: boolean;
  person: IpdPerson;
  scope: IpdScope;
}

export interface IpdLoginResult extends IpdIdentity {
  expiresIn: number;
  token: string;
  tokenType: 'Bearer';
}

export class IpdRequestError extends Error {
  constructor(message: string, readonly status = 0, readonly code = 0, readonly kind: 'http' | 'protocol' | 'timeout' | 'transport' | 'cancelled' = 'protocol', readonly envelopeMessage?: string, readonly traceId?: string) {
    super(message);
    this.name = 'IpdRequestError';
  }
}

/** AbortController 超时中止的拒绝形态识别（浏览器为 DOMException/AbortError，Node 形态不一，按 name 判）。
 *  2026-09-08：15s 超时中止与真断网分开归类，慢响应不再误报「无法连接服务」。 */
export function isAbortRejection(error: unknown): boolean {
  return (error as { name?: unknown } | null | undefined)?.name === 'AbortError';
}

/** 后端登录坏凭据的固定枚举文案（IpdAuthService.login 唯一固定值；离职/禁用/限流同落 400+10001 但 message 不同）。
 *  调用方必须按 envelopeMessage 精确比对而非按 code 覆写，否则会把「账号已停用」「登录尝试过于频繁」误报成密码错误（评审 Important-1）。 */
export const IPD_LOGIN_CREDENTIAL_ERROR = '用户名或密码错误';
/** 登录页展示用的凭据错误文案。 */
export const IPD_LOGIN_CREDENTIAL_TEXT = '用户名或密码错误，请重新输入';

/**
 * ApiV1ErrorCode → 中文兜底文案映射（与 ruoyi-ipd ApiV1ErrorCode.java 一一对应）。
 * 优先级：业务 code → HTTP 状态 → envelope.message → 通用兜底。
 * 改密专用文案（'原密码错误' / '新密码不能与当前密码相同'）由调用方在 catch 中按 envelope.message 二次识别。
 */
const BUSINESS_CODE_MESSAGES: Readonly<Record<number, string>> = Object.freeze({
  10001: '输入信息不符合要求，请检查后重试',
  20001: '登录已失效，请重新登录',
  20002: '账号待移交冻结中，仅保留移交相关权限',
  20003: '请先完成首次登录改密',
  30001: '权限不足，请联系管理员',
  40001: '当前阶段门禁未通过，无法执行此操作',
  40002: '双签未完成，请先完成必要签署',
  40003: '该项目数量超限，请先完成备案',
  40004: '角色已固定，市场PM 与 研发PM 不可跨岗',
  40005: '禁止直接删除，请按数据分级完成删除审核',
  40006: '请先完成账号移交，才可禁用账号',
  40011: '请求过于频繁，请稍后再试',
  40012: '附件数量或大小超出限制',
  40013: 'AI 预算超出限制，请稍后再试',
  40401: '产品已下架，无法使用该产品',
  50001: '资源不存在或已被删除',
  50002: '当前状态不支持此操作',
  50003: 'KPI 周期格式应为 YYYY-MM',
  50004: 'KPI 趋势期数必须在 1~36 区间',
  50005: '贡献度比例超区间（市场 PM 必须在 40%-65%，研发 PM 必须在 35%-60%）',
  50006: '贡献度五维度权重之和必须等于 100%',
  50007: '贡献度评定入口仅在 G5 上市后 90 天复盘阶段开放',
  50008: '贡献度评定权限不足（仅双 PM 自评 + 各自产品组长）',
  50009: '负反馈触发情形不合法',
  50010: '月份格式错（应为 YYYY-MM）',
  50011: '项目无 MARKET_PM / RD_PM 成员，无法执行负反馈',
  50012: '同项目同触发情形已存在负反馈记录，不重复扣减',
  50013: '负反馈状态机不允许此操作',
  50014: '该月份已锁定，不允许写入账务记录',
  50015: '对账差异率 ≥ 1%，不允许锁定',
  50016: '该月份尚未运行对账，无法锁定',
  50017: '移交记录状态不允许撤销（仅完成后 24h 内可撤销）',
  90001: '系统内部错误，请稍后重试',
});

function messageFromCode(code: number): string | null {
  return BUSINESS_CODE_MESSAGES[code] ?? null;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseIdentity(data: unknown): IpdIdentity {
  if (!record(data) || !record(data.person)) {
    throw new IpdRequestError('身份信息格式异常，请重新登录');
  }
  const p = data.person;
  // groupId 严格校验是契约漂移报警器：后端全局 Jackson NON_NULL 吞 null 键时（键缺失）在此报错。
  // 后端 IpdAuthController.PersonView.groupId 已加 @JsonInclude(ALWAYS) 显式输出 null，勿在前端放宽。
  if (
    typeof p.id !== 'string' || !/^\d+$/.test(p.id) ||
    typeof p.name !== 'string' || typeof p.username !== 'string' ||
    typeof p.accountStatus !== 'string' ||
    !(p.groupId === null || typeof p.groupId === 'string') ||
    !['MARKET_PM', 'RD_PM', 'GROUP_LEADER', 'SUPER_ADMIN'].includes(String(p.personType)) ||
    !['FULL', 'HANDOVER_ONLY', 'PASSWORD_CHANGE_REQUIRED'].includes(String(data.scope)) ||
    typeof data.mustChangePwd !== 'boolean'
  ) throw new IpdRequestError('身份信息格式异常，请重新登录');
  return {
    mustChangePwd: data.mustChangePwd,
    person: {
      accountStatus: p.accountStatus,
      groupId: p.groupId,
      id: p.id,
      name: p.name,
      personType: p.personType as IpdPersonType,
      username: p.username,
    },
    scope: data.scope as IpdScope,
  };
}

export type IpdAuthenticatedPath =
  | '/auth/change-password'
  | '/auth/logout'
  | '/auth/me'
  | '/auth/platform-token';
export type IpdRequestOptions = { body?: object; method?: 'GET' | 'POST' | 'PUT' };

/** IPD has its own code=0 envelope and keeps IDs/decimal strings unchanged. */
export async function requestIpd(
  path: string,
  options: IpdRequestOptions & { token?: string } = {},
): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15_000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(`/api/v1${path}`, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'omit',
      headers,
      method: options.method ?? 'GET',
      signal: abort.signal,
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new IpdRequestError('服务暂时不可用，请稍后重试', response.status);
    }
    const envelope: unknown = await response.json();
    if (!record(envelope) || typeof envelope.code !== 'number' ||
        typeof envelope.message !== 'string' || !('data' in envelope)) {
      throw new IpdRequestError('服务响应格式异常，请稍后重试', response.status);
    }
    if (!response.ok || envelope.code !== 0) {
      // 顺序：登录页 401 特化 → 业务 code → HTTP 状态 → 通用兜底
      // （2026-09-06 第六批修：特化必须先于 code 表短路，且限定 code=10001——401+20002 冻结等非凭据语义不得误报「密码错误」，治理 Warning-3；
      //   该分支为纯防御：后端登录匿名放行且 10001 实际走 HTTP 400，401+10001 仅在网关异常改写时出现，用例固定见 auth-refresh.test.ts）
      const loginCredential = response.status === 401 && path === '/auth/login' && envelope.code === 10001
        ? IPD_LOGIN_CREDENTIAL_TEXT
        : null;
      const fromCode = messageFromCode(envelope.code);
      // 2026-09-09 契约轮 R23：HTTP 状态特化补 409/429，403 文案与 30001 同源。
      // 修复：409（业务冲突）/429（限流）曾落到「服务暂时不可用」通用兜底，把冲突/限流误报成服务故障；
      // 403 特化仅在 code 表未命中时触达（已知码先走 fromCode），文案原「权限不足，请联系管理员」
      // 对 20002/20003/50011 等被 code 表遮蔽的场景语义不贴切，统一为 30001 同源文案。
      const message =
        loginCredential
          ?? fromCode
          ?? (response.status === 401 ? '登录已失效，请重新登录'
            : response.status === 403 ? '您没有执行此操作的权限'
              : response.status === 409 ? '数据状态已变更（可能已被其他人处理），请刷新后重试'
                : response.status === 429 ? '请求过于频繁，请稍后再试'
                  : '服务暂时不可用，请稍后重试');
      throw new IpdRequestError(message, response.status, envelope.code, 'http', envelope.message,
        typeof envelope.traceId === 'string' ? envelope.traceId : undefined);
    }
    return envelope.data;
  } catch (error) {
    if (error instanceof IpdRequestError) throw error;
    // 15s 定时器 abort 的拒绝单独归类为 timeout：后端可能已在处理，与真断网分开报，
    // 避免把慢响应误报成网络故障（验证场景见 auth.test.ts requestIpd transport/timeout 分派）。
    if (isAbortRejection(error)) {
      throw new IpdRequestError('请求超时，请稍后重试', 0, 0, 'timeout');
    }
    throw new IpdRequestError('无法连接服务，请检查网络后重试', 0, 0, 'transport');
  } finally {
    clearTimeout(timer);
  }
}

function parseSession(data: unknown): IpdLoginResult {
  const identity = parseIdentity(data);
  const positiveSeconds = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  if (!record(data) || typeof data.token !== 'string' || !data.token ||
      data.tokenType !== 'Bearer' || !positiveSeconds(data.expiresIn)) {
    throw new IpdRequestError('登录响应格式异常，请重试');
  }
  return { ...identity, token: data.token, tokenType: 'Bearer', expiresIn: data.expiresIn };
}

export async function loginIpd(username: string, password: string): Promise<IpdLoginResult> {
  return parseSession(await requestIpd('/auth/login', { method: 'POST', body: { username, password } }));
}

/** 后端 P0-7.3 单 token 轮换：携带当前有效 token 调 /auth/refresh，返回新 token 并立即撤销旧 token。 */
export async function refreshIpd(token: string): Promise<IpdLoginResult> {
  return parseSession(await requestIpd('/auth/refresh', { method: 'POST', token }));
}

/** 平台会话票（AI 平台桥，2026-09-06）：凭有效 IPD 票换基线平台票，/chat、/system 等原平台接口凭此票访问。 */
export interface IpdPlatformToken {
  expiresIn: number;
  platformUser: string;
  token: string;
  tokenType: 'Bearer';
}

/** 与 parseSession 同级严格度：形状漂移的响应不得当作有效票入库。 */
export async function fetchPlatformToken(token: string): Promise<IpdPlatformToken> {
  const data = await requestIpd('/auth/platform-token', { method: 'POST', token });
  if (
    !record(data) ||
    typeof data.token !== 'string' || !data.token ||
    data.tokenType !== 'Bearer' ||
    typeof data.platformUser !== 'string' || !data.platformUser ||
    !(typeof data.expiresIn === 'number' && Number.isSafeInteger(data.expiresIn) && data.expiresIn > 0)
  ) {
    throw new IpdRequestError('平台会话签发响应异常，请重试');
  }
  return {
    expiresIn: data.expiresIn,
    platformUser: data.platformUser,
    token: data.token,
    tokenType: 'Bearer',
  };
}
