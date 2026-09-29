<template>
  <span>{{ tool.configJson }}</span>
</template>
<script setup lang="ts">
// 自证夹具（D-G04 违规态）：field:'env'（E-A1 前禁）→ 位 1；{{ tool.configJson }} 明文渲染 → 位 4。
const columns = [
  { field: 'command', title: '命令' },
  { field: 'env', title: '环境' },
];
</script>
