<script setup lang="ts">
/**
 * 项目详情 - KPI 考核 子页签（卡 P0-10.32；后端 GET /kpi/{performance,functional,trend} 已交付）。
 *
 * 三段呈现（与 W3-A5 奖金池同型 UI 模式）：
 *   ① 功能 KPI 来源（GET /kpi/functional，按月聚合，来源类型 + 加权贡献）
 *   ② 绩效 KPI 聚合（GET /kpi/performance，L1..L5 + COMPREHENSIVE）
 *   ③ 历史 KPI 趋势（GET /kpi/trend，periods 回看月数 1~36，缺省 12）
 *
 * 路由：IpdProjectKpi 经由 /ipd/projects/:projectId/kpi 注入 projectId。
 * 真缺口登记：原型 12 项 KPI 表格 + KpiDrawer 填报 + 共担 KPI 双组长确认读端点
 * 后端均未交付，page 内 mock 不补（避免契约漂移）。
 */
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Empty,
  Input,
  InputNumber,
  Table,
  Tag,
} from 'ant-design-vue';

import {
  type KpiPerformanceSummary,
  type KpiSourceItem,
  type KpiTrendPoint,
  getFunctionalKpi,
  getKpiTrend,
  getPerformanceKpi,
} from '../../../../api/ipd/kpi';
import { ipdErrorText } from '../../_shared/ipd-error-text';

defineOptions({ name: 'IpdProjectKpi', meta: { ipdCard: 'P0-10.32' } });

const route = useRoute();
const projectId = computed(() => String(route.params.projectId ?? ''));
const period = ref(defaultPeriod());
const periods = ref(12);

const functional = ref<null | KpiSourceItem[]>(null);
const performance = ref<null | KpiPerformanceSummary>(null);
const trend = ref<null | KpiTrendPoint[]>(null);

const loading = ref(false);
const errorMsg = ref('');

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const SOURCE_TEXT: Record<KpiSourceItem['source'], string> = {
  ALLOWANCE_LEDGER: '津贴台账',
  KPI_CALCULATOR: 'KPI 计算器',
  PROJECT_SCORE: '项目绩效分',
};

const TREND_SOURCE_TEXT: Record<KpiTrendPoint['source'], string> = {
  DATA: '有数',
  MISSING: '缺数月',
};

const TREND_SOURCE_COLOR: Record<KpiTrendPoint['source'], string> = {
  DATA: 'blue',
  MISSING: 'default',
};

