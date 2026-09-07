<!--
  报表分析页（原型 /reports ProcessAnalyticsPage 复刻 + 后端契约适配）—— P4-4.1

  一比一部分：Frame「报表分析」标题/副标题（不公开个人排行榜、建议仅供治理者审阅）、
  metric-strip 四卡（一次质量通过率/审批退回率/招募平均周期/流程事件）、任务周期分布
  （cycle-bar 空态文案「正在积累周期样本」）、流程优化建议两张 insight-card 原文。

  必要适配（原型 /api/analytics/process 与后端 /api/v1/report 不同构，逐条登记）：
  1. 原型流程分析（质量通过率、退回率、招募周期、任务周期分布、流程事件流）后端无
     analytics 端点：四卡外壳与空态按原型渲染、数值显示「—」，灰色登记条如实说明，
     不做假数据。
  2. 后端已交付 P4-4.1 项目月度绩效汇总（GET /report/project-summary，month 必填）
     与三类台账导出（allowance/project 全员，bonus 仅组长+超管）：作为页面主数据区
     渲染（月份过滤 + 分页表格 + 导出结果卡），补足原型缺失的真实报表能力。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { message } from 'ant-design-vue';
import { BarChartOutlined, ClockCircleOutlined, FileTextOutlined, SafetyOutlined, WarningOutlined } from '@ant-design/icons-vue';

import { useIpdAuthStore } from '../../../store/ipd-auth';
import { formatDateTime, formatMoney } from '../_shared/format';
import { ipdErrorText } from '../_shared/ipd-error-text';
import {
  exportAllowance,
  exportBonus,
  exportProjectSummary,
  getProjectSummary,
  type ReportExportResult,
  type ReportSummaryPage,
  type ReportSummaryRow,
} from '../../../api/ipd/report';

const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
/** 奖金台账属资金敏感：仅产品组长/超管可见导出入口（AC-INC-34 权限梯度）。 */
const canExportBonus = computed(
  () => personType.value === 'GROUP_LEADER' || personType.value === 'SUPER_ADMIN',
);

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const month = ref(currentMonth());
const keyword = ref('');
const loading = ref(false);
const loadError = ref('');
const page = ref<null | ReportSummaryPage>(null);
const rows = computed<ReportSummaryRow[]>(() => page.value?.records ?? []);
const pageNo = ref(1);
const pageSize = 20;

const exporting = ref('');
const exportResult = ref<null | ReportExportResult>(null);

async function load(reset = false): Promise<void> {
  if (loading.value) return;
  if (reset) pageNo.value = 1;
  loading.value = true;
  loadError.value = '';
  try {
    page.value = await getProjectSummary({
      keyword: keyword.value.trim() || undefined,
      month: month.value,
      pageNo: pageNo.value,
      pageSize,
    });
  } catch (cause) {
    page.value = null;
    loadError.value = ipdErrorText(cause, { fallback: '报表加载失败，请稍后重试' });
  } finally {
    loading.value = false;
  }
}

onMounted(() => { void load(true); });

async function runExport(kind: 'allowance' | 'bonus' | 'project', row?: ReportSummaryRow): Promise<void> {
  if (exporting.value) return;
  exporting.value = kind;
  try {
    const result = kind === 'bonus'
      ? await exportBonus({ projectId: row?.projectId ?? '' })
      : kind === 'allowance'
        ? await exportAllowance({ month: month.value })
        : await exportProjectSummary({ keyword: keyword.value.trim() || undefined, month: month.value });
    exportResult.value = result;
    message.success(`${result.exportType} 导出完成，共 ${result.totalCount} 行`);
  } catch (cause) {
    exportResult.value = null;
    message.error(ipdErrorText(cause, { fallback: '导出失败，请稍后重试' }));
  } finally {
    exporting.value = '';
  }
}

async function goPage(next: number): Promise<void> {
  if (!page.value || next < 1 || next > page.value.pages) return;
  pageNo.value = next;
  await load();
}
</script>

