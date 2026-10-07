import { pickIpdCodeTexts } from './code-texts';

export type IpdScope = 'FULL' | 'HANDOVER_ONLY' | 'PASSWORD_CHANGE_REQUIRED';
export type IpdPersonType = 'GROUP_LEADER' | 'MARKET_PM' | 'RD_PM' | 'SUPER_ADMIN';

export interface IpdPerson {
  accountStatus: string;
  groupId: null | string;
  id: string;
  name: string;
  /** 后端 /auth/me|/login 下发的 IPD 权限码（ipd:*）；缺省时前端走 scope/personType 降级。 */
  permissionCodes?: string[];
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
 * R234（2026-09-27 owner 拍板 B：以 UX 层文案为准）：本表不再手写文案，键集 + 文案均派生自
 * api/ipd/code-texts.ts IPD_CODE_TEXTS（R234 单一码表）；views/ipd/_shared/ipd-error-text.ts 的
 * IPD_COMMON_CODE_TEXTS 派生自同一张表，两条链路同码同文案。键集=协议侧 33 码不变
 * （20003/40012/40013/40401 登录改密/附件/AI 预算/产品下架语义保留在 auth 侧；50019 仅在 shared 侧）。
 * 10 个历史冲突码（20002/30001/40001/40002/40003/40004/40005/50001/50002/90001）文案随 B 拍板
 * 统一为 UX 层版本，旧协议层文案废弃。
 * 优先级：业务 code → HTTP 状态 → envelope.message → 通用兜底。
 * 改密专用文案（'原密码错误' / '新密码不能与当前密码相同'）由调用方在 catch 中按 envelope.message 二次识别。
 */
const BUSINESS_CODE_MESSAGES: Readonly<Record<number, string>> = Object.freeze(pickIpdCodeTexts([
  10001, 20001, 20002, 20003, 30001,
  40001, 40002, 40003, 40004, 40005, 40006,
  40011, 40012, 40013, 40401,
  50001, 50002,
  50003, 50004, 50005, 50006, 50007,
  50008, 50009, 50010, 50011, 50012,
  50013, 50014, 50015, 50016, 50017,
  90001,
]));

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
  let permissionCodes: string[] | undefined;
  if (p.permissionCodes !== undefined) {
    if (
      !Array.isArray(p.permissionCodes) ||
      !p.permissionCodes.every((code) => typeof code === 'string')
    ) {
      throw new IpdRequestError('身份信息格式异常，请重新登录');
    }
    permissionCodes = p.permissionCodes as string[];
  }
  return {
    mustChangePwd: data.mustChangePwd,
    person: {
      accountStatus: p.accountStatus,
      groupId: p.groupId,
      id: p.id,
      name: p.name,
      ...(permissionCodes !== undefined ? { permissionCodes } : {}),
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
export type IpdRequestOptions = {
  body?: object;
  formData?: FormData;
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT';
  responseType?: 'blob';
  /** 本次请求等待上限（毫秒）。未传时 15 秒；慢调用（立项建议）由调用方传入 60 秒。 */
  timeoutMs?: number;
};

/** 普通接口 15 秒；调用方传入的正整数覆盖该默认值。 */
function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs === 'number' && Number.isSafeInteger(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }
  return 15_000;
}

/** IPD has its own code=0 envelope and keeps IDs/decimal strings unchanged. */
export async function requestIpd(
  path: string,
  options: IpdRequestOptions & { token?: string } = {},
): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), resolveTimeoutMs(options.timeoutMs));
  try {
    const headers: Record<string, string> = { Accept: options.responseType === 'blob' ? 'application/octet-stream, application/json' : 'application/json' };
    if (options.body && !options.formData) headers['Content-Type'] = 'application/json';
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(`/api/v1${path}`, {
      body: options.formData ?? (options.body ? JSON.stringify(options.body) : undefined),
      credentials: 'omit',
      headers,
      method: options.method ?? 'GET',
      signal: abort.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (options.responseType === 'blob' && response.ok && contentType.includes('application/octet-stream')) {
      return await response.blob();
    }
    if (!contentType.includes('application/json')) {
      throw new IpdRequestError('服务暂时不可用，请稍后重试', response.status);
    }
    const envelope: unknown = await response.json();
    if (!record(envelope) || typeof envelope.code !== 'number' ||
        typeof envelope.message !== 'string' || !('data' in envelope)) {
      throw new IpdRequestError('服务响应格式异常，请稍后重试', response.status);
    }
    if (!response.ok || envelope.code !== 0) {
      // 顺序：登录凭据特化 → code=10001 后端真实消息(根因B) → 业务 code → HTTP 状态 → 通用兜底
      // （2026-09-06 第六批修：特化必须先于 code 表短路，且限定 code=10001——401+20002 冻结等非凭据语义不得误报「密码错误」，治理 Warning-3；
      //   R179-P0（2026-09-22）修：后端坏凭据真实形态是 400+10001+envelope.message=固定枚举，
      //   原 401 条件与真实形态不匹配致防御分支从未生效（live 探针实测：直调 loginIpd 拿到
      //   「输入信息不符合要求」而非凭据文案）；现与 store 层 credentialReject 同语义：
      //   400+精确枚举比对为主路径（离职/禁用/限流同落 400+10001 但 message 不同，不会误报），
      //   401+10001 保留为网关异常改写防御，用例固定见 auth-refresh.test.ts）
      const loginCredential = path === '/auth/login' && envelope.code === 10001 && (
        (response.status === 400 && envelope.message === IPD_LOGIN_CREDENTIAL_ERROR)
        || response.status === 401
      )
        ? IPD_LOGIN_CREDENTIAL_TEXT
        : null;
      const fromCode = messageFromCode(envelope.code);
      // R179-P0 根因B修复(2026-09-22 ORIGIN-本会话): code=10001 涵盖多语义(凭证/限流/离职/禁用),
      // 后端 envelope.message 含真实语义(来自固定枚举, 见本文件 L38 注释), 但 messageFromCode(10001)
      // '输入信息不符合要求' 是 catch-all 会覆盖真实消息(如限流'登录尝试过于频繁')。
      // loginCredential 处理凭证(兄弟会话精确特化在 worktree r179-p0-frontend); 对其它 10001
      // 子类(限流/离职/禁用), 尊重 envelope.message, 让真实错误透传给用户。
      const loginSpecific10001Message = loginCredential == null
        && path === '/auth/login'
        && envelope.code === 10001
        && typeof envelope.message === 'string'
        && envelope.message.length > 0
        && envelope.message !== fromCode
        ? envelope.message
        : null;
      // 2026-09-09 契约轮 R23：HTTP 状态特化补 409/429，403 文案与 30001 同源。
      // 修复：409（业务冲突）/429（限流）曾落到「服务暂时不可用」通用兜底，把冲突/限流误报成服务故障；
      // 403 特化仅在 code 表未命中时触达（已知码先走 fromCode），文案原 30001 旧协议层文案「权限不足，请联系管理员」
      // 对 20002/20003/50011 等被 code 表遮蔽的场景语义不贴切，统一为 30001 同源文案
      // （R234 后查表链 30001 文案即「您没有执行此操作的权限」，与状态特化同值不再分叉）。
      // R217-E2E-B2（方案A「一处修全局」，2026-09-25）：非 2xx 时后端 envelope.message 原文
      // 优先作为 Error message——rejectText 直读 err.message 的 ~28 个盲区页面（如 kpi/shared）
      // 此前 HTTP 403 只会看到查表文案（当时 30001 旧值「权限不足，请联系管理员」；R234 统一后为
      // 「您没有执行此操作的权限」）而看不到后端原文「无权访问该项目」。
      // fromCode/状态特化降级为「后端无原文」时的兜底；2xx+code≠0 维持查表优先
      // （auth.test.ts Bucket A BUSINESS_CODE_MESSAGES coverage 契约不动；R234 起本表文案
      //   派生自 api/ipd/code-texts.ts 单一码表，冲突码断言以统一后 UX 层文案为准）。
      // envelopeMessage 仍按第 5 参原样携带 → ipdErrorText http 分支读同一字段，两条链路同值不冲突。
      // 旧契约「不透传服务端任意调试串」（portal.test.ts / views auth.test.ts 用例）被本卡裁决覆盖，
      // 残余风险（异常网关改写 body 时原文照显示）登记在 R217 证据文件。
      const backendMessage = !response.ok && envelope.message.trim() ? envelope.message : null;
      const message =
        loginCredential
          ?? loginSpecific10001Message
          ?? backendMessage
          ?? fromCode
          ?? (response.status === 401 ? '登录已失效，请重新登录'
            : response.status === 403 ? '您没有执行此操作的权限'
              : response.status === 409 ? '数据状态已变更（可能已被其他人处理），请刷新后重试'
                : response.status === 429 ? '请求过于频繁，请稍后再试'
                  : '服务暂时不可用，请稍后重试');
      throw new IpdRequestError(message, response.status, envelope.code, 'http', envelope.message,
        typeof envelope.traceId === 'string' ? envelope.traceId : undefined);
    }
    // 下载口必须返回实际附件；即使 code=0 的 JSON 也不是下载成功。
    if (options.responseType === 'blob') {
      throw new IpdRequestError('附件响应格式异常，请重试', response.status);
    }
    return envelope.data;
  } catch (error) {
    if (error instanceof IpdRequestError) throw error;
    // 到时中止的拒绝单独归类为 timeout：后端可能已在处理，与真断网分开报，
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

/** 平台会话票（AI 平台桥，2026-09-06）：凭有效 IPD 票换基线平台票，/chat、/system 等原平台接口凭此票访问。
 *  clientId = sys_client.client_id（UUID）——基线 /system/** 鉴权要求请求头 clientid 与 token extra 一致
 *  （SecurityConfig 校验），后端换票响应交付此权威值；前端必须消费它而非依赖静态配置
 *  （clientid-contract / login-single-track 2026-09-28）。 */
export interface IpdPlatformToken {
  clientId: string;
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
    // clientid-contract：缺 clientId 的响应=契约断裂，必须立即抛错而非静默降级到静态配置
    typeof data.clientId !== 'string' || !data.clientId ||
    !(typeof data.expiresIn === 'number' && Number.isSafeInteger(data.expiresIn) && data.expiresIn > 0)
  ) {
    throw new IpdRequestError('平台会话签发响应异常，请重试');
  }
  return {
    clientId: data.clientId,
    expiresIn: data.expiresIn,
    platformUser: data.platformUser,
    token: data.token,
    tokenType: 'Bearer',
  };
}

/** 换票后补取映射平台账号的 RBAC 权限码（2026-10-07 非超管平台按钮断链修复）。
 *
 *  知识库等平台页面的按钮闸用 system:* 码（如 system:info:add），而 IPD /auth/me 只下发
 *  ipd:* 码——非超管角色换票后 accessCodes 缺平台码，写操作按钮全被 v-access 判否隐藏
 *  （浏览器实证：ipd-leader 资料库页仅剩搜索按钮，而后端 sys_role_menu 实际已授权）。
 *  数据源=平台标准端点 GET /system/user/getInfo（permissions=映射账号的菜单授权码）。
 *
 *  通道：原生 fetch 直取 /api 前缀（dev 由 vite、prod 由 nginx 吞前缀，同 request.ts 平台通道约定）。
 *  不走 requestClient：其 401 拦截会触发 doReAuthenticate 换票重入（core/user.ts 记载过
 *  2026-09-10 无限循环教训）；不走 requestIpd：平台端点非 IPD 契约包络。
 *  best-effort：网络/非 2xx/形状异常一律返回空数组，调用方退回纯 IPD 码，绝不阻断会话。 */
export async function fetchPlatformAccessCodes(token: string, clientId: string): Promise<string[]> {
  try {
    const response = await fetch('/api/system/user/getInfo', {
      headers: { Authorization: `Bearer ${token}`, ClientID: clientId },
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const permissions = record(body) && record(body.data) ? body.data.permissions : undefined;
    if (!Array.isArray(permissions)) return [];
    return permissions.filter((code): code is string => typeof code === 'string' && code.length > 0);
  } catch {
    // 平台码补装失败不回传原因：调用方按「无平台码」降级，会话与票不受影响。
    return [];
  }
}

/** 平台票本地缓存 key（sessionStorage）：过期判定独立于 IPD 票（平台票过期≠IPD 会话过期），但登出时随 IPD 会话一并清除。 */
export const PLATFORM_STORAGE_KEY = 'ruoyi-ipd.platform';

/** 平台票缓存结构：token + 过期时刻 + 换票交付的权威 clientId（三字段缺一即作废，不留旧格式活口）；
 *  accessCodes（2026-10-07 非超管按钮断链修复）＝换票时补取的映射账号 RBAC 码，随票缓存供
 *  refreshIdentity / 缓存命中路径零请求复用；旧缓存（无此字段）按空处理，不破坏恢复。 */
export interface StoredPlatformToken { accessCodes?: string[]; clientId: string; expiresAt: number; token: string }

export function restorePlatformToken(): StoredPlatformToken | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(PLATFORM_STORAGE_KEY) ?? 'null');
    if (data && typeof data.token === 'string' && data.token &&
        typeof data.clientId === 'string' && data.clientId &&
        Number.isFinite(data.expiresAt) && data.expiresAt > 0) return data;
  } catch { /* Malformed local data never becomes a platform session. */ }
  sessionStorage.removeItem(PLATFORM_STORAGE_KEY);
  return null;
}

export function storePlatformToken(stored: StoredPlatformToken): void {
  sessionStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(stored));
}

export function clearPlatformToken(): void {
  sessionStorage.removeItem(PLATFORM_STORAGE_KEY);
}

/** 权威 clientid（换票响应交付的 sys_client.client_id，与 token extra 同源）；无缓存时回 null 由调用方回退。 */
export function currentPlatformClientId(): string | null {
  return restorePlatformToken()?.clientId ?? null;
}
