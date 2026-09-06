<script setup lang="ts">
/**
 * 项目详情 - KPI 考核 子页签（卡 P0-10.32；后端 GET /kpi/performance 已交付）。
 * 绩效聚合：L1..L5 津贴分档合计 + COMPREHENSIVE 项目加权分。
 */
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Alert, Button, Card, Descriptions, DescriptionsItem, Empty, Input } from 'ant-design-vue';

import { type KpiPerformanceSummary, getPerformanceKpi } from '../../../../api/ipd/kpi';
import { ipdErrorText } from '../../_shared/ipd-error-text';

defineOptions({ name: 'IpdProjectKpi', meta: { ipdCard: 'P0-10.32' } });

const route = useRoute();
const projectId = computed(() => String(route.params.projectId ?? ''));
const period = ref(defaultPeriod());
const summary = ref<null | KpiPerformanceSummary>(null);
const loading = ref(false);
const errorMsg = ref('');

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const levelText: Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5', string> = {
  L1: 'L1（基数 1000）',
  L2: 'L2（基数 1500）',
  L3: 'L3（基数 2000）',
  L4: 'L4（基数 2500）',
  L5: 'L5（基数 3000）',
};

async function load(): Promise<void> {
  if (!period.value.trim() || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    summary.value = await getPerformanceKpi(period.value.trim());
  } catch (cause) {
    summary.value = null;
    errorMsg.value = ipdErrorText(cause, { fallback: '绩效 KPI 加载失败' });
  } finally {
    loading.value = false;
  }
}

watch(projectId, (next) => {
  if (next) void load();
}, { immediate: true });
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      :message="`项目 KPI 考核：${projectId || '尚未选择项目'} · 当前周期 ${period}`"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="查询条件">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">核算周期（YYYY-MM）</div>
          <Input v-model:value="period" placeholder="2026-09" style="width: 160px" @keyup.enter="load" />
        </div>
        <Button type="primary" :loading="loading" @click="load">查询绩效</Button>
      </div>
    </Card>

    <Card title="绩效 KPI 聚合">
      <div v-if="errorMsg" class="mb-2 text-xs text-red-600">{{ errorMsg }}</div>
      <Empty v-else-if="!summary && !loading" description="请查询后查看项目绩效" />
      <Descriptions v-else-if="summary" bordered :column="2" size="small">
        <DescriptionsItem label="L1 津贴分档">{{ summary.L1 }}</DescriptionsItem>
        <DescriptionsItem label="L2 津贴分档">{{ summary.L2 }}</DescriptionsItem>
        <DescriptionsItem label="L3 津贴分档">{{ summary.L3 }}</DescriptionsItem>
        <DescriptionsItem label="L4 津贴分档">{{ summary.L4 }}</DescriptionsItem>
        <DescriptionsItem label="L5 津贴分档">{{ summary.L5 }}</DescriptionsItem>
        <DescriptionsItem label="综合分（×100 后奖金池映射）">
          <strong>{{ summary.COMPREHENSIVE }}</strong>
        </DescriptionsItem>
      </Descriptions>
      <div v-else-if="loading" class="py-6 text-center text-xs text-gray-500">正在加载绩效 KPI…</div>
    </Card>

    <div class="mt-2 text-xs text-gray-500">
      等级说明：L1 基数 1000 · L2 基数 1500 · L3 基数 2000 · L4 基数 2500 · L5 基数 3000（× 绑定项目数，封顶 2 倍）。
    </div>
  </div>
</template>
