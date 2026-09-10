import { requestClient } from '#/api/request';

/**
 * 发送短信验证码
 * @param phonenumber 手机号
 * @returns void
 */
export function sendSmsCode(phonenumber: string) {
  return requestClient.get<void>('/resource/sms/code', {
    params: { phonenumber },
  });
}

/**
 * 发送邮件验证码
 * @param email 邮箱
 * @returns void
 */
export function sendEmailCode(email: string) {
  return requestClient.get<void>('/resource/email/code', {
    params: { email },
  });
}

/**
 * @param img 图片验证码 需要和base64拼接
 * @param captchaEnabled 是否开启
 * @param uuid 验证码ID
 */
export interface CaptchaResponse {
  captchaEnabled: boolean;
  img: string;
  uuid: string;
}

/**
 * 图片验证码
 * IPD 集成 2026-09-10：IPD 后端无 /auth/code 端点，stub 为禁用
 * @returns resp
 */
export function captchaImage() {
  // IPD 集成：永远返回 captchaEnabled=false 跳过验证码
  return Promise.resolve({
    captchaEnabled: false,
    img: '',
    uuid: '',
  }) as Promise<CaptchaResponse>;
}
