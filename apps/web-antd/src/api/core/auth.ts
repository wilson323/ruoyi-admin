import type { GrantType } from '@vben/common-ui';
import type { HttpResponse } from '@vben/request';

import { useAppConfig } from '@vben/hooks';

import { requestClient } from '#/api/request';

const { clientId, sseEnable } = useAppConfig(
  import.meta.env,
  import.meta.env.PROD,
);

export namespace AuthApi {
  /**
   * @description: 所有登录类型都需要用到的
   * @param clientId 客户端ID 这里为必填项 但是在loginApi内部处理了 所以为可选
   * @param grantType 授权/登录类型
   * @param tenantId 租户id
   */
  export interface BaseLoginParams {
    clientId?: string;
    grantType: GrantType;
    tenantId: string;
  }

  /**
   * @description: oauth登录需要用到的参数
   * @param socialCode 第三方参数
   * @param socialState 第三方参数
   * @param source 与后端的 justauth.type.xxx的回调地址的source对应
   */
  export interface OAuthLoginParams extends BaseLoginParams {
    socialCode: string;
    socialState: string;
    source: string;
  }

  /**
   * @description: 验证码登录需要用到的参数
   * @param code 验证码 可选(未开启验证码情况)
   * @param uuid 验证码ID 可选(未开启验证码情况)
   * @param username 用户名
   * @param password 密码
   */
  export interface SimpleLoginParams extends BaseLoginParams {
    code?: string;
    uuid?: string;
    username: string;
    password: string;
  }

  export type LoginParams = OAuthLoginParams | SimpleLoginParams;

  // /** 登录接口参数 */
  // export interface LoginParams {
  //   code?: string;
  //   grantType: string;
  //   password: string;
  //   tenantId: string;
  //   username: string;
  //   uuid?: string;
  // }

  /** 登录接口返回值 */
  export interface LoginResult {
    access_token: string;
    client_id: string;
    expire_in: number;
  }

  export interface RefreshTokenResult {
    data: string;
    status: number;
  }
}

/**
 * 登录
 * IPD 集成 2026-09-10：不用上游 RSA 加密 + access_token 响应，直接调 IPD 后端 /auth/login。
 * IPD 后端返回 { code:0, message:'ok', data:{ token, expiresIn, scope, mustChangePwd, person } }，
 * 上游期望 { access_token, client_id, expire_in }，这里手动转换。
 */
export async function loginApi(data: AuthApi.LoginParams) {
  const resp = await requestClient.post<{
    code: number;
    data: {
      expiresIn: number;
      mustChangePwd: boolean;
      person: { id: string; name: string; personType: string; username: string };
      scope: string;
      token: string;
      tokenType: string;
    };
    message: string;
  }>(
    '/auth/login',
    { username: (data as { username?: string }).username ?? '', password: (data as { password?: string }).password ?? '' },
    { encrypt: false },
  );
  // vben requestClient 已自动拆 envelope：返回的 resp 就是后端 data（LoginView）
  // LoginView = { token, tokenType, expiresIn, scope, mustChangePwd, person }
  return {
    access_token: resp.token,
    client_id: data.clientId ?? 'vben-ipd',
    expire_in: resp.expiresIn,
  } as AuthApi.LoginResult;
}

/**
 * 用户登出
 * @returns void
 */
export function doLogout() {
  return requestClient.post<HttpResponse<void>>('/auth/logout');
}

/**
 * 关闭sse连接
 * @returns void
 */
export function seeConnectionClose() {
  /**
   * 未开启sse 不需要处理
   */
  if (!sseEnable) {
    return;
  }
  return requestClient.get<void>('/resource/sse/close');
}

/**
 * @param companyName 租户/公司名称
 * @param domain 绑定域名(不带http(s)://) 可选
 * @param tenantId 租户id
 */
export interface TenantOption {
  companyName: string;
  domain?: string;
  tenantId: string;
}

/**
 * @param tenantEnabled 是否启用租户
 * @param voList 租户列表
 */
export interface TenantResp {
  tenantEnabled: boolean;
  voList: TenantOption[];
}

/**
 * 获取租户列表 下拉框使用
 * IPD 集成 2026-09-10：IPD 后端无 /auth/tenant/list 端点，stub 为禁用
 */
export function tenantList() {
  return Promise.resolve({
    tenantEnabled: false,
    voList: [],
  }) as Promise<TenantResp>;
}

/**
 * vben的 先不删除
 * @returns string[]
 */
export async function getAccessCodesApi() {
  return requestClient.get<string[]>('/auth/codes');
}

/**
 * 绑定第三方账号
 * @param source 绑定的来源
 * @returns 跳转url
 */
export function authBinding(source: string, tenantId: string) {
  return requestClient.get<string>(`/auth/binding/${source}`, {
    params: {
      domain: window.location.host,
      tenantId,
    },
  });
}

/**
 * 取消绑定
 * @param id id
 */
export function authUnbinding(id: string) {
  return requestClient.deleteWithMsg<void>(`/auth/unlock/${id}`);
}

/**
 * oauth授权回调
 * @param data oauth授权
 * @returns void
 */
export function authCallback(data: AuthApi.OAuthLoginParams) {
  return requestClient.post<void>('/auth/social/callback', data);
}
