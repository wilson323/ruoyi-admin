<script setup lang="ts">
// 游客门户两页（38/39）共享外壳：免登录轻量页，不套后台 basic 布局（公共规范 §二）。
// 只提供页面背景 / 顶部品牌与两页互跳导航 / 居中卡片容器；不注入任何会话依赖。
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import '../_shared/ipd-theme.css';

const route = useRoute();
const active = computed(() => route.path === '/portal/track' ? 'track' : 'submit');
</script>

<template>
  <div class="flex min-h-screen flex-col bg-[#F2F3F5]">
    <header class="border-b border-[#E4E7ED] bg-white">
      <div class="mx-auto flex h-14 w-full max-w-[720px] items-center justify-between px-4">
        <div class="flex items-center gap-2">
          <span class="inline-block h-6 w-1.5 rounded bg-[#006BE6]" aria-hidden="true"></span>
          <span class="text-base font-semibold">IPD 需求门户</span>
        </div>
        <nav class="flex items-center gap-4 text-sm" aria-label="门户导航">
          <RouterLink
            to="/portal/submit"
            :class="active === 'submit' ? 'font-medium text-[#006BE6]' : 'text-[#606266] hover:text-[#006BE6]'">提交需求</RouterLink>
          <RouterLink
            to="/portal/track"
            :class="active === 'track' ? 'font-medium text-[#006BE6]' : 'text-[#606266] hover:text-[#006BE6]'">查询进度</RouterLink>
        </nav>
      </div>
    </header>
    <main class="flex-1">
      <div class="mx-auto w-full max-w-[720px] px-4 py-10">
        <section class="rounded-lg border border-[#E4E7ED] bg-white p-6 shadow-sm sm:p-8" data-testid="portal-card">
          <slot></slot>
        </section>
      </div>
    </main>
    <footer class="pb-6 text-center text-xs text-[#909399]">
      提交的信息仅用于需求受理与进度反馈，不对外公开。
    </footer>
  </div>
</template>
