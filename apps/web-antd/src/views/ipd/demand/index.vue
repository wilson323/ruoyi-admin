<!--
 * 页40 需求管理（后端 DemandController GET /api/v1/demands，2026-09-06 接入真实数据）。
 *
 * 真值源：ZK-IPD 原型 App.jsx RequirementsPage（G1 门禁对照 2026-09-06）。
 * 形态：双 tab（产品需求 ProductDemandsPanel / 项目需求 ProjectRequirementsPanel）；
 * 项目需求 tab 按原型 .embedded-page 规则不重复渲染内层页头。
 * 数据层适配（后端 v3 值域，详见 api/ipd/demand.ts 头注）：
 * - 动作链：SUBMITTED/ACCEPTED→开始分析、EVALUATING→纳入规划、
 *   EVALUATING/SCHEDULED→关联项目（原型文案「关联当前项目」；本项目无全局当前项目
 *   上下文，改为弹窗选择目标项目）；
 * - 原型超管型号码匹配、需求附件、项目需求录入/状态推进按钮：后端无对应接口，不实现；
 * - U1-7（20260906 蜂群快修）：接入 zk-ipd-rules §五.5 需求池删除双审页内提示。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { FileTextOutlined } from '@ant-design/icons-vue';
import { Alert, Modal, Select, message } from 'ant-design-vue';

import { fetchDemands, linkDemandProject, triageDemand } from '../../../api/ipd/demand';
import type { IpdDemand } from '../../../api/ipd/demand';
import { listProjects } from '../../../api/ipd/project';
import type { Project } from '../../../api/ipd/project';
import { listProducts } from '../../../api/ipd/product';
import type { Product } from '../../../api/ipd/product';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import { RULES_BY_PAGE, renderRulesDescription } from '../_shared/zk-ipd-rules';
import '../_shared/ipd-theme.css';

const auth = useIpdAuthStore();
const isSuperAdmin = computed(() => auth.identity?.person.personType === 'SUPER_ADMIN');
const demandRules = computed(() => renderRulesDescription(RULES_BY_PAGE.demand));

/** 展示名沿用原型词汇；ACCEPTED/PROCESSING/CLOSED/ARCHIVED 为后端 v3 值域新增。 */
const DEMAND_STATUS_TEXT: Record<string, string> = {
  SUBMITTED: '新提交',
  ACCEPTED: '已受理',
  EVALUATING: '分析中',
  SCHEDULED: '已规划',
  PROCESSING: '处理中',
  CLOSED: '已关闭',
  ARCHIVED: '已归档',
};
/** pill 色调沿用原型既有色系（candidate 琥珀 / evaluating 蓝 / baselined 绿 / p2 灰）。 */
const DEMAND_STATUS_TONE: Record<string, string> = {
  SUBMITTED: 'amber',
  ACCEPTED: 'blue',
  EVALUATING: 'blue',
  SCHEDULED: 'green',
  PROCESSING: 'blue',
  CLOSED: 'gray',
  ARCHIVED: 'gray',
};

const STATUS_ORDER = [
  'SUBMITTED',
  'ACCEPTED',
  'EVALUATING',
  'SCHEDULED',
  'PROCESSING',
  'CLOSED',
  'ARCHIVED',
] as const;

