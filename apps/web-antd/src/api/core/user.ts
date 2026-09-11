import { requestIpd } from '#/api/ipd/auth';

/**
 * IPD 集成 2026-09-10：替换上游 /system/user/getInfo
 * 后端真实端点：GET /auth/me
 * 返回：{ code:0, data:{ person: { id, name, username, personType, groupId, accountStatus }, scope, mustChangePwd } }
 *
 * 上游 fetchUserInfo 期望 { permissions, roles, user: { nickName, userName, userId, avatar, email } }，
 * 这里在 store/auth.ts.fetchUserInfo 里手工转换。
 */
export interface IpdPerson {
  accountStatus: string | null;
  groupId: string | null;
  id: string;
  name: string;
  personType: string;
  username: string;
}

export interface IpdMeResp {
  mustChangePwd: boolean;
  person: IpdPerson;
  scope: string;
}

export async function getUserInfoApi() {
  // IPD 端点只认 IPD Person token：此前误用平台 requestClient（带平台票）→ /auth/me 恒 401
  // → @vben doReAuthenticate 换新平台票重试 → 无限循环（2026-09-10 实测 2500+ 次/分钟，回归修复）。
  // 动态 import 规避 api ↔ store 循环依赖（同 request.ts doReAuthenticate 手法）。
  const { useIpdAuthStore } = await import('#/store/ipd-auth');
  const token = useIpdAuthStore().token;
  if (!token) throw new Error('IPD 会话未就绪，请重新登录');
  // requestIpd 返回完整 code0 envelope（IPD 自有包络，不走 vben 拆包），这里取 data 即 MeView
  const envelope = (await requestIpd('/auth/me', { token })) as {
    code: number;
    data: null | IpdMeResp;
  };
  return envelope.data;
}
