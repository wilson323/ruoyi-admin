/**
 * 企微 Mock 扫码登录（R215 WP3.1 批次 = ORPHAN-A12，卡 be9a3017；原型页 01 登录页）。
 *
 * 真值：IpdAuthController POST /api/v1/auth/wecom/qr-login（R212 分桶表 #36；P0-7.4 交付）：
 * - 入参 { wecomUserId }（Mock 阶段契约：查 persons.wecom_user_id 绑定关系；真实企微
 *   接入将替换为 OAuth2 code + state，届时本封装整体下线）。
 * - 已绑定 → 复用 /login 的 scope 计算签发 FULL JWT（LoginView 同构）；
 *   未绑定 → 404 + NOT_FOUND「账号未绑定，请联系管理员」（不泄露在职状态）。
 * - @RateLimiter：同 IP 同 wecomUserId 60 秒 5 次，超限 400+10001「扫码登录尝试过于频繁」。
 *
 * 安全口径（R214/U0 最小可控化，卡 9d50c5fd done）：
 * - 后端开关 ipd.auth.qr-login.enabled（env IPD_AUTH_QR_LOGIN_ENABLED），默认 false——
 *   关闭时统一 409 + code 50019（QR_LOGIN_NOT_ENABLED），不查库、不签发 JWT。
 * - 前端入口开关独立：VITE_IPD_WECOM_QR_LOGIN（构建期静态，默认关，与后端默认对齐）。
 *   后端未暴露开关状态端点（IpdAuthController 无 status 类端点，2026-09-25 核实），
 *   故两端可能漂移：前端开 + 后端关 → 调用被 409/50019 拒，UI 透传后端拒绝文案。
 *   开关打开的正向联调验证待 owner 演示窗口（改后端配置超出本卡范围）。
 */
import type { IpdLoginResult } from './auth';

import { IpdRequestError, parseIdentity, requestIpd } from './auth';

/** 登录页扫码入口可见开关（默认关；置 true 需同时确认后端 ipd.auth.qr-login.enabled=true）。 */
export const WECOM_QR_LOGIN_ENABLED =
  String(import.meta.env.VITE_IPD_WECOM_QR_LOGIN ?? '')
    .trim()
    .toLowerCase() === 'true';

/** 后端开关拒绝码（ApiV1ErrorCode.QR_LOGIN_NOT_ENABLED=50019，HTTP 409）。 */
export const WECOM_QR_LOGIN_NOT_ENABLED_CODE = 50019;

/** 开关关闭时的专用文案（覆盖 409 通用「状态已变更」误导读法）。 */
export const WECOM_QR_LOGIN_NOT_ENABLED_TEXT =
  '企业微信扫码登录未启用（需管理员开启 ipd.auth.qr-login.enabled）';

/** 与 auth.ts parseSession 同级严格校验：形状漂移的扫码响应不得当作有效会话入库。 */
function parseWecomSession(data: unknown): IpdLoginResult {
  const identity = parseIdentity(data);
  if (typeof data !== 'object' || data === null) {
    throw new IpdRequestError('扫码登录响应格式异常，请重试');
  }
  const d = data as Record<string, unknown>;
  // 类型谓词（与 auth.ts parseSession 的 positiveSeconds 同款）：守卫后 expiresIn 收窄为 number
  const positiveSeconds = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  if (typeof d.token !== 'string' || !d.token || d.tokenType !== 'Bearer' || !positiveSeconds(d.expiresIn)) {
    throw new IpdRequestError('扫码登录响应格式异常，请重试');
  }
  return { ...identity, token: d.token, tokenType: 'Bearer', expiresIn: d.expiresIn };
}

/** 企微 Mock 扫码登录（匿名端点，无 token；返回与 /auth/login 同构的 IpdLoginResult）。 */
export async function wecomQrLogin(wecomUserId: string): Promise<IpdLoginResult> {
  let data: unknown;
  try {
    data = await requestIpd('/auth/wecom/qr-login', {
      body: { wecomUserId },
      method: 'POST',
    });
  } catch (cause) {
    // 50019 特判：把 409 通用文案换为「未启用」专用文案（code/envelopeMessage 原样保留供断言）
    if (
      cause instanceof IpdRequestError &&
      cause.code === WECOM_QR_LOGIN_NOT_ENABLED_CODE
    ) {
      throw new IpdRequestError(
        WECOM_QR_LOGIN_NOT_ENABLED_TEXT,
        cause.status,
        cause.code,
        cause.kind,
        cause.envelopeMessage,
        cause.traceId,
      );
    }
    throw cause;
  }
  return parseWecomSession(data);
}