<template>
  <div class="report-page">
    <header class="page-heading">
      <div>
        <h1>报表分析</h1>
        <p>以流程效率和质量为主，不公开个人排行榜；建议仅供治理者审阅，不自动修改 SOP。</p>
      </div>
    </header>

    <section class="surface summary-section">
      <div class="section-title">
        <div>
          <h2>项目月度绩效汇总</h2>
          <p>津贴核算、奖金池与加权绩效分按月汇总（P4-4.1，AC-INC-34）。</p>
        </div>
        <div class="inline-actions">
          <button
            :disabled="Boolean(exporting) || !month"
            class="secondary-button"
            type="button"
            @click="runExport('project')"
          >
            <FileTextOutlined />
            项目汇总导出
          </button>
          <button
            :disabled="Boolean(exporting) || !month"
            class="secondary-button"
            type="button"
            @click="runExport('allowance')"
          >
            津贴台账导出
          </button>
        </div>
      </div>
      <div class="summary-filter">
        <label>
          月份
          <input v-model="month" type="month" />
        </label>
        <label>
          关键字
          <input v-model="keyword" placeholder="项目编号 / 名称" @keyup.enter="load(true)" />
        </label>
        <button :disabled="!month || loading" class="primary-button" type="button" @click="load(true)">
          查询
        </button>
      </div>

      <div v-if="loadError" class="report-error">{{ loadError }}</div>

      <template v-if="rows.length">
        <div class="business-table">
          <div class="business-row head">
            <span>项目</span><span>月份</span><span>津贴核算</span><span>奖金池</span><span>平均加权分</span><span>操作</span>
          </div>
          <div v-for="row in rows" :key="`${row.projectId}-${row.month}`" class="business-row">
            <span>
              <strong>{{ row.projectName }}</strong>
              <small>{{ row.projectCode }}</small>
            </span>
            <span>{{ row.month }}</span>
            <span>
              <strong class="tabular-nums">¥{{ formatMoney(row.allowanceFinalAmount) }}</strong>
              <small>{{ row.allowanceRowCount ?? 0 }} 行台账</small>
            </span>
            <span>
              <strong class="tabular-nums">¥{{ formatMoney(row.bonusFinalPool) }}</strong>
              <small>{{ row.bonusRowCount ?? 0 }} 行台账</small>
            </span>
            <span>
              <strong>{{ row.avgWeightedScore ?? '—' }}</strong>
              <small>{{ row.scoreRowCount ?? 0 }} 人评分</small>
            </span>
            <span>
              <button
                v-if="canExportBonus"
                :disabled="Boolean(exporting)"
                class="panel-action"
                type="button"
                @click="runExport('bonus', row)"
              >
                奖金台账导出
              </button>
              <span v-else class="muted">奖金台账仅组长/超管可导出</span>
            </span>
          </div>
        </div>
        <div class="pager">
          <button :disabled="pageNo <= 1 || loading" class="panel-action" type="button" @click="goPage(pageNo - 1)">
            上一页
          </button>
          <span>第 {{ page?.current ?? pageNo }} / {{ page?.pages ?? 1 }} 页 · 共 {{ page?.total ?? 0 }} 条</span>
          <button
            :disabled="!page || pageNo >= page.pages || loading"
            class="panel-action"
            type="button"
            @click="goPage(pageNo + 1)"
          >
            下一页
          </button>
        </div>
      </template>
      <div v-else-if="!loading && !loadError" class="empty-state">
        <div><BarChartOutlined /></div>
        <strong>本月暂无汇总数据</strong>
        <p>选择月份后查询项目月度津贴、奖金池与绩效分汇总。</p>
      </div>
      <div v-if="loading" class="report-loading">正在汇总项目月度数据…</div>
    </section>

    <div v-if="exportResult" class="surface export-card">
      <div class="section-title">
        <h2>导出结果 · {{ exportResult.exportType }}</h2>
        <span>{{ exportResult.totalCount }} 行 · {{ exportResult.exportedBy }} · {{ formatDateTime(exportResult.exportedAt) }}</span>
      </div>
      <div class="export-columns">
        <span v-for="header in exportResult.headers" :key="header">{{ header }}</span>
      </div>
    </div>

    <section class="surface analytics-section">
      <div class="section-title">
        <div>
          <h2>流程分析</h2>
          <p>以流程事件为准，不追溯修改存量项目。</p>
        </div>
        <span>仅供治理者审阅</span>
      </div>
      <div class="metric-strip">
        <div class="metric"><span>一次质量通过率</span><strong>—</strong><small>平均质量分 —</small></div>
        <div class="metric warning"><span>审批退回率</span><strong>—</strong><small>定位责任节点与等待时间</small></div>
        <div class="metric"><span>招募平均周期</span><strong>—</strong><small>从发布到定标/关闭</small></div>
        <div class="metric"><span>流程事件</span><strong>—</strong><small>不可覆盖、可下钻</small></div>
      </div>
      <div class="analytics-grid">
        <div class="cycle-box">
          <div class="box-title">
            <h3>任务周期分布</h3>
            <span>按业务类型</span>
          </div>
          <div class="empty-state compact">
            <div><ClockCircleOutlined /></div>
            <strong>正在积累周期样本</strong>
            <p>任务完成后自动形成 P50/P90 和瓶颈指标。</p>
          </div>
        </div>
        <div class="cycle-box">
          <div class="box-title">
            <h3>流程优化建议</h3>
            <span>需管理员复制为新版本</span>
          </div>
          <article class="insight-card">
            <WarningOutlined />
            <div>
              <strong>优先治理高频质量退回动作</strong>
              <p>结合失败规则、返工次数和证据缺口定位 SOP 改进点；发布前必须校验样本范围与风险。</p>
              <small>不追溯修改存量项目</small>
            </div>
          </article>
          <article class="insight-card">
            <ClockCircleOutlined />
            <div>
              <strong>缩短跨角色审批等待</strong>
              <p>通过任务投递、未读提醒和超期升级减少状态停滞。</p>
              <small>建议先观察至少一个完整月度周期</small>
            </div>
          </article>
        </div>
      </div>
      <div class="report-pending">
        原型流程分析（/api/analytics/process：质量通过率、审批退回率、招募周期、任务周期分布、流程事件流）后端未交付，数值区不做假数据；已交付的项目月度汇总与台账导出见上方。
      </div>
      <div class="report-note"><SafetyOutlined /> 报表数据遵循资金敏感权限梯度：奖金台账仅产品组长与超级管理员可导出。</div>
    </section>
  </div>
