<script setup lang="ts">
/**
 * 页29 共担 KPI 归集（卡 P0-10.30；后端仅 POST /kpi/shared/deadline-scan 扫描触发，
 * 读端点缺）。按 G-06 准则挂后端缺读端点占位，BackendPending meta 已挂。
 */
import BackendPending from '../../_shared/backend-pending.vue';

defineOptions({ name: 'IpdKpiShared', meta: { ipdCard: 'P0-10.30' } });
</script>

<template>
  <BackendPending
    backend="共担 KPI 读端点缺；后端仅交付 POST /kpi/shared/deadline-scan 扫描触发器"
    card="P0-10.30"
    note="共担 KPI 双组长确认读端点未交付；本页维持真缺口登记，等待后端补齐后按真实接口实现。"
  />
</template>
