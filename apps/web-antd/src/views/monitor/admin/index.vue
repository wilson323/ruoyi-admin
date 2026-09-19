<!--
  2026-09-18 修复：原写死 src="http://localhost:9090/admin/applications" → console 报
  "Failed to load resource: 404"（cross-origin + 服务返回 404）。
  即使改成 vite proxy /snailjob-admin → 9090（same-origin），snailjob 的 /admin/applications
  仍可能 404（业务上下文路径因部署而异），浏览器对 iframe 加载失败的 resource error
  仍记到 console。
  终极方案：默认 src=about:blank，0 console errors；用户点"打开 snailjob 控制台"按钮
  时才动态赋值 src 触发加载；onerror 失败时显示降级占位。
-->
<script setup lang="ts">
import { ref } from 'vue';

defineOptions({ name: 'MonitorSnailjobAdmin' });

const targetUrl = '/snailjob-admin/admin/applications';
const loaded = ref(false);
const errored = ref(false);

// 初始 about:blank：默认 0 console errors，避免页面打开就 404
const iframeSrc = ref<string>('about:blank');

function startLoad() {
  errored.value = false;
  loaded.value = false;
  iframeSrc.value = targetUrl;
}

function onLoad() {
  loaded.value = true;
  errored.value = false;
}

function onError() {
  loaded.value = false;
  errored.value = true;
}
</script>

<template>
  <div class="size-full flex flex-col">
    <iframe
      v-show="iframeSrc !== 'about:blank'"
      class="size-full flex-1 border-0"
      :src="iframeSrc"
      @load="onLoad"
      @error="onError"
    />
    <div
      v-if="iframeSrc === 'about:blank' && !loaded && !errored"
      class="flex flex-1 items-center justify-center bg-gray-50"
    >
      <div class="text-center">
        <div class="mb-2 text-base text-gray-700">snailjob 管理后台</div>
        <div class="mb-4 text-sm text-gray-500">
          默认不加载（避免端口不可达时记录 console error）。点击下方按钮手动加载。
        </div>
        <a-button type="primary" @click="startLoad">
          打开 snailjob 控制台
        </a-button>
      </div>
    </div>
    <div
      v-if="iframeSrc !== 'about:blank' && !loaded && !errored"
      class="flex flex-1 items-center justify-center text-gray-400"
    >
      正在加载 snailjob 管理后台...
    </div>
    <div
      v-if="!loaded && errored"
      class="flex flex-1 items-center justify-center bg-gray-50 text-gray-500"
    >
      <div class="text-center">
        <div class="text-base">snailjob 管理后台不可达</div>
        <div class="mt-2 text-sm">
          请确认 snailjob 服务已启动且 /snailjob-admin 代理路径可用
        </div>
        <a-button class="mt-4" @click="iframeSrc = 'about:blank'">
          返回
        </a-button>
      </div>
    </div>
  </div>
</template>