</template>

<style scoped>

/* V12-F3: 原 1100px 断点归一至 768px（唯一断点常量见 _shared/ipd-breakpoints.ts） */
@media (max-width: 768px) {
  .metric-strip {
    grid-template-columns: repeat(2, 1fr);
  }

  .analytics-grid {
    grid-template-columns: 1fr;
  }

  .business-row {
    grid-template-columns: 1fr 1fr;
  }
}

.report-page {
  max-width: 1600px;
  padding: 28px 32px 60px;
  margin: auto;
}

.page-heading {
  margin-bottom: 24px;
}

.page-heading h1 {
  margin: 0 0 8px;
  font-size: 25px;
  letter-spacing: -0.02em;
}

.page-heading p {
  margin: 0;
  font-size: 13px;
  color: var(--ipd-muted);
}

.surface {
  margin-bottom: 18px;
  background: white;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}

.section-title {
  display: flex;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ipd-line);
}

.section-title h2 {
  margin: 0;
  font-size: 15px;
}

.section-title p {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--ipd-muted);
}

.section-title > span {
  font-size: 12px;
  color: var(--ipd-muted);
}

.primary-button,
.secondary-button,
.panel-action {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 16px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  border: 0;
  border-radius: 6px;
}

.primary-button {
  color: white;
  background: var(--ipd-blue);
  box-shadow: 0 4px 12px rgb(36 91 244 / 18%);
}

.primary-button:hover {
  background: #1747d7;
}

.primary-button:disabled,
.secondary-button:disabled,
.panel-action:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.secondary-button {
  color: #465168;
  background: white;
  border: 1px solid #cdd4df;
}

