<script setup lang="ts">
/**
 * 页29 功能 KPI 指标来源与加权贡献（卡 P0-10.29；后端 GET /kpi/functional 已交付）。
 * 与原型不同构（逐条登记）：原型 12 项项目 KPI 表格 + KpiDrawer 填报/证据上传（PUT）
 * 后端未交付；本页只读展示后端汇总计算结果（来源 × 权重 × 贡献），符合 G-06 五态准则。
 */
import { computed, onMounted, ref } from 'vue';
import { Alert, Button, Card, Empty, Input, Table, Tag } from 'ant-design-vue';

import { type KpiSourceItem, getFunctionalKpi } from '../../../../api/ipd/kpi';
import { ipdErrorText, isTransportError } from '../../_shared/ipd-error-text';

defineOptions({ name: 'IpdKpiFunctional', meta: { ipdCard: 'P0-10.29' } });

const period = ref(defaultPeriod());
const items = ref<KpiSourceItem[]>([]);
const loading = ref(false);
const errorMsg = ref('');
const loaded = ref(false);

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const sourceText: Record<KpiSourceItem['source'], string> = {
  ALLOWANCE_LEDGER: '津贴台账',
  KPI_CALCULATOR: 'KPI 计算器',
  PROJECT_SCORE: '项目评分',
};

const columns = [
  { title: '指标来源', dataIndex: 'source', key: 'source', width: 140 },
  { title: '原始值', dataIndex: 'value', key: 'value', width: 140 },
  { title: '权重', dataIndex: 'weight', key: 'weight', width: 100 },
  { title: '加权贡献', dataIndex: 'contribution', key: 'contribution', width: 140 },
];

async function load(): Promise<void> {
  if (!period.value.trim() || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    items.value = await getFunctionalKpi(period.value.trim());
    loaded.value = true;
  } catch (cause) {
    items.value = [];
    errorMsg.value = ipdErrorText(cause, { fallback: '功能 KPI 加载失败' });
  } finally {
    loading.value = false;
  }
}

const networkDown = computed(() => loaded.value && !errorMsg.value && items.value.length === 0);

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="功能 KPI：来自津贴台账 / KPI 计算器 / 项目评分三类来源，按权重汇总加权贡献。"
      show-icon
      type="info"
    />
    <Card class="mb-4" title="查询条件">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">核算周期（YYYY-MM）</div>
          <Input v-model:value="period" placeholder="2026-09" style="width: 160px" @keyup.enter="load" />
        </div>
        <Button type="primary" :loading="loading" @click="load">加载功能 KPI</Button>
        <Button v-if="errorMsg && isTransportError({ message: errorMsg })" :loading="loading" @click="load">重试</Button>
      </div>
    </Card>

    <Card title="功能 KPI 明细">
      <Table
        :columns="columns"
        :data-source="items"
        :loading="loading"
        :pagination="false"
        row-key="source"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'source'">
            <Tag>{{ sourceText[record.source as KpiSourceItem['source']] ?? record.source }}</Tag>
          </template>
          <template v-else-if="column.key === 'value'">{{ record.value ?? '—' }}</template>
          <template v-else-if="column.key === 'weight'">{{ record.weight ?? '—' }}</template>
          <template v-else-if="column.key === 'contribution'">
            <strong>{{ record.contribution ?? '—' }}</strong>
          </template>
        </template>
        <template #emptyText>
          <Empty :description="errorMsg || (networkDown ? '服务暂不可达，请稍后重试' : (loaded ? '当前周期暂无功能 KPI 数据' : '请输入核算周期后加载'))" />
        </template>
      </Table>
    </Card>

    <div v-if="errorMsg && !isTransportError({ message: errorMsg })" class="mt-2 text-xs text-red-600">{{ errorMsg }}</div>
  </div>
</template>
