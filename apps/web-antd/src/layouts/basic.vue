<script lang="ts" setup>
import { computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';

import { AuthenticationLoginExpiredModal } from '@vben/common-ui';

import { useWatermark } from '@vben/hooks';
import { UserOutlined } from '@vben/icons';
import {
  BasicLayout,
  LockScreen,
  Notification,
  UserDropdown,
} from '@vben/layouts';
import { preferences } from '@vben/preferences';
import { useAccessStore, useUserStore } from '@vben/stores';

import { message } from 'ant-design-vue';

import { $t } from '#/locales';
import { resetRoutes } from '#/router';
import { useAuthStore, useNotifyStore } from '#/store';
import { useTenantStore } from '#/store/tenant';
import LoginForm from '#/views/_core/authentication/login.vue';

const userStore = useUserStore();
const authStore = useAuthStore();
const accessStore = useAccessStore();
const router = useRouter();
const { destroyWatermark, updateWatermark } = useWatermark();

const tenantStore = useTenantStore();
const menus = computed(() => {
  const defaultMenus = [
    {
      handler: () => {
        router.push('/profile');
      },
      icon: UserOutlined,
      text: $t('ui.widgets.profile'),
    },
  ];
  /**
   * 租户选中状态 不显示个人中心
   */
  if (tenantStore.checked) {
    defaultMenus.splice(1, 1);
  }
  return defaultMenus;
});

const avatar = computed(() => {
  return userStore.userInfo?.avatar || preferences.app.defaultAvatar;
});

async function handleLogout() {
  /**
   * 主动登出不需要带跳转地址
   */
  await authStore.logout(false);
  resetRoutes();
}

const notifyStore = useNotifyStore();
onMounted(() => notifyStore.startListeningMessage());

function handleViewAll() {
  message.warning('暂未开放');
}
watch(
  () => ({
    enable: preferences.app.watermark,
    content: preferences.app.watermarkContent,
  }),
  async ({ enable, content }) => {
    if (enable) {
      await updateWatermark({
        content:
          content ||
          `${userStore.userInfo?.username} - ${userStore.userInfo?.realName}`,
      });
    } else {
      destroyWatermark();
    }
  },
  {
    immediate: true,
  },
);
</script>

<template>
  <BasicLayout @clear-preferences-and-logout="handleLogout">
    <!-- 单企业部署非 SaaS（2026-09-06 owner 指令）：不渲染 TenantToggle 租户切换 -->
    <template #user-dropdown>
      <UserDropdown
        :avatar
        :menus
        :text="userStore.userInfo?.realName"
        :description="userStore.userInfo?.email || '未设置邮箱'"
        :tag-text="userStore.userInfo?.username"
        @logout="handleLogout"
      />
    </template>
    <template #notification>
      <Notification
        :dot="notifyStore.showDot"
        :notifications="notifyStore.notifications"
        @clear="notifyStore.clearAllMessage"
        @make-all="notifyStore.setAllRead"
        @read="notifyStore.setRead"
        @view-all="handleViewAll"
      />
    </template>
    <template #extra>
      <!-- BasicLayout 无 default slot（packages/effects/layouts/src/basic/layout.vue 只透传
           logo-text/user-dropdown/notification/extra/lock-screen 等具名插槽），裸按钮放在
           默认插槽会被整体丢弃——回切按钮必须挂在 #extra 内（2026-09-06 浏览器实测修复） -->
      <button
        class="ipd-workbench-switch"
        data-testid="platform-ipd-switch"
        type="button"
        @click="router.replace('/ipd/workbench')"
      >
        <strong>IPD 工作台</strong>
        <small>返回产品流程管理</small>
      </button>
      <AuthenticationLoginExpiredModal
        v-model:open="accessStore.loginExpired"
        :avatar
      >
        <LoginForm />
      </AuthenticationLoginExpiredModal>
    </template>
    <template #lock-screen>
      <LockScreen :avatar @to-login="handleLogout" />
    </template>
  </BasicLayout>
</template>

<style scoped>
.ipd-workbench-switch {
  position: fixed;
  bottom: 22px;
  left: 22px;
  z-index: 500;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  padding: 10px 16px;
  border: 0;
  border-radius: 12px;
  color: #fff;
  background: linear-gradient(135deg, #071426, #18253a);
  box-shadow: 0 8px 22px rgb(7 20 38 / 30%);
  cursor: pointer;
}
.ipd-workbench-switch strong { font-size: 13px; }
.ipd-workbench-switch small { font-size: 10px; opacity: 0.75; }
.ipd-workbench-switch:hover { opacity: 0.92; }
</style>
