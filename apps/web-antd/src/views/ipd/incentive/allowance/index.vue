<script setup lang="ts">
/**
 * 页33 津贴台账（卡 P0-10.33；W4-D AllowanceLedgerController 3 端点已交付）。
 *
 * 端点（实测 W4-D AllowanceLedgerController）：
 *   GET  /api/v1/allowance/ledger          —— 津贴快照（listAllowances）
 *   GET  /api/v1/allowance/pending-stop    —— 待停发清单（getAllowancePendingStop）
 *   POST /api/v1/allowance/auto-scan       —— 月度自动扫描（仅超管；autoScanAllowance）
 *
 * 业务规则（BR-INC-02/03；后端 AllowanceLedgerService / AllowanceService）：
 *   L1~L5 基数 × 绑定项目数，封顶 2 倍（ZK-IPD §三.1.2）；
 *   综合分 < 60 当月停发（STOP_SCORE_BELOW_60 / SCORE_BELOW_60；ZK-IPD §三.1.5）；
 *   附加项目连续 60 天无产出 ⇒ 待确认停发单（STOP_NO_OUTPUT_60_DAYS / NO_OUTPUT_60_DAYS；
 *   ZK-IPD §三.1.4 仅提醒，主项目无产出不触发）。
 *
 * 类型适配说明（D-补强落定前）：
 *   后端 domain AllowanceLedger 字段：id / personId / projectId / month / lockedLevel /
 *   baseAmount / finalAmount / capApplied / stopReason / stopStartDate / createTime。
 *   api/ipd/allowance.ts AllowanceLedger 接口命名（period / level / amount / capReached /
 *   status / projectCount / projectIds）与后端不符，本视图以本文件 AllowanceLedgerRow
 *   本地 type 接 W4-D 后端真实字段；DTO 全面对齐留 D-补强单独任务（owner 决策 status 字段
 *   语义后落地）。
 */
import { computed, onMounted, ref } from 'vue';
import { Alert, Button, Card, Empty, Input, Table, Tag, message } from 'ant-design-vue';

import {
  getAllowancePendingStop,
  listAllowances,
} from '../../../../api/ipd/allowance';
import { ipdPost } from '../../../../api/ipd/http';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { formatDateTime, formatMoney } from '../../_shared/format';
import {
  renderRulesDescription,
  ZK_RULE_ALLOWANCE_CAP,
  ZK_RULE_LONG_NO_OUTPUT_ALERT,
  ZK_RULE_SCORE_BELOW_60_STOP,
} from '../../_shared/zk-ipd-rules';

defineOptions({
  name: 'IpdAllowance',
  meta: {
    ipdBackend: 'AllowanceLedgerController 已交付（W4-D）：GET /allowance/ledger、GET /allowance/pending-stop、POST /allowance/auto-scan（仅超管）。',
    ipdCard: 'P0-10.33',
  },
});

/** W4-D 后端 AllowanceLedgerController 真实字段本地 type（D-补强前适配）。 */
interface AllowanceLedgerRow {
  baseAmount: null | number | string;
  capApplied: null | string;
  createTime: null | string;
  finalAmount: null | number | string;
  id: null | number | string;
  lockedLevel: null | string;
  month: null | string;
  personId: null | number | string;
  projectId: null | number | string;
  stopReason: null | string;
}

const rulesDescription = renderRulesDescription([
  ZK_RULE_ALLOWANCE_CAP,
  ZK_RULE_SCORE_BELOW_60_STOP,
  ZK_RULE_LONG_NO_OUTPUT_ALERT,
]);

const auth = useIpdAuthStore();
const isSuperAdmin = computed(() => auth.identity?.person?.personType === 'SUPER_ADMIN');

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const period = ref(defaultPeriod());
const personId = ref('');
const projectId = ref('');

const ledgerItems = ref<AllowanceLedgerRow[]>([]);
const pendingItems = ref<AllowanceLedgerRow[]>([]);

const ledgerLoading = ref(false);
const pendingLoading = ref(false);
const scanning = ref(false);

const ledgerErrorMsg = ref('');
const pendingErrorMsg = ref('');
const loaded = ref(false);

const canQuery = computed(() => period.value.trim() !== '');

const STOP_REASON_TEXT: Record<string, { color: string; text: string }> = {
  NO_OUTPUT_60_DAYS: { color: 'warning', text: '60 天无产出（待确认）' },
  SCORE_BELOW_60: { color: 'error', text: '综合分 < 60（停发）' },
  STOP_NO_OUTPUT_60_DAYS: { color: 'warning', text: '60 天无产出（停发）' },
  STOP_SCORE_BELOW_60: { color: 'error', text: '综合分 < 60（停发）' },
};

function stopReasonMeta(reason: null | string | undefined): { color: string; text: string } {
  if (!reason) return { color: 'success', text: '正常发放' };
  return STOP_REASON_TEXT[reason] ?? { color: 'default', text: reason };
}

function capAppliedText(value: null | string | undefined): string {
  return value === '1' ? '已触发' : '未触发';
}

async function loadLedger(): Promise<void> {
  if (!canQuery.value || ledgerLoading.value) return;
  ledgerLoading.value = true;
  ledgerErrorMsg.value = '';
  try {
    const data = (await listAllowances(
      period.value.trim(),
      personId.value.trim() || undefined,
    )) as unknown as AllowanceLedgerRow[];
    ledgerItems.value = Array.isArray(data) ? data : [];
    loaded.value = true;
  } catch (cause) {
    ledgerItems.value = [];
    ledgerErrorMsg.value = ipdErrorText(cause, { fallback: '津贴台账加载失败' });
  } finally {
    ledgerLoading.value = false;
  }
}