.panel-action {
  min-height: 30px;
  padding: 0 11px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ipd-text);
  background: white;
  border: 1px solid #cfd6e1;
}

.inline-actions {
  display: flex;
  gap: 10px;
}

.summary-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  padding: 16px 20px;
}

.summary-filter label {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  font-weight: 700;
}

.summary-filter input {
  height: 38px;
  padding: 0 10px;
  color: var(--ipd-text);
  border: 1px solid #cfd6e1;
  border-radius: 6px;
}

.report-error {
  padding: 10px 12px;
  margin: 0 20px 12px;
  font-size: 12px;
  color: #a8071a;
  background: #fff2f0;
  border: 1px solid #ffccc7;
  border-radius: 6px;
}

.report-loading {
  padding: 20px;
  font-size: 12px;
  color: var(--ipd-muted);
}

.business-table {
  padding: 0 20px 8px;
}

.business-row {
  display: grid;
  grid-template-columns: 1.4fr 0.6fr 1fr 1fr 0.9fr 1.1fr;
  gap: 10px;
  align-items: center;
  padding: 12px 0;
  font-size: 12px;
  border-bottom: 1px solid var(--ipd-line);
}

.business-row.head {
  font-size: 11px;
  font-weight: 700;
  color: var(--ipd-muted);
}

.business-row strong {
  display: block;
  font-size: 13px;
}

.business-row small {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ipd-muted);
}

.muted {
  font-size: 11px;
  color: var(--ipd-muted);
}

.pager {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: flex-end;
  padding: 12px 20px 16px;
  font-size: 12px;
  color: var(--ipd-muted);
}

.export-card .export-columns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 20px;
}

.export-columns span {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  color: var(--ipd-blue);
  background: #edf2ff;
  border-radius: 4px;
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 16px 20px 4px;
}

.metric {
  display: grid;
  gap: 4px;
  padding: 14px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}

.metric span {
  font-size: 11px;
  color: var(--ipd-muted);
}

.metric strong {
  font-size: 22px;
}

.metric small {
  font-size: 11px;
  color: var(--ipd-muted);
}

.metric.warning strong {
  color: #9a6509;
}

.analytics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 14px 20px;
}

.cycle-box {
  padding: 14px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}

.box-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.box-title h3 {
  margin: 0;
  font-size: 13px;
}

.box-title span {
  font-size: 11px;
  color: var(--ipd-muted);
}

.insight-card {
  display: flex;
  gap: 10px;
  padding: 12px;
  margin-bottom: 10px;
  font-size: 12px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}

.insight-card :deep(.anticon) {
  font-size: 18px;
  color: #9a6509;
}

.insight-card strong {
  display: block;
  font-size: 13px;
}

.insight-card p {
  margin: 4px 0;
  color: #56647c;
}

.insight-card small {
  color: var(--ipd-muted);
}

.empty-state {
  display: grid;
  place-content: center;
  justify-items: center;
  min-height: 160px;
  color: var(--ipd-muted);
  text-align: center;
}

.empty-state.compact {
  min-height: 120px;
}

.empty-state > div {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  font-size: 22px;
  color: var(--ipd-blue);
  background: #edf2ff;
  border-radius: 50%;
}

.empty-state strong {
  margin: 10px 0 4px;
  color: var(--ipd-text);
}

.empty-state p {
  max-width: 320px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

.summary-section .empty-state {
  min-height: 200px;
}

.report-pending {
  padding: 10px 12px;
  margin: 0 20px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: #6b7a90;
  background: #f6f8fb;
  border: 1px dashed #cfd9e5;
  border-radius: 6px;
}

.report-note {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 12px;
  margin: 0 20px;
  font-size: 12px;
  color: #56647c;
  background: #f2f6ff;
  border-radius: 6px;
}

.report-note :deep(.anticon) {
  color: var(--ipd-blue);
}

/* 原型 styles.css 摘录；--blue/--line/--muted/--text/--green 映射为 --ipd-*。 */
</style>
