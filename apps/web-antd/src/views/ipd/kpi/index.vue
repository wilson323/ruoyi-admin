<!--
  KPI 考核页（原型 /performance 项目 KPI 复刻 + 后端月度聚合适配）—— P3-1.1~1.3

  一比一部分：Frame「KPI 考核」标题/副标题（按月聚合津贴分档合计与项目加权分、
  历史趋势缺数月补零）。

  必要适配（原型 /api/performance/kpis/* 按项目维度，后端 /api/v1/kpi/* 按月维度，逐条登记）：
  1. 原型 12 项项目 KPI 表格 + KpiDrawer（填报/证据上传/编辑）后端无对应写端点：
     此页仅渲染月度聚合读端点，原型表格/Drawer 在页内如实登记待后端增量。
  2. 共担 KPI 双组长确认读端点（原型 /api/performance/shared-kpis）后端仅
     POST /kpi/shared/deadline-scan 扫描触发，读端点缺：登记条维持真缺口。
  3. 项目绩效评定明细/结算端点已交付，挂在同模块隐藏路由
     IpdKpiScore，本页不展开（保持按月聚合 KPI 单职责）。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { message } from 'ant-design-vue';
import { FundOutlined, LineChartOutlined, RiseOutlined, TableOutlined } from '@ant-design/icons-vue';

import { formatMoney } from '../_shared/format';
import { ipdErrorText } from '../_shared/ipd-error-text';
import {
  getFunctionalKpi,
  getKpiTrend,
  getPerformanceKpi,
  type KpiPerformanceSummary,
  type KpiSourceItem,
  type KpiTrendPoint,
} from '../../../api/ipd/kpi';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const period = ref(currentMonth());
const periods = ref<6 | 12 | 24 | 36>(12);

const loading = ref(false);
const loadError = ref('');
const performance = ref<null | KpiPerformanceSummary>(null);
const functional = ref<KpiSourceItem[]>([]);
const trend = ref<KpiTrendPoint[]>([]);

/** 绩效聚合六键（与后端契约对齐，必含 L1..L5 + COMPREHENSIVE）。 */
const performanceCards = computed(() => {
  const data = performance.value ?? ({} as KpiPerformanceSummary);
  return [
    { key: 'COMPREHENSIVE', label: '综合', desc: '项目加权分 × 奖金池阶梯系数 ×100' },
    { key: 'L1', label: 'L1 津贴分档', desc: '主管级月度津贴合计' },
    { key: 'L2', label: 'L2 津贴分档', desc: '高级工程师月度津贴合计' },
    { key: 'L3', label: 'L3 津贴分档', desc: '工程师月度津贴合计' },
    { key: 'L4', label: 'L4 津贴分档', desc: '助理工程师月度津贴合计' },
    { key: 'L5', label: 'L5 津贴分档', desc: '见习月度津贴合计' },
  ].map((meta) => ({ ...meta, value: data[meta.key as keyof KpiPerformanceSummary] ?? '—' }));
});

/** 功能 KPI 来源中文映射（KpiRecordService 常量 → 显示名）。 */
const sourceLabel: Record<KpiSourceItem['source'], string> = {
  ALLOWANCE_LEDGER: '津贴台账',
  KPI_CALCULATOR: 'KPI 计算器',
  PROJECT_SCORE: '项目绩效分',
};

const functionalRows = computed<KpiSourceItem[]>(() => functional.value);

const trendRows = computed<KpiTrendPoint[]>(() => trend.value);

function toNumber(value: null | number | string): null | number {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatPercent(weight: null | number | string): string {
  const num = toNumber(weight);
  if (num === null) return '—';
  return `${(num * 100).toFixed(0)}%`;
}

function formatTrendValue(point: KpiTrendPoint): string {
  if (point.source === 'MISSING') return '—';
  const num = toNumber(point.value);
  return num === null ? '—' : num.toFixed(2);
}

async function load(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    const [perf, func, trendData] = await Promise.all([
      getPerformanceKpi(period.value),
      getFunctionalKpi(period.value),
      getKpiTrend(periods.value),
    ]);
    performance.value = perf;
    functional.value = func;
    trend.value = trendData;
  } catch (cause) {
    performance.value = null;
    functional.value = [];
    trend.value = [];
    loadError.value = ipdErrorText(cause, { fallback: 'KPI 加载失败，请稍后重试' });
    message.error(loadError.value);
  } finally {
    loading.value = false;
  }
}