async function load(): Promise<void> {
  if (loading.value) return;
  const p = period.value.trim();
  if (!p) {
    errorMsg.value = '请填写核算周期（YYYY-MM）';
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  try {
    // 三端点并发：performance / functional / trend 任一失败不影响其它展示。
    const results = await Promise.allSettled([
      getPerformanceKpi(p),
      getFunctionalKpi(p),
      getKpiTrend(periods.value),
    ]);
    performance.value = results[0]!.status === 'fulfilled' ? results[0]!.value : null;
    functional.value = results[1]!.status === 'fulfilled' ? results[1]!.value : null;
    trend.value = results[2]!.status === 'fulfilled' ? results[2]!.value : null;

    const firstReject = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    errorMsg.value = firstReject
      ? ipdErrorText(firstReject.reason, { fallback: 'KPI 加载失败' })
      : '';
  } finally {
    loading.value = false;
  }
}

watch(projectId, (next) => {
  if (next) void load();
}, { immediate: true });

const functionalColumns = [
  { title: '指标来源', key: 'source', width: 130 },
  { title: '原始值', key: 'value', width: 130 },
  { title: '权重', key: 'weight', width: 100 },
  { title: '加权贡献', key: 'contribution', width: 130 },
];

const trendColumns = [
  { title: '周期', key: 'period', width: 110 },
  { title: '分数', key: 'value', width: 110 },
  { title: '状态', key: 'source', width: 100 },
];
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      :message="`项目 KPI 考核：项目 ${projectId || '尚未选择'} · 当前周期 ${period} · L1..L5 津贴分档合计 + COMPREHENSIVE 项目加权分（×100 后奖金池映射）。后端 KpiRecordController：GET /kpi/performance · /kpi/functional · /kpi/trend。`"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="查询条件">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">项目编号</div>
          <Input
            :value="projectId"
            disabled
            placeholder="由路由注入（/ipd/projects/:projectId/kpi）"
            style="width: 220px"
          />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">核算周期（YYYY-MM）</div>
          <Input v-model:value="period" placeholder="2026-09" style="width: 160px" @keyup.enter="load" />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">趋势回看月数</div>
          <InputNumber v-model:value="periods" :min="1" :max="36" style="width: 160px" />
        </div>
        <Button type="primary" :loading="loading" @click="load">查询</Button>
      </div>
    </Card>

    <div v-if="errorMsg" class="mb-2 text-xs text-red-600">{{ errorMsg }}</div>

    <Card class="mb-4" title="① 绩效 KPI 聚合（GET /kpi/performance）">
      <Empty v-if="!performance && !loading" description="请查询后查看项目绩效" />
      <Descriptions v-else-if="performance" bordered :column="2" size="small">
        <DescriptionsItem label="L1 津贴分档">{{ performance.L1 }}</DescriptionsItem>
        <DescriptionsItem label="L2 津贴分档">{{ performance.L2 }}</DescriptionsItem>
        <DescriptionsItem label="L3 津贴分档">{{ performance.L3 }}</DescriptionsItem>
        <DescriptionsItem label="L4 津贴分档">{{ performance.L4 }}</DescriptionsItem>
        <DescriptionsItem label="L5 津贴分档">{{ performance.L5 }}</DescriptionsItem>
        <DescriptionsItem label="综合分（×100 后奖金池映射）">
          <strong>{{ performance.COMPREHENSIVE }}</strong>
        </DescriptionsItem>
      </Descriptions>
      <div v-else-if="loading" class="py-6 text-center text-xs text-gray-500">正在加载绩效 KPI…</div>
    </Card>

    <Card class="mb-4" title="② 功能 KPI 指标来源（GET /kpi/functional）">
      <Empty v-if="!functional && !loading" description="请查询后查看功能 KPI 来源" />
      <Table
        v-else-if="functional"
        :columns="functionalColumns"
        :data-source="functional"
        :loading="loading"
        :pagination="false"
        row-key="source"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'source'">{{ SOURCE_TEXT[record.source as KpiSourceItem['source']] ?? record.source }}</template>
          <template v-else-if="column.key === 'value'">{{ record.value ?? '—' }}</template>
          <template v-else-if="column.key === 'weight'">
            {{ record.weight === null || record.weight === undefined ? '—' : `${(Number(record.weight) * 100).toFixed(0)}%` }}
          </template>
          <template v-else-if="column.key === 'contribution'">
            <strong>{{ record.contribution ?? '—' }}</strong>
          </template>
        </template>
      </Table>
    </Card>

    <Card class="mb-4" title="③ 历史 KPI 趋势（GET /kpi/trend · 默认回看 12 个月）">
      <Empty v-if="!trend && !loading" description="请查询后查看历史趋势" />
      <Table
        v-else-if="trend"
        :columns="trendColumns"
        :data-source="trend"
        :loading="loading"
        :pagination="false"
        row-key="period"
        size="small"
        :row-class-name="(record: KpiTrendPoint) => record.source === 'MISSING' ? 'trend-missing' : ''"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'period'">{{ record.period }}</template>
          <template v-else-if="column.key === 'value'">{{ record.value ?? '—' }}</template>
          <template v-else-if="column.key === 'source'">
            <Tag :color="TREND_SOURCE_COLOR[record.source as KpiTrendPoint['source']]">
              {{ TREND_SOURCE_TEXT[record.source as KpiTrendPoint['source']] ?? record.source }}
            </Tag>
          </template>
        </template>
      </Table>
    </Card>

    <div class="mt-2 text-xs text-gray-500">
      等级说明：L1 基数 1000 · L2 基数 1500 · L3 基数 2000 · L4 基数 2500 · L5 基数 3000（× 绑定项目数，封顶 2 倍）。
    </div>
  </div>
</template>

<style scoped>
.trend-missing :deep(td) {
  font-style: italic;
  color: #bfbfbf;
}
</style>