async function loadPending(): Promise<void> {
  if (!canQuery.value || pendingLoading.value) return;
  pendingLoading.value = true;
  pendingErrorMsg.value = '';
  try {
    const data = (await getAllowancePendingStop(
      period.value.trim(),
    )) as unknown as AllowanceLedgerRow[];
    pendingItems.value = Array.isArray(data) ? data : [];
  } catch (cause) {
    pendingItems.value = [];
    pendingErrorMsg.value = ipdErrorText(cause, { fallback: '待停发清单加载失败' });
  } finally {
    pendingLoading.value = false;
  }
}

async function loadAll(): Promise<void> {
  await Promise.all([loadLedger(), loadPending()]);
}

async function onAutoScan(): Promise<void> {
  if (!canQuery.value || scanning.value || !isSuperAdmin.value) return;
  scanning.value = true;
  try {
    await ipdPost('/allowance/auto-scan', undefined, { period: period.value.trim(), projectId: projectId.value.trim() || undefined });
    message.success(`已触发 ${period.value.trim()} 月度津贴自动扫描`);
    await loadAll();
  } catch (cause) {
    message.error(ipdErrorText(cause, { fallback: '自动扫描失败' }));
  } finally {
    scanning.value = false;
  }
}

const ledgerColumns = [
  { title: '人员', dataIndex: 'personId', key: 'personId', width: 100 },
  { title: '项目', dataIndex: 'projectId', key: 'projectId', width: 100 },
  { title: '月份', dataIndex: 'month', key: 'month', width: 90 },
  { title: '锁定评级', dataIndex: 'lockedLevel', key: 'lockedLevel', width: 100 },
  { title: '基数', key: 'baseAmount', width: 130 },
  { title: '终额', key: 'finalAmount', width: 140 },
  { title: '封顶', key: 'capApplied', width: 100 },
  { title: '停发原因', key: 'stopReason', width: 160 },
  { title: '生成时间', key: 'createTime', width: 160 },
];

const pendingColumns = [
  { title: '人员', dataIndex: 'personId', key: 'personId', width: 100 },
  { title: '项目', dataIndex: 'projectId', key: 'projectId', width: 100 },
  { title: '月份', dataIndex: 'month', key: 'month', width: 90 },
  { title: '锁定评级', dataIndex: 'lockedLevel', key: 'lockedLevel', width: 100 },
  { title: '停发原因', key: 'stopReason', width: 200 },
  { title: '生成时间', key: 'createTime', width: 160 },
];

const ledgerEmpty = computed(
  () => loaded.value && !ledgerErrorMsg.value && ledgerItems.value.length === 0,
);
const pendingEmpty = computed(
  () => loaded.value && !pendingErrorMsg.value && pendingItems.value.length === 0,
);

onMounted(() => {
  void loadAll();
});
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      :message="`津贴台账口径：L1~L5 基数 × 绑定项目数（封顶 2 倍）；综合分 < 60 当月停发；附加项目连续 60 天无产出 ⇒ 待确认停发单。${rulesDescription}`"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="查询与扫描">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">核算月份（YYYY-MM）</div>
          <Input
            v-model:value="period"
            placeholder="2026-09"
            style="width: 140px"
          />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">人员编号（可选）</div>
          <Input
            v-model:value="personId"
            placeholder="按权限范围过滤"
            style="width: 180px"
          />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">项目编号（可选，仅自动扫描使用）</div>
          <Input
            v-model:value="projectId"
            placeholder="触发扫描时限定项目"
            style="width: 200px"
          />
        </div>
        <Button
          type="primary"
          :disabled="!canQuery"
          :loading="ledgerLoading || pendingLoading"
          @click="loadAll"
        >
          查询
        </Button>
        <Button
          v-if="isSuperAdmin"
          danger
          :disabled="!canQuery"
          :loading="scanning"
          @click="onAutoScan"
        >
          触发月度自动扫描（仅超管）
        </Button>
        <span v-else class="text-muted-foreground text-xs">
          自动扫描仅超级管理员可见
        </span>
      </div>
    </Card>

    <Card class="mb-4" title="① 津贴台账列表（GET /allowance/ledger）">
      <Table
        :columns="ledgerColumns"
        :data-source="ledgerItems"
        :loading="ledgerLoading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'baseAmount'">¥ {{ formatMoney(record.baseAmount) }}</template>
          <template v-else-if="column.key === 'finalAmount'">
            <strong class="text-primary">¥ {{ formatMoney(record.finalAmount) }}</strong>
          </template>
          <template v-else-if="column.key === 'capApplied'">
            <Tag :color="record.capApplied === '1' ? 'warning' : 'default'">
              {{ capAppliedText(record.capApplied) }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'stopReason'">
            <Tag :color="stopReasonMeta(record.stopReason).color">
              {{ stopReasonMeta(record.stopReason).text }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
        </template>
        <template #emptyText>
          <Empty :description="ledgerErrorMsg || (ledgerEmpty ? '当前月份暂无津贴记录' : '加载中…')" />
        </template>
      </Table>
    </Card>

    <Card title="② 待停发清单（GET /allowance/pending-stop）">
      <Table
        :columns="pendingColumns"
        :data-source="pendingItems"
        :loading="pendingLoading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'stopReason'">
            <Tag :color="stopReasonMeta(record.stopReason).color">
              {{ stopReasonMeta(record.stopReason).text }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
        </template>
        <template #emptyText>
          <Empty :description="pendingErrorMsg || (pendingEmpty ? '当前月份无待停发人员' : '加载中…')" />
        </template>
      </Table>
    </Card>
  </div>
</template>