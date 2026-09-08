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
  constructor(message: string, readonly status = 0, readonly code = 0, readonly kind: 'http' | 'protocol' | 'transport' | 'cancelled' = 'protocol', readonly envelopeMessage?: string) {
    super(message);
    this.name = 'IpdRequestError';
  }
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
  40010: '查询码无效，请检查后重新输入',
  40011: '请求过于频繁，请稍后再试',
  40012: '附件数量或大小超出限制',
  40013: 'AI 预算超出限制，请稍后再试',
  40401: '产品已下架，无法使用该产品',
  50001: '资源不存在或已被删除',
  50002: '当前状态不支持此操作',
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
      const message =
        loginCredential
          ?? fromCode
          ?? (response.status === 401 ? '登录已失效，请重新登录'
            : response.status === 403 ? '权限不足，请联系管理员'
              : '服务暂时不可用，请稍后重试');
      throw new IpdRequestError(message, response.status, envelope.code, 'http', envelope.message);
    }
    return envelope.data;
  } catch (error) {
    if (error instanceof IpdRequestError) throw error;
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
