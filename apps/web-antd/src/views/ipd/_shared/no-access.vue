<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Button, Result } from 'ant-design-vue';

import { IPD_HOME } from '../../../router/ipd-guard';

const router = useRouter();
</script>

<template>
  <Result
    status="403"
    title="当前账号无权访问该页面"
    sub-title="该入口属于超级管理员专区或需要更高权限。如需访问，请联系超级管理员。"
    aria-live="polite"
  >
    <template #extra>
      <Button type="primary" @click="router.replace(IPD_HOME)">返回工作台</Button>
    </template>
  </Result>
</template>
