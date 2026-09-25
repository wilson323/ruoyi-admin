<script setup lang="ts">
/**
 * 页29-30 共担 KPI 归集（卡 P0-10.30；后端 W4-E SharedKpiController.listShared 已交付）。
 *
 * 业务口径（BR-KPI-04 / BR-INC-04）：
 * - 共担 KPI 双 PM 各自维护一份同 revision 的归集记录；多次归集 ⇒ revision 递增追加；
 * - 状态机 DRAFT → FINALIZED；DRAFT 表示修订中的归集，FINALIZED 表示当期定稿；
 * - 综合分（comprehensiveScore）按 revision DESC 取最新条；
 * - segment 维度由后端解析（市场 PM 段 / 研发 PM 段）。
 *
 * 五态：加载 / 成功（双 PM 列表 + 关联奖金池）/ 拒绝与断网 / 空态（无归集）/ 网络异常；
 * 不展示任何模拟数据（G-06）。
 *
 * 路由：/ipd/kpi/shared?projectId=&period=
 *
 * ORPHAN-A7 增量（R212 #79/#80/#82，看板卡 670aecdf，原型页30，2026-09-25）：
 * - #79 双组长确认列表卡：GET /kpi/shared/confirms?projectId&period[&status]，
 *   K01-K04 每指标一行（PENDING/CONFIRMED/OVERDUE 筛选；OVERDUE 为读时派生态），
 *   行内 confirmedByMe 标识 + 首签/次签人时间双列。
 * - #80 月度截止配置卡：GET /kpi/shared/deadline-config（dayOfMonth/cutoffTime/version/
 *   source/configuredValue）；后端未交付 PUT 写端点，变更走系统配置管理（kpi.monthlyDeadlineDay），
 *   本页只读展示 + 如实标注。
 * - #82 确认签署：POST /kpi/shared/{id}/confirm（Popconfirm 二次确认；权限
 *   ipd:kpi-shared:confirm = GROUP_LEADER/SUPER_ADMIN，视图按 personType 闸显；
 *   同人重签/已确认行由后端 40002/STATE_CONFLICT 拒绝，错误如实透出）。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Empty,
  Popconfirm,
  Select,
  Spin,
  Table,
  Tag,
  message as antMessage,
} from 'ant-design-vue';

import {
  type SharedKpiConfirmRow,
  type SharedKpiDeadlineConfig,
  type SharedKpiRecord,
  confirmSharedKpi,
  getSharedDeadlineConfig,
  listSharedConfirms,
  listSharedKpis,
} from '../../../../api/ipd/kpi';
import {
  type BonusPool,
  listBonusPools,
} from '../../../../api/ipd/bonus';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { formatDateTime, PENDING_TEXT } from '../../_shared/format';
import {
  renderRulesDescription,
  ZK_RULE_SHARED_KPI_REVISION,
} from '../../_shared/zk-ipd-rules';

defineOptions({ name: 'IpdKpiShared', meta: { ipdCard: 'P0-10.30' } });

/** ORPHAN-A7 #82：签署权限 = ipd:kpi-shared:confirm 持有者（GROUP_LEADER / SUPER_ADMIN）。 */
const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
const canSign = computed(() => ['GROUP_LEADER', 'SUPER_ADMIN'].includes(personType.value));

const route = useRoute();
const router = useRouter();

const rules = renderRulesDescription([ZK_RULE_SHARED_KPI_REVISION]);

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const filters = reactive({
  period: defaultPeriod(),
  projectId: typeof route.query.projectId === 'string' ? String(route.query.projectId) : '',
});

const recordsData = ref<SharedKpiRecord[]>([]);
const bonusEntries = ref<BonusPool[]>([]);

const loadingRecords = ref(false);
const loadingBonus = ref(false);
const recordsError = ref('');
const bonusError = ref('');
const loaded = ref(false);

