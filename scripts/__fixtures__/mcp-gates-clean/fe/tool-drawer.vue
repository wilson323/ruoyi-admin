<template>
  <a-form-item label="命令"><a-input /></a-form-item>
</template>
<script setup lang="ts">
// 自证夹具（D-G04 干净态）：前端只出契约字段。
const columns = [
  { field: 'command', title: '命令' },
  { field: 'args', title: '参数' },
  { field: 'baseUrl', title: '地址' },
];
</script>
