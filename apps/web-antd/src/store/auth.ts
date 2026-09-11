import type { LoginAndRegisterParams } from '@vben/common-ui';
import type { UserInfo } from '@vben/types';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';

import { notification } from 'ant-design-vue';
import { defineStore } from 'pinia';

import { doLogout, getUserInfoApi, loginApi, seeConnectionClose } from '#/api';
import {
  ImpossibleReturn401Exception,
  UnauthorizedException,
} from '#/api/helper';
import { $t } from '#/locales';

import { useIpdAuthStore } from './ipd-auth';
import { useDictStore } from './dict';

export const useAuthStore = defineStore('auth', () => {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  const router = useRouter();

  const loginLoading = ref(false);

  /**
   * 异步处理登录操作
   * Asynchronously handle the login process
   * @param params 登录表单数据
   */
  async function authLogin(
    params: LoginAndRegisterParams,
    onSuccess?: () => Promise<void> | void,
  ) {
    // 异步处理用户登录操作并获取 accessToken
    let userInfo: null | UserInfo = null;
    try {
      loginLoading.value = true;
      const loginResp = await loginApi(params);
      const access_token = loginResp.access_token;

      // 将 accessToken 存储到 accessStore 中
      accessStore.setAccessToken(access_token);
      accessStore.setRefreshToken(access_token);

      // 获取用户信息并存储到 accessStore 中
      userInfo = await fetchUserInfo();
      /**
       * 设置用户信息
       */
      userStore.setUserInfo(userInfo);
      /**
       * 在这里设置权限
       */
      accessStore.setAccessCodes(userInfo.permissions);

      // IPD 集成 2026-09-10：同步把 IPD 身份塞进 ipd-auth store，
      // 让 ipd-guard 不再走 anonymous 分支弹回登录页。
      try {
        const ipdAuth = useIpdAuthStore();
        const rawLogin = await import('#/api/ipd/auth').then((m) =>
          m.loginIpd(
            (params as { username?: string }).username ?? '',
            (params as { password?: string }).password ?? '',
          ),
        ).catch(() => null);
        if (rawLogin) {
          // 2026-09-10 收口：统一走 ipd-auth store 的 adoptSession（内部 installSession
          // 单点写 sessionStorage）。此前 $patch 私有 ref + 手写 sessionStorage 是双写源：
          // 既触发 TS2769（credentials 不在 setup-store 的 $patch 类型内），
          // 又可能造成两份持久化数据不同步。
          ipdAuth.adoptSession(rawLogin);
        }
      } catch (e) { console.warn('[ipd-auth sync]', e); }

      if (accessStore.loginExpired) {
        accessStore.setLoginExpired(false);
      } else {
        onSuccess
          ? await onSuccess?.()
          : await router.push(preferences.app.defaultHomePath);
      }

      if (userInfo?.realName) {
        notification.success({
          description: `${$t('authentication.loginSuccessDesc')}:${userInfo?.realName}`,
          duration: 3,
          message: $t('authentication.loginSuccess'),
        });
      }
    } finally {
      loginLoading.value = false;
    }

    return {
      userInfo,
    };
  }

  async function logout(redirect: boolean = true) {
    try {
      // 这两个接口不依赖 不需要await sseClose
      await Promise.all([seeConnectionClose(), doLogout()]);
    } catch (error) {
      console.error(error);
      /**
       * 这两个接口按正常逻辑不可能返回401
       * 在微服务版本配置错误的情况下 这里会抛出401
       * 在这里抛出自定义异常供上层处理
       */
      if (error instanceof UnauthorizedException) {
        throw new ImpossibleReturn401Exception(error.message);
      }
    } finally {
      resetAllStores();
      accessStore.setLoginExpired(false);

      // 回登陆页带上当前路由地址
      await router.replace({
        path: LOGIN_PATH,
        query: redirect
          ? {
              redirect: router.currentRoute.value.fullPath,
            }
          : {},
      });
    }
  }

  async function fetchUserInfo() {
    // IPD 集成 2026-09-10：调 /auth/me（不是上游 /system/user/getInfo）
    // 后端 envelope { code, data:{ person, scope, mustChangePwd } }，vben 已自动拆 data
    const resp = (await getUserInfoApi()) as unknown as null | {
      mustChangePwd: boolean;
      person: {
        accountStatus: string | null;
        groupId: string | null;
        id: string;
        name: string;
        personType: string;
        username: string;
      };
      scope: string;
    };
    if (!resp) {
      throw new Error('获取用户信息失败.');
    }
    const { person, scope } = resp;
    const userInfo: UserInfo = {
      avatar: '',
      email: '',
      permissions: [scope, `personType:${person.personType}`].filter(Boolean),
      realName: person.name,
      roles: [person.personType],
      userId: person.id as unknown as number,
      username: person.username,
    };
    userStore.setUserInfo(userInfo);
    const dictStore = useDictStore();
    dictStore.resetCache();
    return userInfo;
  }

  function $reset() {
    loginLoading.value = false;
  }

  return {
    $reset,
    authLogin,
    fetchUserInfo,
    loginLoading,
    logout,
  };
});
