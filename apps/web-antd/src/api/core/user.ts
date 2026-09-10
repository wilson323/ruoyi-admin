import { requestClient } from '#/api/request';

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
  // vben requestClient 已自动拆 envelope（successCode=0 时取 dataField='data'），
  // 所以这里返回的就是 MeView = { person, scope, mustChangePwd }
  return requestClient.get<null | IpdMeResp>('/auth/me');
}
