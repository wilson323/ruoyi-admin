<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Alert, Button } from 'ant-design-vue';

import { IPD_LOGIN } from '../../../router/ipd-guard';
import { useIpdAuthStore } from '../../../store/ipd-auth';

const auth = useIpdAuthStore();
const router = useRouter();
const roles = { MARKET_PM: '市场产品经理', RD_PM: '研发产品经理', GROUP_LEADER: '产品组长', SUPER_ADMIN: '超级管理员' };
async function logout() {
  try {
    await auth.logout();
    await router.replace(IPD_LOGIN);
  } catch {
    if (auth.requiresReauthentication) await router.replace(IPD_LOGIN);
    // Other logout failures keep this page and the visible retry action.
  }
}
</script>

<template>
  <section class="mx-auto w-full max-w-[440px]" aria-labelledby="ipd-account-title">
    <h1 id="ipd-account-title" class="mb-3 text-3xl font-semibold">{{ auth.identity?.person.name }}，欢迎回来</h1>
    <Alert v-if="auth.error" class="mb-4" type="error" show-icon :message="auth.error" role="alert" />
    <Alert v-if="auth.identity?.scope === 'HANDOVER_ONLY'" class="mb-5" type="warning" show-icon message="账号已冻结，仅可办理移交。请联系产品组长处理。" />
    <Alert v-else class="mb-5" type="success" show-icon message="您的账户已通过身份验证。" />
    <dl class="bg-muted space-y-3 rounded-lg p-5">
      <div><dt class="text-muted-foreground text-sm">账号</dt><dd>{{ auth.identity?.person.username }}</dd></div>
      <div><dt class="text-muted-foreground text-sm">角色</dt><dd>{{ auth.identity ? roles[auth.identity.person.personType] : '' }}</dd></div>
    </dl>
    <p class="text-muted-foreground mt-5 text-sm">当前开放账户服务。项目工作台开放后将在此提供入口。</p>
    <Button block class="mt-6" :loading="auth.busy" @click="logout">退出登录</Button>
  </section>
</template>
