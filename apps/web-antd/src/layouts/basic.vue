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

import { resetRoutes } from '#/router';
import { useNotifyStore } from '#/store';
import { useIpdAuthStore } from '#/store/ipd-auth';
import { useTenantStore } from '#/store/tenant';
import LoginForm from '#/views/_core/authentication/login.vue';

const userStore = useUserStore();
const ipdAuthStore = useIpdAuthStore();
const accessStore = useAccessStore();
const router = useRouter();
const { destroyWatermark, updateWatermark } = useWatermark();

const tenantStore = useTenantStore();
const menus = computed(() => {
  const defaultMenus = [
    {
      handler: () => {
        router.push('/ipd/account');
      },
      icon: UserOutlined,
      text: '我的账户',
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
   * 2026-09-11（菜单/UI 统一）：登出走 IPD 会话全链路清理
   * （清 IPD 票 + 平台票 + 身份）。原实现只清 vben authStore——统一壳后
   * 会话主体是 IPD，若只清 vben 状态，IPD 票残留会导致「退出登录」无效。
   */
  await ipdAuthStore.logout();
  userStore.setUserInfo(null);
  resetRoutes();
  await router.push('/auth/login');
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
           logo-text/user-dropdown/notification/extra/lock-screen 等具名插槽），登录过期弹窗
           必须挂在 #extra 内。「IPD 工作台」回切按钮已随 2026-09-11 菜单/UI 统一移除——
           站内只剩一套壳一份菜单，不再有壳间切换。 -->
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
