import type { IpdIdentity, IpdLoginResult, IpdRequestOptions } from '../api/ipd/auth';

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import { useAccessStore, useUserStore } from '@vben/stores';

import {
  IpdRequestError,
  fetchPlatformToken,
  loginIpd,
  parseIdentity,
  refreshIpd,
  requestIpd,
} from '../api/ipd/auth';
import { getUserInfoApi } from '../api/core/user';
import { ipdErrorText } from '../views/ipd/_shared/ipd-error-text';

const STORAGE_KEY = 'ruoyi-ipd.session';
const LEGACY_STORAGE_KEY = 'ruoyi-ipd.session-token';
/** 平台票独立存放：生命周期与 IPD 票互不耦合（平台票过期≠IPD 会话过期，反之亦然）。 */
const PLATFORM_STORAGE_KEY = 'ruoyi-ipd.platform';
interface StoredSession {
  accessToken: string;
  accessExpiresAt: number;
  refreshState: 'ready' | 'uncertain';
}
function restoredSession(): StoredSession | null {
  sessionStorage.removeItem(LEGACY_STORAGE_KEY);
  try {
    const data = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (data && typeof data.accessToken === 'string' && data.accessToken &&
        Number.isFinite(data.accessExpiresAt) && data.accessExpiresAt > 0 &&
        ['ready', 'uncertain'].includes(data.refreshState)) return data;
  } catch { /* Malformed local data never becomes an authenticated identity. */ }
  sessionStorage.removeItem(STORAGE_KEY);
  return null;
}
const expiredSession = (cause: unknown): cause is IpdRequestError => cause instanceof IpdRequestError &&
  cause.kind === 'http' && cause.status === 401 && cause.code === 20001;
const supersededSession = () => new IpdRequestError('登录状态已改变，请重试', 0, 0, 'cancelled');
const uncertainRefresh = () => new IpdRequestError('无法确认会话刷新结果，请重新登录。', 0, 0, 'transport');

interface StoredPlatformToken { expiresAt: number; token: string }
function restorePlatformToken(): StoredPlatformToken | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(PLATFORM_STORAGE_KEY) ?? 'null');
    if (data && typeof data.token === 'string' && data.token &&
        Number.isFinite(data.expiresAt) && data.expiresAt > 0) return data;
  } catch { /* Malformed local data never becomes a platform session. */ }
  sessionStorage.removeItem(PLATFORM_STORAGE_KEY);
  return null;
}

