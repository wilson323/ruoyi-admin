<script lang="ts" setup>
import { computed } from 'vue';

import { AuthPageLayout } from '@vben/layouts';
import { preferences } from '@vben/preferences';

const appName = computed(() => preferences.app.name);
const logo = computed(() => preferences.logo.source);
</script>

<template>
  <AuthPageLayout
    :app-name="appName"
    :logo="logo"
    page-description="围绕产品全生命周期，协同推进每一个项目"
    page-title="IPD 产品经理管理系统"
  >
    <!-- 自定义工具栏 -->
    <!-- <template #toolbar></template> -->
  </AuthPageLayout>
</template>
