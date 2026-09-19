<script setup lang="ts">
import type { AuthApi } from '#/api';

import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { DEFAULT_TENANT_ID, LOGIN_PATH } from '@vben/constants';
import { useAccessStore } from '@vben/stores';
import { cn } from '@vben/utils';

import { message, Spin } from 'ant-design-vue';

import { authCallback } from '#/api';
import { useAuthStore } from '#/store';

import { accountBindList } from '../oauth-common';

const route = useRoute();

const code = route.query.code as string;
const state = route.query.state as string;
// 2026-09-18 修复：state 可能为空（用户直接访问 /social-callback 无参数），
// atob('') 会抛 InvalidCharacterError。把 parse 包进 try/catch，解析失败
// 则跳回登录页；只要本页面出现 0 条 console error。
let stateJson: Record<string, any> = {};
try {
  stateJson = state ? JSON.parse(atob(state)) : {};
} catch {
  stateJson = {};
}
// 来源
const source = route.query.source as string;
// 租户ID
const defaultTenantId = DEFAULT_TENANT_ID;
const tenantId = (stateJson.tenantId as string) ?? defaultTenantId;
const domain = stateJson.domain as string;

const accessStore = useAccessStore();
const authStore = useAuthStore();

const router = useRouter();

onMounted(async () => {
  // 2026-09-18 修复：state/code/source 任一缺失表示不是真正的第三方回调
  // （用户可能从书签直接访问 /social-callback），直接跳登录页，不产生 console error。
  if (!state || !code || !source) {
    message.error({ content: '无效的第三方登录回调' });
    router.replace(LOGIN_PATH);
    return;
  }
  // 如果域名不相等 则重定向处理
  const host = window.location.host;
  if (domain && domain !== host) {
    const urlFull = new URL(window.location.href);
    urlFull.host = domain;
    window.location.href = urlFull.toString();
    return;
  }

  try {
    // 已经实现的平台
    const currentClient = accountBindList.find(
      (item) => item.source === source,
    );
    if (!currentClient) {
      message.error({ content: `未找到${source}平台` });
      return;
    }
    const data: AuthApi.OAuthLoginParams = {
      grantType: 'social',
      socialCode: code,
      socialState: state,
      source,
      tenantId,
    };
    // 没有token为登录 有token是授权
    if (accessStore.accessToken) {
      await authCallback(data);
      message.success(`${source}授权成功`);
    } else {
      // 这里内部已经做了跳转到首页的操作
      await authStore.authLogin(data as any);
      message.success(`${source}登录成功`);
    }
  } catch (error) {
    console.error(error);
    // 500 你还没有绑定第三方账号，绑定后才可以登录！
    setTimeout(() => {
      router.push(LOGIN_PATH);
    }, 1500);
  }
});
</script>

<template>
  <div :class="cn('flex items-center justify-center', 'h-screen w-screen')">
    <Spin size="large" />
  </div>
</template>
