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
  InputNumber,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';

import {
  type SharedKpiRecord,
  listSharedKpis,
} from '../../../../api/ipd/kpi';
import {
  type BonusPool,
  listBonusPools,
} from '../../../../api/ipd/bonus';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { formatDateTime, PENDING_TEXT } from '../../_shared/format';
import {
  renderRulesDescription,
  ZK_RULE_SHARED_KPI_REVISION,
} from '../../_shared/zk-ipd-rules';

defineOptions({ name: 'IpdKpiShared', meta: { ipdCard: 'P0-10.30' } });

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

const canQuery = computed(() => filters.projectId.trim() !== '' && filters.period.trim() !== '');

async function loadShared(): Promise<void> {
  if (!canQuery.value) return;
  loadingRecords.value = true;
  recordsError.value = '';
  try {
    recordsData.value = await listSharedKpis(Number(filters.projectId), filters.period.trim());
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
    bonusEntries.value = await listBonusPools(filters.projectId.trim());
  } catch (cause) {
    bonusEntries.value = [];
    bonusError.value = rejectText(cause);
  } finally {
    loadingBonus.value = false;
  }
}

async function load(): Promise<void> {
  if (!canQuery.value) return;
  loaded.value = true;
  await Promise.all([loadShared(), loadBonus()]);
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
  { title: '周期', dataIndex: 'period', key: 'period', width: 90 },
  { title: '项目等级', key: 'projectLevel', width: 100 },
  { title: '实际回款', key: 'receiptAmounts', width: 130 },
  { title: '基数（5%）', key: 'basePool', width: 130 },
  { title: '系数', key: 'coefficient', width: 90 },
  { title: '终算奖池', key: 'finalPool', width: 140 },
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
          <InputNumber
            v-model:value="filters.projectId"
            placeholder="如 1001"
            style="width: 200px"
            :min="1"
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
            <template v-if="column.key === 'projectLevel'">
              <Tag color="default">{{ record.projectLevel ?? PENDING_TEXT }}</Tag>
            </template>
            <template v-else-if="column.key === 'status'">
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