export const useIpdAuthStore = defineStore('ipd-auth', () => {
  const restored = restoredSession();
  const token = ref(restored?.accessToken ?? '');
  const identity = ref<IpdIdentity | null>(null);
  const busy = ref(false);
  const error = ref('');
  const credentials = ref<StoredSession | null>(restored);
  let sessionVersion = 0;
  let refreshFlight: Promise<void> | undefined;
  let passwordChangedAt: number | undefined;
  const requiresReauthentication = computed(() => credentials.value?.refreshState === 'uncertain');
  const mustChangePassword = computed(() => identity.value?.mustChangePwd || identity.value?.scope === 'PASSWORD_CHANGE_REQUIRED');
  const accessStore = useAccessStore();

  /**
   * 平台会话续签/复用（AI 平台桥）：持有效 IPD 票向 /auth/platform-token 换基线平台票。
   * - 非 force 时命中未过期缓存则直接复用；force 供 request.ts 在平台票 401 时强制重签；
   * - 仅 FULL 人员可签发；失败抛错，由调用方降级（绝不阻断 IPD 会话本身）。
   */
  async function renewPlatformSession(force = false): Promise<string> {
    if (!token.value || !identity.value) {
      throw new IpdRequestError('登录已失效，请重新登录', 401, 20001, 'http');
    }
    if (identity.value.scope !== 'FULL') {
      throw new IpdRequestError('当前账号状态不可使用平台功能', 403, 30001, 'http');
    }
    const cached = restorePlatformToken();
    if (!force && cached && cached.expiresAt > Date.now() + 30_000) {
      if (accessStore.accessToken !== cached.token) accessStore.setAccessToken(cached.token);
      return cached.token;
    }
    const result = await fetchPlatformToken(token.value);
    sessionStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify({
      expiresAt: Date.now() + result.expiresIn * 1000,
      token: result.token,
    }));
    accessStore.setAccessToken(result.token);
    try {
      const info = await getUserInfoApi();
      if (info?.user) {
        useUserStore().setUserInfo({
          avatar: info.user.avatar,
          email: info.user.email,
          permissions: info.permissions ?? [],
          realName: info.user.nickName,
          roles: info.roles ?? [],
          userId: String(info.user.userId),
          username: info.user.userName,
        });
      }
    } catch { /* 用户信息加载失败不影响票有效性 */ }
    return result.token;
  }

  function clearSession() {
    sessionVersion++;
    refreshFlight = undefined;
    token.value = '';
    identity.value = null;
    credentials.value = null;
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    // 平台会话随 IPD 会话同生共死：登出/失效时一并清除（AI 平台桥，2026-09-06）
    sessionStorage.removeItem(PLATFORM_STORAGE_KEY);
    accessStore.setAccessToken(null);
  }

  function installSession(result: IpdLoginResult) {
    const now = Date.now();
    credentials.value = { accessToken: result.token,
      accessExpiresAt: now + result.expiresIn * 1000, refreshState: 'ready' };
    // One storage write prevents a reload from seeing tokens from different rotations.
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(credentials.value));
    token.value = result.token;
    identity.value = { person: result.person, scope: result.scope, mustChangePwd: result.mustChangePwd };
  }

  async function rotateSession(failedToken: string, version: number) {
    if (version !== sessionVersion) throw supersededSession();
    if (credentials.value?.refreshState === 'uncertain') throw uncertainRefresh();
    if (token.value && token.value !== failedToken) return;
    if (refreshFlight) return refreshFlight;
    // 后端单 token 轮换要求当前 token 仍有效；本地已知过期则直接终止会话，不打服务端。
    if (!credentials.value || credentials.value.accessExpiresAt <= Date.now()) {
      clearSession(); throw new IpdRequestError('登录已失效，请重新登录', 401, 20001, 'http');
    }
    const previous = credentials.value;
    // Persist before the request: unload can prevent catch/finally from running.
    // Keep in-memory state ready so current callers join the same flight.
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...previous, refreshState: 'uncertain' }));
    const flight = (async () => {
      try {
        const result = await refreshIpd(previous.accessToken);
        if (version !== sessionVersion) throw supersededSession();
        if (result.token === previous.accessToken) throw new IpdRequestError('刷新响应未轮换凭据');
        installSession(result);
      } catch (cause) {
        if (version !== sessionVersion) throw supersededSession();
        if (expiredSession(cause)) clearSession();
        else {
          // A timeout or invalid success response may follow a committed rotation.
          credentials.value = { ...previous, refreshState: 'uncertain' };
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(credentials.value));
          identity.value = null;
        }
        throw expiredSession(cause) ? cause : uncertainRefresh();
      }
    })();
    refreshFlight = flight;
    try { await flight; } finally { if (refreshFlight === flight) refreshFlight = undefined; }
  }

  async function authenticatedRequest(path: string, options: IpdRequestOptions = {}) {
    if (credentials.value?.refreshState === 'uncertain') throw uncertainRefresh();
    const usedToken = token.value;
    const version = sessionVersion;
    try {
      const result = await requestIpd(path, { ...options, token: usedToken });
      if (version !== sessionVersion) throw supersededSession();
      return result;
    } catch (cause) {
      if (version !== sessionVersion) throw supersededSession();
      // Only a definite pre-authentication rejection can replay a write once.
      // 400/403, server failures and transport uncertainty are never replayed.
      if (!expiredSession(cause)) throw cause;
      await rotateSession(usedToken, version);
      if (version !== sessionVersion) throw supersededSession();
      const retriedToken = token.value;
      try {
        const result = await requestIpd(path, { ...options, token: retriedToken });
        if (version !== sessionVersion) throw supersededSession();
        return result;
      } catch (retryCause) {
        if (version !== sessionVersion) throw supersededSession();
        if (expiredSession(retryCause) && token.value === retriedToken) clearSession();
        throw retryCause;
      }
    }
  }

  async function refreshIdentity() {
    if (!token.value) return null;
    const version = sessionVersion;
    try {
      identity.value = parseIdentity(await authenticatedRequest('/auth/me'));
      return identity.value;
    } catch (cause) {
      if (version !== sessionVersion || (cause instanceof IpdRequestError && cause.kind === 'cancelled')) throw cause;
      identity.value = null;
      if (expiredSession(cause) || (cause instanceof IpdRequestError && cause.kind === 'http' && cause.status === 403)) clearSession();
      throw cause;
    }
  }

  async function login(username: string, password: string) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    clearSession();
    const version = sessionVersion;
    try {
      const result = await loginIpd(username, password);
      if (version !== sessionVersion) throw supersededSession();
      installSession(result);
      await refreshIdentity();
      // 平台会话 best-effort：换票失败不阻断 IPD 登录，AI 平台入口按无票降级隐藏
      try { await renewPlatformSession(); } catch { /* 降级 */ }
    } catch (cause) {
      if (cause instanceof IpdRequestError && cause.kind === 'cancelled') throw cause;
      if (!requiresReauthentication.value) clearSession();
      // 2026-09-06 第六批：登录页文案统一走 _shared/ipd-error-text 权威源（治理 Warning-2）；
      // 登录语境 code=10001 恒为凭据错误，页面级覆写专用文案，不再被通用表吞成「输入信息不符合要求」（Warning-3 用户可见修复）
      error.value = cause instanceof IpdRequestError
        ? ipdErrorText(cause, { codeTexts: { 10001: '用户名或密码错误，请重新输入' }, fallback: '登录失败，请重试' })
        : '登录失败，请重试';
      throw cause;
    } finally { busy.value = false; }
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await authenticatedRequest('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      clearSession();
      passwordChangedAt = Date.now();
    } catch (cause) {
      if (expiredSession(cause)) clearSession();
      error.value = cause instanceof Error ? cause.message : '修改失败，请重试';
      throw cause;
    } finally { busy.value = false; }
  }

  function consumePasswordChangedNotice() {
    const occurredAt = passwordChangedAt;
    passwordChangedAt = undefined;
    return occurredAt !== undefined && Date.now() - occurredAt < 60_000;
  }

  async function logout() {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    // 平台会话先行 best-effort 退出（基线 /auth/logout 在 /api 前缀之外，且退出结果不影响主流程）
    const platformToken = restorePlatformToken()?.token;
    if (platformToken) {
      try {
        await fetch('/auth/logout', {
          headers: { Authorization: `Bearer ${platformToken}` },
          method: 'POST',
        });
      } catch { /* best-effort */ }
    }
    try {
      if (token.value) await authenticatedRequest('/auth/logout', { method: 'POST' });
      clearSession();
    } catch (cause) {
      if (expiredSession(cause)) clearSession();
      else {
        error.value = credentials.value?.refreshState === 'uncertain'
          ? '无法确认会话刷新或服务端退出，请重新登录。'
          : '未能确认服务端退出，请检查网络后再次点击退出登录';
        throw cause;
      }
    } finally { busy.value = false; }
  }

  return { token, identity, busy, error, mustChangePassword, requiresReauthentication, clearSession, refreshIdentity, authenticatedRequest,
    renewPlatformSession, login, changePassword, consumePasswordChangedNotice, logout };
});