/** 原型 formatTime：MM/DD HH:mm（Intl zh-CN 2-digit）。 */
function formatTime(value: null | number | string | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 需求池数据（productId 变化重新拉取；状态筛选为前端本地过滤，与原型一致）。 */
const demands = ref<IpdDemand[]>([]);
const products = ref<Product[]>([]);
const loadError = ref('');
const statusFilter = ref('all');
const productFilter = ref('');
const busyId = ref('');

async function loadDemands() {
  loadError.value = '';
  try {
    const result = await fetchDemands(
      productFilter.value ? { productId: productFilter.value } : undefined,
    );
    demands.value = result.demands ?? [];
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '需求池接口加载失败';
  }
}

async function loadProducts() {
  if (!isSuperAdmin.value) return;
  try {
    products.value = await listProducts();
  } catch {
    products.value = [];
  }
}

function onProductFilterChange() {
  // 原型：productId 变化重新请求（useEffect [productId]）
  loadDemands();
}

/** 产品需求 tab：状态本地过滤（原型 visible）。 */
const visibleProductDemands = computed(() =>
  demands.value.filter((d) => statusFilter.value === 'all' || d.status === statusFilter.value),
);

/** 项目需求 tab：已关联项目的需求（后端无独立 /requirements 列表接口）。 */
const projectDemands = computed(() => demands.value.filter((d) => d.projectId));
const projectStatusFilter = ref('all');
const visibleProjectDemands = computed(() =>
  projectDemands.value.filter(
    (d) => projectStatusFilter.value === 'all' || d.status === projectStatusFilter.value,
  ),
);

/** 项目 id → 名称（关联结果展示； demands 载荷只有 projectId）。 */
const projectNameById = ref(new Map<string, string>());

function projectNameOf(demand: IpdDemand): string {
  return demand.projectId ? (projectNameById.value.get(demand.projectId) ?? '') : '';
}

async function loadProjectNames() {
  try {
    const projects = await listProjects();
    projectNameById.value = new Map(projects.map((p) => [p.id, p.name]));
  } catch {
    projectNameById.value = new Map();
  }
}

/* ---------------- 产品需求 tab：4 metric（原型口径 + 受理态并入待响应） ---------------- */
const productMetrics = computed(() => [
  {
    label: '产品需求总量',
    note: '游客与内部来源统一池',
    tone: '',
    value: demands.value.length,
  },
  {
    label: '待分析',
    note: '需要产品PM响应',
    tone: 'warning',
    value: demands.value.filter((d) => d.status === 'ACCEPTED' || d.status === 'SUBMITTED').length,
  },
  {
    label: '未匹配产品',
    note: '由超级管理员匹配',
    tone: 'danger',
    value: demands.value.filter((d) => !d.productId).length,
  },
  {
    label: '已进入项目',
    note: '关联具体IPD动作',
    tone: '',
    value: demands.value.filter((d) => d.projectId).length,
  },
]);

/* ---------------- 项目需求 tab：4 metric（原型口径映射后端状态） ---------------- */
const projectMetrics = computed(() => [
  { label: '全部需求', note: '已关联项目的需求池', tone: '', value: projectDemands.value.length },
  {
    label: '评估中',
    note: '等待价值与成本结论',
    tone: 'warning',
    value: projectDemands.value.filter((d) => d.status === 'EVALUATING').length,
  },
  {
    label: '已规划',
    note: '已进入承诺范围',
    tone: '',
    value: projectDemands.value.filter((d) => d.status === 'SCHEDULED').length,
  },
  {
    label: '处理中',
    note: '进入执行阶段',
    tone: '',
    value: projectDemands.value.filter((d) => d.status === 'PROCESSING').length,
  },
]);

/* ---------------- 动作链（原型 new→triaging→planned→link-project 的后端映射） ---------------- */
function canStart(demand: IpdDemand): boolean {
  return demand.status === 'ACCEPTED' || demand.status === 'SUBMITTED';
}
function canPlan(demand: IpdDemand): boolean {
  return demand.status === 'EVALUATING';
}
function canLink(demand: IpdDemand): boolean {
  return !demand.projectId && (demand.status === 'EVALUATING' || demand.status === 'SCHEDULED');
}

async function onTriage(demand: IpdDemand, next: string) {
  busyId.value = demand.id;
  try {
    await triageDemand(demand.id, { status: next });
    await loadDemands();
    message.success(`需求 ${demand.id} 已更新为${DEMAND_STATUS_TEXT[next] ?? next}`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '分流失败，请稍后重试');
  } finally {
    busyId.value = '';
  }
}

/* ---------------- 关联项目弹窗（原型「关联当前项目」的目标项目选择） ---------------- */
const linkModalOpen = ref(false);
const linkTarget = ref<IpdDemand | null>(null);
const linkProjectId = ref<string>();
const linkProjectOptions = ref<{ label: string; value: string }[]>([]);
const linkBusy = ref(false);

async function openLinkModal(demand: IpdDemand) {
  linkTarget.value = demand;
  linkProjectId.value = undefined;
  linkModalOpen.value = true;
  if (linkProjectOptions.value.length === 0) {
    try {
      const projects: Project[] = await listProjects();
      linkProjectOptions.value = projects.map((p) => ({
        label: `${p.name} · ${p.code ?? p.id}`,
        value: p.id,
      }));
    } catch {
      linkProjectOptions.value = [];
    }
  }
}

async function confirmLink() {
  if (!linkTarget.value || !linkProjectId.value) return;
  linkBusy.value = true;
  try {
    await linkDemandProject(linkTarget.value.id, linkProjectId.value);
    await loadDemands();
    linkModalOpen.value = false;
    const label = linkProjectOptions.value.find((o) => o.value === linkProjectId.value)?.label ?? '';
    message.success(`需求 ${linkTarget.value.id} 已关联 ${label}`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '关联失败，请稍后重试');
  } finally {
    linkBusy.value = false;
  }
}

/* ---------------- 双 tab（原型 section-switch） ---------------- */
const activeTab = ref<'product' | 'project'>('product');

onMounted(() => {
  loadDemands();
  loadProducts();
  loadProjectNames();
});
</script>

<template>
  <div class="ipd-req">
    <!-- 页头（原型 PageFrame：需求管理） -->
    <header class="ipd-req-heading">
      <div>
        <h1>需求管理</h1>
        <p>产品需求先归属长期产品档案，评估后再进入具体IPD项目；内部需求仍按项目动作管理。</p>
      </div>
    </header>

    <!-- ZK-IPD §五.5 业务规则提示：需求池删除双审（产品组长初审 + 超级管理员终审） -->
    <Alert
      class="ipd-req-rules"
      type="info"
      show-icon
      message="ZK-IPD 需求池规则"
      :description="demandRules"
    />

    <!-- 双 tab（原型 section-switch，max-width 360px） -->
    <div class="ipd-req-switch" role="tablist">
      <button
        :class="{ active: activeTab === 'product' }"
        type="button"
        @click="activeTab = 'product'"
      >
        产品需求
      </button>
      <button
        :class="{ active: activeTab === 'project' }"
        type="button"
        @click="activeTab = 'project'"
      >
        项目需求
      </button>
    </div>

    <!-- ============ tab 1 产品需求（原型 ProductDemandsPanel） ============ -->
    <template v-if="activeTab === 'product'">
      <div class="ipd-req-metrics" data-testid="demand-metrics">
        <div
          v-for="m in productMetrics"
          :key="m.label"
          class="ipd-req-metric"
          :class="m.tone"
        >
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
          <small>{{ m.note }}</small>
        </div>
      </div>

      <section class="ipd-req-surface">
        <div class="ipd-req-toolbar">
          <div class="ipd-req-segmented" role="group">
            <button
              v-for="s in ['all', ...STATUS_ORDER]"
              :key="s"
              :class="{ active: statusFilter === s }"
              type="button"
              @click="statusFilter = s"
            >
              {{ s === 'all' ? '全部' : DEMAND_STATUS_TEXT[s] }}
            </button>
          </div>
          <select
            v-if="isSuperAdmin"
            v-model="productFilter"
            data-testid="demand-product-filter"
            @change="onProductFilterChange"
          >
            <option value="">全部产品</option>
            <option v-for="p in products" :key="p.id" :value="p.id">
              {{ p.modelCode ?? p.productCode }} · {{ p.productName }}
            </option>
          </select>
        </div>

        <div class="ipd-req-demand-list">
          <p v-if="loadError" class="ipd-req-load-error">{{ loadError }}</p>
          <article v-for="d in visibleProductDemands" :key="d.id">
            <div class="ipd-req-demand-source">
              <span :class="{ guest: d.source === 'PORTAL_GUEST' }" class="ipd-req-source-badge">
                {{ d.source === 'PORTAL_GUEST' ? '游客' : '内部' }}
              </span>
              <strong>#{{ d.id }}</strong>
              <small>{{ formatTime(d.createdAt) }}</small>
            </div>
            <div>
              <h3>{{ d.customerName ?? '未指定客户' }} · {{ d.submitterName ?? '—' }}</h3>
              <p>{{ d.title ?? '—' }}</p>
              <small>
                {{ d.productName ? d.productName : '待匹配：未指定产品' }}
                <template v-if="projectNameOf(d)"> → {{ projectNameOf(d) }}</template>
              </small>
              <small v-if="d.marketPmName || d.rdPmName">
                市场PM {{ d.marketPmName ?? '—' }} · 研发PM {{ d.rdPmName ?? '—' }}
              </small>
            </div>
            <div class="ipd-req-demand-actions">
              <i :class="DEMAND_STATUS_TONE[d.status]" class="ipd-req-status-pill">
                {{ DEMAND_STATUS_TEXT[d.status] ?? d.status }}
              </i>
              <button v-if="canStart(d)" :disabled="busyId === d.id" type="button" @click="onTriage(d, 'EVALUATING')">
                开始分析
              </button>
              <button v-if="canPlan(d)" :disabled="busyId === d.id" type="button" @click="onTriage(d, 'SCHEDULED')">
                纳入规划
              </button>
              <button
                v-if="canLink(d)"
                class="ipd-req-primary-link"
                :disabled="busyId === d.id"
                type="button"
                @click="openLinkModal(d)"
              >
                关联项目
              </button>
            </div>
          </article>
          <div v-if="!loadError && visibleProductDemands.length === 0" class="ipd-req-empty">
            <div><FileTextOutlined /></div>
            <strong>当前筛选下暂无产品需求</strong>
            <p>游客提交后会按产品负责人自动进入这里；其他型号进入超级管理员待匹配池。</p>
          </div>
        </div>
      </section>
    </template>

    <!-- ============ tab 2 项目需求（原型 ProjectRequirementsPanel，embedded 不重复页头） ============ -->
    <template v-else>
      <div class="ipd-req-metrics" data-testid="project-demand-metrics">
        <div
          v-for="m in projectMetrics"
          :key="m.label"
          class="ipd-req-metric"
          :class="m.tone"
        >
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
          <small>{{ m.note }}</small>
        </div>
      </div>

      <section class="ipd-req-surface">
        <div class="ipd-req-toolbar">
          <div class="ipd-req-segmented" role="group">
            <button
              v-for="s in ['all', ...STATUS_ORDER]"
              :key="s"
              :class="{ active: projectStatusFilter === s }"
              type="button"
              @click="projectStatusFilter = s"
            >
              {{ s === 'all' ? '全部' : DEMAND_STATUS_TEXT[s] }}
            </button>
          </div>
          <span>{{ visibleProjectDemands.length }} 条需求</span>
        </div>

        <div class="ipd-req-table" data-testid="project-demand-table">
          <div class="ipd-req-row head">
            <span>需求</span>
            <span>来源 / 客户</span>
            <span>优先级</span>
            <span>关联产品 / 项目</span>
            <span>负责人</span>
            <span>状态</span>
          </div>
          <div v-for="d in visibleProjectDemands" :key="d.id" class="ipd-req-row">
            <span>
              <strong>{{ d.title ?? '—' }}</strong>
              <small>提交人 {{ d.submitterName ?? '—' }}</small>
            </span>
            <span>
              <strong>{{ d.source === 'PORTAL_GUEST' ? '游客门户' : '内部' }}</strong>
              <small>{{ d.customerName ?? '未指定客户' }}</small>
            </span>
            <span>—</span>
            <span>
              <strong>{{ d.productName ?? '—' }}</strong>
              <small>{{ projectNameOf(d) || '未关联项目' }}</small>
            </span>
            <span>{{ [d.marketPmName, d.rdPmName].filter(Boolean).join(' · ') || '—' }}</span>
            <span>
              <i :class="DEMAND_STATUS_TONE[d.status]" class="ipd-req-status-pill">
                {{ DEMAND_STATUS_TEXT[d.status] ?? d.status }}
              </i>
            </span>
          </div>
          <div v-if="visibleProjectDemands.length === 0" class="ipd-req-empty">
            <div><FileTextOutlined /></div>
            <strong>当前筛选下暂无项目需求</strong>
            <p>在「产品需求」tab 将需求关联到 IPD 项目后，会按项目动作管理并集中显示在这里。</p>
          </div>
        </div>
      </section>
    </template>

    <!-- 关联项目弹窗（原型 link-project 的目标项目选择） -->
    <Modal
      v-model:open="linkModalOpen"
      :confirm-loading="linkBusy"
      ok-text="确认关联"
      title="关联 IPD 项目"
      @ok="confirmLink"
    >
      <p class="ipd-req-link-tip">
        将需求 <strong>#{{ linkTarget?.id }}</strong> 关联到具体 IPD 项目；绑定后按项目动作管理。
      </p>
      <Select
        v-model:value="linkProjectId"
        :options="linkProjectOptions"
        class="ipd-req-link-select"
        placeholder="选择目标项目"
        show-search
      />
    </Modal>
  </div>
</template>

<style scoped>
/* ============================================================================
 * 需求管理视觉对齐 —— 真值源：ZK-IPD 原型 styles.css（103-115 / 189-197 / 244 / 248-249）
 * 色板引用 ipd-theme.css 变量（--ipd-blue #245bf4 / --ipd-text / --ipd-muted / --ipd-line）
 * ============================================================================ */

/* .page-frame：28px 32px 60px，max-width 1600px 居中 */
.ipd-req {
  padding: 28px 32px 60px;
  max-width: 1600px;
  margin: auto;
}

/* .page-heading */
.ipd-req-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 24px;
}
.ipd-req-heading h1 {
  margin: 0 0 8px;
  font-size: 25px;
  letter-spacing: -0.02em;
  color: var(--ipd-text, #172033);
  font-weight: 700;
}
.ipd-req-heading p {
  margin: 0;
  color: var(--ipd-muted, #697388);
  font-size: 13px;
}

/* ZK-IPD 规则提示条 */
.ipd-req-rules {
  margin-bottom: 18px;
}

/* .section-switch（max-width 360px） */
.ipd-req-switch {
  display: flex;
  gap: 5px;
  padding: 4px;
  background: #eef1f6;
  border-radius: 8px;
  margin-bottom: 18px;
  max-width: 360px;
}
.ipd-req-switch button {
  flex: 1;
  height: 40px;
  border: 0;
  background: transparent;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-weight: 700;
  color: #667085;
  cursor: pointer;
  font-size: 13px;
}
.ipd-req-switch button.active {
  background: white;
  color: var(--ipd-blue, #245bf4);
  box-shadow: 0 2px 8px rgba(18, 32, 57, 0.1);
}

/* .metric-strip + .metric（requirement-metrics strong 25px） */
.ipd-req-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}
.ipd-req-metric {
  background: white;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
  padding: 17px 20px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 3px 10px;
}
.ipd-req-metric > span {
  color: var(--ipd-muted, #697388);
  font-size: 12px;
}
.ipd-req-metric > strong {
  grid-row: 1 / 3;
  grid-column: 2;
  font-size: 25px;
  font-variant-numeric: tabular-nums;
  color: var(--ipd-text, #172033);
}
.ipd-req-metric small {
  color: #8d96a6;
  font-size: 12px;
}
.ipd-req-metric.warning > strong {
  color: var(--ipd-amber, #c98313);
}
.ipd-req-metric.danger > strong {
  color: var(--ipd-red, #e45757);
}

/* .surface + .business-toolbar */
.ipd-req-surface {
  background: white;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
  overflow: hidden;
}
.ipd-req-toolbar {
  min-height: 58px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--ipd-line, #dfe4ed);
}
.ipd-req-toolbar > span {
  color: var(--ipd-muted, #697388);
  font-size: 12px;
}
.ipd-req-toolbar select {
  height: 34px;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 5px;
  padding: 0 9px;
  background: white;
  font-size: 12px;
  color: var(--ipd-text, #172033);
  max-width: 260px;
}

/* .segmented */
.ipd-req-segmented {
  display: inline-flex;
  padding: 3px;
  background: #eef1f5;
  border-radius: 6px;
  flex-wrap: wrap;
  gap: 2px;
}
.ipd-req-segmented button {
  border: 0;
  padding: 7px 12px;
  color: #68748a;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}
.ipd-req-segmented button.active {
  color: var(--ipd-blue, #245bf4);
  background: white;
  box-shadow: 0 1px 4px rgba(27, 42, 70, 0.12);
  font-weight: 700;
}

/* .product-demand-list article：130px | 1fr | 150px */
.ipd-req-demand-list article {
  display: grid;
  grid-template-columns: 130px 1fr 150px;
  gap: 18px;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--ipd-line, #dfe4ed);
}
.ipd-req-demand-source {
  display: grid;
  gap: 5px;
}
.ipd-req-demand-source small,
.ipd-req-demand-list article > div:nth-child(2) > small {
  color: var(--ipd-muted, #697388);
  font-size: 12px;
}
.ipd-req-demand-list article > div:nth-child(2) > small {
  display: block;
  margin-top: 4px;
}
.ipd-req-source-badge {
  width: fit-content;
  padding: 3px 6px;
  border-radius: 4px;
  background: #edf2ff;
  color: var(--ipd-blue, #245bf4);
  font-size: 10px;
  font-weight: 700;
}
.ipd-req-source-badge.guest {
  color: #905c0a;
  background: #fff3dd;
}
.ipd-req-demand-list h3 {
  margin: 0 0 7px;
  font-size: 14px;
  color: var(--ipd-text, #172033);
}
.ipd-req-demand-list p {
  margin: 0 0 8px;
  color: #566176;
  line-height: 1.55;
  font-size: 12px;
}

/* .demand-actions */
.ipd-req-demand-actions {
  display: grid;
  justify-items: start;
  gap: 7px;
}
.ipd-req-demand-actions button {
  border: 0;
  background: transparent;
  color: var(--ipd-blue, #245bf4);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}
.ipd-req-demand-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ipd-req-demand-actions .ipd-req-primary-link {
  padding: 7px 9px;
  background: var(--ipd-blue, #245bf4);
  color: white;
  border-radius: 5px;
}

/* .status-pill（色调沿用原型既有色系） */
.ipd-req-status-pill {
  display: inline-flex;
  width: fit-content;
  padding: 4px 7px;
  border-radius: 4px;
  font-style: normal;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}
.ipd-req-status-pill.amber {
  color: #9b6509;
  background: #fff4df;
}
.ipd-req-status-pill.blue {
  color: var(--ipd-blue, #245bf4);
  background: var(--ipd-blue-soft, #edf2ff);
}
.ipd-req-status-pill.green {
  color: var(--ipd-green, #2f9e52);
  background: #eaf7ed;
}
.ipd-req-status-pill.gray {
  color: #58657b;
  background: #eef1f5;
}

/* .business-table（6 列 2.3fr 1.15fr .5fr .65fr .7fr 1.15fr） */
.ipd-req-table {
  overflow-x: auto;
}
.ipd-req-row {
  min-width: 980px;
  min-height: 74px;
  display: grid;
  grid-template-columns: 2.3fr 1.15fr 0.5fr 0.9fr 0.9fr 1.15fr;
  gap: 14px;
  align-items: center;
  padding: 10px 18px;
  border-bottom: 1px solid #edf0f3;
  font-size: 11px;
  color: var(--ipd-text, #172033);
}
.ipd-req-row.head {
  min-height: 40px;
  color: var(--ipd-muted, #697388);
  background: #f7f8fa;
  font-weight: 700;
}
.ipd-req-row > span {
  min-width: 0;
}
.ipd-req-row > span:first-child,
.ipd-req-row > span:nth-child(2) {
  display: grid;
  gap: 5px;
}
.ipd-req-row small {
  color: var(--ipd-muted, #697388);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ipd-req-row > span:last-child {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

/* .empty-state */
.ipd-req-empty {
  min-height: 260px;
  display: grid;
  place-content: center;
  justify-items: center;
  text-align: center;
  color: var(--ipd-muted, #697388);
}
.ipd-req-empty > div {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  color: var(--ipd-blue, #245bf4);
  background: var(--ipd-blue-soft, #edf2ff);
  border-radius: 50%;
  font-size: 28px;
}
.ipd-req-empty strong {
  color: var(--ipd-text, #172033);
  margin: 12px 0 4px;
  font-size: 14px;
}
.ipd-req-empty p {
  margin: 0;
  max-width: 380px;
  font-size: 12px;
  line-height: 1.6;
}

.ipd-req-load-error {
  margin: 0;
  padding: 14px 20px;
  color: var(--ipd-red, #e45757);
  font-size: 12px;
}

/* 关联项目弹窗内容 */
.ipd-req-link-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--ipd-muted, #697388);
}
.ipd-req-link-tip strong {
  color: var(--ipd-text, #172033);
}
.ipd-req-link-select {
  width: 100%;
}

/* 响应式（原型 248/249 行断点） */
@media (max-width: 1050px) {
  .ipd-req-metrics {
    grid-template-columns: repeat(2, 1fr);
  }
  .ipd-req-demand-list article {
    grid-template-columns: 110px 1fr;
  }
  .ipd-req-demand-actions {
    grid-column: 2;
  }
}
@media (max-width: 760px) {
  .ipd-req {
    padding: 20px 16px 48px;
  }
  .ipd-req-demand-list article {
    grid-template-columns: 1fr;
  }
  .ipd-req-demand-actions {
    grid-column: auto;
  }
  .ipd-req-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