function rejectText(cause: unknown): string {
  if (cause instanceof IpdRequestError) {
    if (cause.kind === 'transport') return '无法连接服务，请检查网络后重试';
    if (cause.kind === 'cancelled') return '操作已取消，请重试';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}

const canQuery = computed(() => {
  const pid = filters.projectId;
  const period = filters.period;
  const projectOk =
    typeof pid === 'number'
      ? Number.isFinite(pid) && pid > 0
      : typeof pid === 'string' && pid.trim().length > 0;
  const periodOk = typeof period === 'string' && period.trim().length > 0;
  return projectOk && periodOk;
});

async function loadShared(): Promise<void> {
  if (!canQuery.value) return;
  loadingRecords.value = true;
  recordsError.value = '';
  try {
    recordsData.value = await listSharedKpis(String(filters.projectId), filters.period.trim());
  } catch (cause) {
    recordsData.value = [];
    recordsError.value = rejectText(cause);
  } finally {
    loadingRecords.value = false;
  }
}

async function loadBonus(): Promise<void> {
  if (!canQuery.value) {
    bonusEntries.value = [];
    return;
  }
  loadingBonus.value = true;
  bonusError.value = '';
  try {
    bonusEntries.value = await listBonusPools(String(filters.projectId));
  } catch (cause) {
    bonusEntries.value = [];
    bonusError.value = rejectText(cause);
  } finally {
    loadingBonus.value = false;
  }
}

// ===== ORPHAN-A7 #79：双组长确认列表 =====
const confirmsData = ref<SharedKpiConfirmRow[]>([]);
const confirmsLoading = ref(false);
const confirmsError = ref('');
const confirmsLoaded = ref(false);
const confirmStatusFilter = ref<undefined | string>(undefined);

const confirmStatusOptions = [
  { label: '全部状态', value: '' },
  { label: '待确认', value: 'PENDING' },
  { label: '已确认', value: 'CONFIRMED' },
  { label: '已逾期', value: 'OVERDUE' },
];

async function loadConfirms(): Promise<void> {
  if (!canQuery.value) {
    confirmsData.value = [];
    return;
  }
  confirmsLoading.value = true;
  confirmsError.value = '';
  try {
    const status = confirmStatusFilter.value ? confirmStatusFilter.value : undefined;
    confirmsData.value = await listSharedConfirms(String(filters.projectId), filters.period.trim(), status);
    confirmsLoaded.value = true;
  } catch (cause) {
    confirmsData.value = [];
    confirmsLoaded.value = true;
    confirmsError.value = rejectText(cause);
  } finally {
    confirmsLoading.value = false;
  }
}

// ===== ORPHAN-A7 #82：确认签署 =====
const signingId = ref<null | string>(null);

/** 可签署：持签署权限 + 本人未签过 + 行未完成双签（OVERDUE 仍可补签，后端语义）。 */
function canSignRow(row: SharedKpiConfirmRow): boolean {
  return canSign.value && !row.confirmedByMe && row.status !== 'CONFIRMED';
}

async function signConfirm(row: SharedKpiConfirmRow): Promise<void> {
  if (signingId.value) return;
  signingId.value = row.id;
  try {
    const result = await confirmSharedKpi(row.id);
    if (result.confirmed) {
      antMessage.success(`双签完成：${row.metricCode} 已确认`);
    } else {
      antMessage.info(`首签成功：${row.metricCode} 等待第二位组长签署`);
    }
    await loadConfirms();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    signingId.value = null;
  }
}

// ===== ORPHAN-A7 #80：月度截止配置（只读；写路径后端未交付） =====
const deadlineConfig = ref<null | SharedKpiDeadlineConfig>(null);
const deadlineLoading = ref(false);
const deadlineError = ref('');

async function loadDeadlineConfig(): Promise<void> {
  deadlineLoading.value = true;
  deadlineError.value = '';
  try {
    deadlineConfig.value = await getSharedDeadlineConfig();
  } catch (cause) {
    deadlineConfig.value = null;
    deadlineError.value = rejectText(cause);
  } finally {
    deadlineLoading.value = false;
  }
}

async function load(): Promise<void> {
  if (!canQuery.value) return;
  loaded.value = true;
  await Promise.all([loadShared(), loadBonus(), loadConfirms(), loadDeadlineConfig()]);
}

onMounted(() => {
  // 若 URL 带 projectId + period 自动加载；否则等待用户填写。
  if (canQuery.value) void load();
});

/** revision DESC 后的归集（同一项目双 PM 各 1 条同 revision）。 */
const groupedByRevision = computed(() => {
  const map = new Map<number, SharedKpiRecord[]>();
  for (const r of recordsData.value) {
    const rev = Number(r.revision ?? 0);
    const list = map.get(rev) ?? [];
    list.push(r);
    map.set(rev, list);
  }
  const revisions = Array.from(map.keys()).sort((a, b) => b - a);
  return revisions.map((rev) => ({ revision: rev, records: map.get(rev) ?? [] }));
});

const latestRevision = computed(() => groupedByRevision.value[0]?.revision ?? null);

const recordsColumns = [
  { title: '归集人角色', key: 'segment', width: 140 },
  { title: '归集人', dataIndex: 'scoredBy', key: 'scoredBy', width: 160 },
  { title: '综合分', key: 'comprehensiveScore', width: 120 },
  { title: '状态', key: 'status', width: 100 },
  { title: '归集时间', key: 'scoredAt', width: 160 },
];

const bonusColumns = [
  { title: '奖金池编号', dataIndex: 'id', key: 'id', width: 120 },
  { title: '实际回款', dataIndex: 'targetSales', key: 'targetSales', width: 130 },
  { title: '基数（5%）', dataIndex: 'basePool', key: 'basePool', width: 130 },
  { title: 'S/A/B 系数', dataIndex: 'coefficient', key: 'coefficient', width: 100 },
  { title: '阶梯系数', dataIndex: 'tierCoefficient', key: 'tierCoefficient', width: 90 },
  { title: '终算奖池', dataIndex: 'finalPool', key: 'finalPool', width: 140 },
  { title: '状态', key: 'status', width: 100 },
];

function segmentLabel(segment: null | string | undefined): string {
  if (segment === 'MARKET_PM') return '市场 PM';
  if (segment === 'RD_PM') return '研发 PM';
  return segment ?? PENDING_TEXT;
}

function statusTag(status: null | string | undefined): { color: string; text: string } {
  if (status === 'FINALIZED') return { color: 'success', text: '已定稿' };
  if (status === 'DRAFT') return { color: 'warning', text: '草稿' };
  return { color: 'default', text: status ?? PENDING_TEXT };
}

function scoreText(score: null | number | string | undefined): string {
  if (score === null || score === undefined || score === '') return PENDING_TEXT;
  return String(score);
}

/** ORPHAN-A7：确认行状态映射（PENDING=待确认 / CONFIRMED=已确认 / OVERDUE=已逾期·读时派生）。 */
function confirmStatusTag(status: null | string | undefined): { color: string; text: string } {
  if (status === 'CONFIRMED') return { color: 'success', text: '已确认' };
  if (status === 'OVERDUE') return { color: 'error', text: '已逾期' };
  if (status === 'PENDING') return { color: 'warning', text: '待确认' };
  return { color: 'default', text: status ?? PENDING_TEXT };
}

/** ORPHAN-A7：截止配置来源映射（HIGH-4.1 契约：FACTORY_DEFAULT / DB_ACTIVE / DB_INACTIVE）。 */
function deadlineSourceText(source: null | string | undefined): string {
  if (source === 'DB_ACTIVE') return '库内生效（DB_ACTIVE）';
  if (source === 'DB_INACTIVE') return '库内停用·回退默认（DB_INACTIVE）';
  if (source === 'FACTORY_DEFAULT') return '工厂默认（FACTORY_DEFAULT）';
  return source ?? PENDING_TEXT;
}

const confirmColumns = [
  { title: '指标', key: 'metric', width: 200 },
  { title: '项目', dataIndex: 'projectName', key: 'projectName', width: 160 },
  { title: '周期', dataIndex: 'period', key: 'period', width: 100 },
  { title: '权重', key: 'weight', width: 90 },
  { title: '截止时间', key: 'deadlineAt', width: 160 },
  { title: '状态', key: 'status', width: 100 },
  { title: '首签', key: 'firstSign', width: 150 },
  { title: '次签', key: 'secondSign', width: 150 },
  { title: '操作', key: 'action', width: 130 },
];

const showEmpty = computed(() => loaded.value && !loadingRecords.value && !recordsError.value && recordsData.value.length === 0);
</script>

<template>
  <div class="ipd-kpi-shared p-4">
    <Alert
      class="mb-4"
      :message="`共担 KPI 归集：后端 SharedKpiController.listShared 已交付（W4-E）—— GET /api/v1/kpi/shared?projectId&period 返回 List<KpiRecord>（按 revision DESC）。本视图承载双 PM 各自归集 + 关联奖金池 + revision 维度时间线。`"
      show-icon
      type="info"
    />

    <Card title="查询条件" class="mb-4">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">项目编号</div>
          <!-- E2E-A：禁 InputNumber（number 化致 19 位雪花截断）——string 原样输入/透传 -->
          <input
            v-model="filters.projectId"
            placeholder="如 1001，19 位雪花 ID 原样粘贴"
            class="ipd-input"
            style="width: 200px"
          />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">归集周期（YYYY-MM）</div>
          <input
            v-model="filters.period"
            placeholder="2026-09"
            class="ipd-input"
          />
        </div>
        <Button type="primary" :loading="loadingRecords || loadingBonus" :disabled="!canQuery" @click="load">查询</Button>
        <Button @click="router.replace({ path: '/ipd/kpi/shared', query: { projectId: filters.projectId, period: filters.period } })">同步 URL</Button>
      </div>
      <div class="mt-2 text-xs text-gray-500">{{ rules }}</div>
    </Card>

    <Card title="双 PM 归集（按 revision 倒序）" class="mb-4">
      <Spin v-if="loadingRecords" tip="加载中...">
        <div style="min-height: 120px"></div>
      </Spin>
      <Empty v-else-if="showEmpty" description="该期无共担 KPI 归集记录。请确认项目编号与月份；当前后端仅 W4-E 交付 GET /kpi/shared，POST 归集录入走表单专用 mutation hook（不在本页）。" />
      <template v-else>
        <div v-if="recordsError" class="mb-3">
          <Alert
            :message="'共担 KPI 加载失败'"
            :description="recordsError"
            type="error"
            show-icon
          />
        </div>
        <Descriptions :column="3" size="small" bordered class="mb-3">
          <DescriptionsItem label="归集周期">{{ filters.period }}</DescriptionsItem>
          <DescriptionsItem label="项目编号">{{ filters.projectId || PENDING_TEXT }}</DescriptionsItem>
          <DescriptionsItem label="最新 revision">{{ latestRevision ?? PENDING_TEXT }}</DescriptionsItem>
        </Descriptions>
        <div v-for="group in groupedByRevision" :key="`rev-${group.revision}`" class="mb-4">
          <div class="mb-2 flex items-center gap-2 text-sm">
            <Tag color="blue">revision {{ group.revision }}</Tag>
            <span class="text-gray-500">{{ group.records.length }} 条</span>
          </div>
          <Table
            :columns="recordsColumns"
            :data-source="group.records"
            :pagination="false"
            :row-key="(record: Record<string, any>) => String(record.id ?? '')"
            size="small"
            bordered
          >
            <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
              <template v-if="column.key === 'segment'">
                <Tag color="blue">{{ segmentLabel(record.segment) }}</Tag>
              </template>
              <template v-else-if="column.key === 'comprehensiveScore'">
                {{ scoreText(record.comprehensiveScore) }}
              </template>
              <template v-else-if="column.key === 'status'">
                <Tag :color="statusTag(record.status).color">{{ statusTag(record.status).text }}</Tag>
              </template>
              <template v-else-if="column.key === 'scoredAt'">
                {{ formatDateTime(record.scoredAt) }}
              </template>
            </template>
          </Table>
        </div>
      </template>
    </Card>

    <Card class="mb-4">
      <template #title>
        双组长确认（K01-K04）
        <span class="ml-2 text-xs text-gray-400">GET /kpi/shared/confirms</span>
      </template>
      <template #extra>
        <Select
          v-model:value="confirmStatusFilter"
          :options="confirmStatusOptions"
          style="width: 140px"
          @change="loadConfirms"
        />
      </template>
      <Spin v-if="confirmsLoading" tip="加载中...">
        <div style="min-height: 120px"></div>
      </Spin>
      <template v-else>
        <div v-if="confirmsError" class="mb-3">
          <Alert :message="'确认列表加载失败'" :description="confirmsError" type="error" show-icon />
        </div>
        <Empty
          v-else-if="confirmsLoaded && confirmsData.length === 0"
          description="该期无共担 KPI 确认行。K01-K04 确认行在归集提交（POST /kpi/shared）后自动生成 PENDING 行。"
        />
        <Table
          v-else
          :columns="confirmColumns"
          :data-source="confirmsData"
          :pagination="false"
          :row-key="(record: Record<string, any>) => String(record.id ?? '')"
          size="small"
          bordered
        >
          <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
            <template v-if="column.key === 'metric'">
              <div>{{ record.metricName || PENDING_TEXT }}</div>
              <div class="text-xs text-gray-400">{{ record.metricCode }}</div>
            </template>
            <template v-else-if="column.key === 'weight'">
              <span class="tabular-nums">{{ record.weight ?? PENDING_TEXT }}</span>
            </template>
            <template v-else-if="column.key === 'deadlineAt'">
              {{ formatDateTime(record.deadlineAt) }}
            </template>
            <template v-else-if="column.key === 'status'">
              <Tag :color="confirmStatusTag(record.status).color">{{ confirmStatusTag(record.status).text }}</Tag>
            </template>
            <template v-else-if="column.key === 'firstSign'">
              <div>{{ record.firstConfirmedBy ? '#' + record.firstConfirmedBy : PENDING_TEXT }}</div>
              <div class="text-xs text-gray-400">{{ formatDateTime(record.firstConfirmedAt) }}</div>
            </template>
            <template v-else-if="column.key === 'secondSign'">
              <div>{{ record.secondConfirmedBy ? '#' + record.secondConfirmedBy : PENDING_TEXT }}</div>
              <div class="text-xs text-gray-400">{{ formatDateTime(record.secondConfirmedAt) }}</div>
            </template>
            <template v-else-if="column.key === 'action'">
              <Popconfirm
                v-if="canSignRow(record as SharedKpiConfirmRow)"
                :title="`确认签署 ${record.metricCode}？（首签/次签按后端双签规则判定）`"
                ok-text="签署"
                cancel-text="取消"
                @confirm="signConfirm(record as SharedKpiConfirmRow)"
              >
                <Button size="small" type="primary" :loading="signingId === record.id">确认签署</Button>
              </Popconfirm>
              <Tag v-else-if="(record as SharedKpiConfirmRow).confirmedByMe" color="blue">我已签署</Tag>
              <span v-else class="text-xs text-gray-400">—</span>
            </template>
          </template>
        </Table>
      </template>
    </Card>

    <Card class="mb-4">
      <template #title>
        月度截止配置
        <span class="ml-2 text-xs text-gray-400">GET /kpi/shared/deadline-config</span>
      </template>
      <Spin v-if="deadlineLoading" tip="加载中...">
        <div style="min-height: 80px"></div>
      </Spin>
      <template v-else>
        <Alert v-if="deadlineError" :message="'截止配置加载失败'" :description="deadlineError" type="error" show-icon />
        <Descriptions v-else-if="deadlineConfig" :column="3" size="small" bordered>
          <DescriptionsItem label="截止日（次月第 N 个工作日）">{{ deadlineConfig.dayOfMonth }}</DescriptionsItem>
          <DescriptionsItem label="当前解析截止时刻">{{ formatDateTime(deadlineConfig.cutoffTime) }}</DescriptionsItem>
          <DescriptionsItem label="配置版本">{{ deadlineConfig.version }}</DescriptionsItem>
          <DescriptionsItem label="取值来源">{{ deadlineSourceText(deadlineConfig.source) }}</DescriptionsItem>
          <DescriptionsItem label="库内配置值">{{ deadlineConfig.configuredValue ?? PENDING_TEXT }}</DescriptionsItem>
          <DescriptionsItem label="写路径">
            <span class="text-xs text-gray-500">后端未交付 PUT 端点；变更走系统配置管理（kpi.monthlyDeadlineDay）</span>
          </DescriptionsItem>
        </Descriptions>
        <Empty v-else description="暂无截止配置数据" />
      </template>
    </Card>

    <Card title="关联奖金池（GET /bonus-pool/list?projectId）" class="mb-4">
      <Spin v-if="loadingBonus" tip="加载中...">
        <div style="min-height: 120px"></div>
      </Spin>
      <Empty v-else-if="!loadingBonus && bonusEntries.length === 0 && !bonusError" description="该项目当期暂无奖金池" />
      <template v-else>
        <Alert
          v-if="bonusError"
          class="mb-3"
          :message="'奖金池关联加载失败'"
          :description="bonusError"
          type="error"
          show-icon
        />
        <Table
          :columns="bonusColumns"
          :data-source="bonusEntries"
          :pagination="{ pageSize: 10, showTotal: (total: number) => `共 ${total} 条`, showSizeChanger: false }"
          :row-key="(record: Record<string, any>) => String(record.id ?? '')"
          size="small"
          bordered
        >
          <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
            <template v-if="column.key === 'status'">
              <Tag :color="record.status === 'DISTRIBUTED' ? 'success' : record.status === 'CONFIRMED' ? 'processing' : 'warning'">
                {{ record.status === 'DISTRIBUTED' ? '已发放' : record.status === 'CONFIRMED' ? '已确认' : '草稿' }}
              </Tag>
            </template>
          </template>
        </Table>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.ipd-input {
  width: 160px;
  height: 32px;
  padding: 0 11px;
  font-size: 14px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
}

/* V12-F1：移除 outline:none（全局 :focus-visible token 焦点环接管可见性）；
 * 焦点边线归一到调色板主色（原 #006be6 离板）。 */
.ipd-input:focus {
  border-color: var(--ipd-blue);
}
</style>