onMounted(() => { void load(); });
</script>

<template>
  <div class="kpi-page">
    <header class="page-heading">
      <div>
        <h1>KPI 考核</h1>
        <p>按月聚合津贴分档合计（L1~L5）与项目加权分（COMPREHENSIVE）；功能 KPI 来源按权重加权；历史趋势缺数月补零。</p>
      </div>
      <div class="filter-bar">
        <label class="filter-label">
          <span>月份</span>
          <input v-model="period" type="month" class="filter-input" :disabled="loading" />
        </label>
        <label class="filter-label">
          <span>回看月数</span>
          <select v-model.number="periods" class="filter-input" :disabled="loading">
            <option :value="6">6 个月</option>
            <option :value="12">12 个月</option>
            <option :value="24">24 个月</option>
            <option :value="36">36 个月</option>
          </select>
        </label>
        <button class="primary-btn" :disabled="loading" @click="load()">查询</button>
      </div>
    </header>

    <section class="surface performance-section">
      <div class="section-title">
        <div>
          <h2><RiseOutlined /> 绩效聚合（KPI 评分六卡）</h2>
          <p>L1~L5 为津贴分档合计，COMPREHENSIVE 为项目加权分映射（P0-10.30）。</p>
        </div>
        <span class="period-tag">{{ period }}</span>
      </div>
      <div class="metric-grid">
        <article v-for="card in performanceCards" :key="card.key" class="metric-card">
          <header>
            <span class="metric-label">{{ card.label }}</span>
            <span class="metric-key">{{ card.key }}</span>
          </header>
          <div class="metric-value">{{ card.value === '—' ? '—' : formatMoney(card.value) }}</div>
          <p class="metric-desc">{{ card.desc }}</p>
        </article>
      </div>
      <p v-if="!performance" class="empty-tip">该月份尚无 KPI 记录，请先完成项目绩效评定。</p>
    </section>

    <section class="surface functional-section">
      <div class="section-title">
        <div>
          <h2><FundOutlined /> 功能 KPI 指标来源</h2>
          <p>三类来源按权重加权：项目绩效分 0.40 + KPI 计算器 0.40 + 津贴台账 0.20（P0-10.29）。</p>
        </div>
      </div>
      <table v-if="functionalRows.length" class="ipd-table">
        <thead>
          <tr>
            <th>来源</th>
            <th class="num">权重</th>
            <th class="num">原始值</th>
            <th class="num">加权贡献</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in functionalRows" :key="index">
            <td>{{ sourceLabel[row.source] }}</td>
            <td class="num">{{ formatPercent(row.weight) }}</td>
            <td class="num">{{ row.value ?? '—' }}</td>
            <td class="num">{{ row.contribution ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-tip">该月份尚无功能 KPI 来源数据。</p>
    </section>

    <section class="surface trend-section">
      <div class="section-title">
        <div>
          <h2><LineChartOutlined /> KPI 趋势</h2>
          <p>历史趋势缺数月补零（source=MISSING，P0-10.32），用于个人 KPI 走势复盘。</p>
        </div>
      </div>
      <table v-if="trendRows.length" class="ipd-table">
        <thead>
          <tr>
            <th>月份</th>
            <th class="num">KPI 值</th>
            <th>数据状态</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(point, index) in trendRows"
            :key="index"
            :class="{ 'trend-missing': point.source === 'MISSING' }"
          >
            <td>{{ point.period }}</td>
            <td class="num">{{ formatTrendValue(point) }}</td>
            <td>
              <span :class="['status-pill', point.source === 'MISSING' ? 'pill-missing' : 'pill-data']">
                {{ point.source === 'MISSING' ? '缺数月' : '有数' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-tip">暂无趋势数据。</p>
    </section>

    <section class="surface gap-section">
      <div class="section-title">
        <div>
          <h2><TableOutlined /> 待后端补齐的能力</h2>
          <p>原型 12 项项目 KPI 表格与共担 KPI 确认链后端尚未交付，登记不假绿。</p>
        </div>
      </div>
      <ul class="gap-list">
        <li>
          <strong>原型 12 项项目 KPI 表格（KPI 模板填报）</strong>
          <span>后端无 PUT /performance/kpis/{projectId}/{metricCode} 写端点；KpiDrawer 填报 / 证据上传 / 编辑均未交付。</span>
        </li>
        <li>
          <strong>共担 KPI 双组长确认读端点</strong>
          <span>后端仅 POST /kpi/shared/deadline-scan 扫描触发；GET /kpi/shared 读端点缺。</span>
        </li>
        <li>
          <strong>项目绩效评定明细 / 结算</strong>
          <span>ProjectScoreController 已交付，挂在 IpdKpiScore 隐藏路由；本页不展开。</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.kpi-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-end;
  justify-content: space-between;
}

.page-heading h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 600;
  color: var(--ipd-text-primary, #1a2233);
}

.page-heading p {
  margin: 0;
  font-size: 13px;
  color: var(--ipd-text-muted, #5a6478);
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
}

.filter-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--ipd-text-muted, #5a6478);
}

.filter-input {
  min-width: 140px;
  padding: 6px 10px;
  font-size: 13px;
  background: #fff;
  border: 1px solid var(--ipd-border, #d9dde7);
  border-radius: 6px;
}

.filter-input:disabled {
  color: var(--ipd-text-muted, #5a6478);
  background: var(--ipd-surface-muted, #f4f6fb);
}

.primary-btn {
  padding: 8px 18px;
  font-size: 13px;
  color: #fff;
  cursor: pointer;
  background: var(--ipd-primary, #1747d7);
  border: 0;
  border-radius: 6px;
}

.primary-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.surface {
  padding: 20px 22px;
  background: var(--ipd-surface, #fff);
  border-radius: 10px;
  box-shadow: 0 1px 2px rgb(20 30 60 / 4%);
}

.section-title {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.section-title h2 {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
  color: var(--ipd-text-primary, #1a2233);
}

.section-title p {
  margin: 0;
  font-size: 12px;
  color: var(--ipd-text-muted, #5a6478);
}

.period-tag {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ipd-primary, #1747d7);
  background: var(--ipd-blue-soft, #edf2ff);
  border-radius: 4px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.metric-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  background: var(--ipd-surface-muted, #fafbff);
  border: 1px solid var(--ipd-border, #d9dde7);
  border-radius: 8px;
}

.metric-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--ipd-text-muted, #5a6478);
}

.metric-label {
  font-weight: 600;
}

.metric-key {
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ipd-primary, #1747d7);
  background: var(--ipd-blue-soft, #edf2ff);
  border-radius: 3px;
}

.metric-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--ipd-text-primary, #1a2233);
}

.metric-desc {
  margin: 0;
  font-size: 11px;
  color: var(--ipd-text-muted, #5a6478);
}

.empty-tip {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--ipd-text-muted, #5a6478);
}

.ipd-table {
  width: 100%;
  font-size: 13px;
  border-collapse: collapse;
}

.ipd-table th,
.ipd-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--ipd-border, #e5e8f0);
}

.ipd-table th {
  font-size: 12px;
  font-weight: 500;
  color: var(--ipd-text-muted, #5a6478);
  background: var(--ipd-surface-muted, #fafbff);
}

.ipd-table .num {
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.trend-missing {
  color: var(--ipd-text-muted, #5a6478);
  background: rgb(0 0 0 / 2%);
}

.status-pill {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
}

.pill-data {
  color: #1f8c45;
  background: rgb(36 158 76 / 12%);
}

.pill-missing {
  color: #5a6478;
  background: rgb(150 150 150 / 18%);
}

.gap-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.gap-list li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  background: rgb(230 162 60 / 6%);
  border-left: 3px solid var(--ipd-warning, #e6a23c);
  border-radius: 4px;
}

.gap-list strong {
  font-size: 13px;
  color: var(--ipd-text-primary, #1a2233);
}

.gap-list span {
  font-size: 12px;
  color: var(--ipd-text-muted, #5a6478);
}
</style>
