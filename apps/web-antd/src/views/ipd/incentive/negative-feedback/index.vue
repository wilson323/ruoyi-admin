<script setup lang="ts">
/**
 * 页36 负反馈执行（卡 P0-10.36；后端 NegativeFeedbackController 已交付）。
 * 规则：主责停发 / 连带减半 / 双 PM 共同担责；主责/连带映射由 triggerType 服务端推导。
 * 2026-09-08 契约对齐：查询改 GET /negative-feedbacks?projectId=&status=
 * （projectId 必填；原 /list 会被后端 {id} 路由捕获转 Long 失败 → 500）。
 */
import { computed, ref } from 'vue';
import { Alert, Button, Card, Empty, Input, Modal, Select, Table, Tag } from 'ant-design-vue';

import {
  type NegativeExecution,
  type NegativeFeedback,
  type NegativeStatus,
  type NegativeTriggerType,
  decideNegativeFeedback,
  liftNegativeFeedback,
  listNegativeFeedback,
  submitNegativeFeedback,
} from '../../../../api/ipd/negative-feedback';
import { ipdErrorText } from '../../_shared/ipd-error-text';

defineOptions({ name: 'IpdNegativeFeedback', meta: { ipdCard: 'P0-10.36' } });

const projectId = ref('');
const status = ref<'' | NegativeStatus>('');
const items = ref<NegativeFeedback[]>([]);
const loading = ref(false);
const errorMsg = ref('');
const loaded = ref(false);

const triggerText: Record<NegativeTriggerType, string> = {
  QUALITY_ACCIDENT: '质量事故',
  MISSED_MARKET_WINDOW: '错过市场窗口',
  REWORK_EXCEEDED: '需求返工率超标',
  SPEC_PILE_COPY: '参数堆砌/对标抄袭',
};

const triggerColor: Record<NegativeTriggerType, string> = {
  QUALITY_ACCIDENT: 'red',
  MISSED_MARKET_WINDOW: 'magenta',
  REWORK_EXCEEDED: 'orange',
  SPEC_PILE_COPY: 'volcano',
};

const statusText: Record<NegativeStatus, string> = {
  DRAFT: '草稿',
  EXECUTED: '已执行',
  LIFTED: '已解除',
  PENDING_DECISION: '待认定',
  REJECTED: '已驳回',
};

const statusColor: Record<NegativeStatus, string> = {
  DRAFT: 'default',
  EXECUTED: 'red',
  LIFTED: 'green',
  PENDING_DECISION: 'processing',
  REJECTED: 'warning',
};

const executionText: Record<NegativeExecution, string> = {
  HALVE_ALLOWANCE: '减半',
  STOP_ALLOWANCE: '停发',
};

const statusOptions = (Object.keys(statusText) as NegativeStatus[]).map((value) => ({
  label: statusText[value],
  value,
}));

const columns = [
  { title: '编号', dataIndex: 'id', key: 'id', width: 150 },
  { title: '项目', dataIndex: 'projectId', key: 'projectId', width: 150 },
  { title: '触发类型', key: 'triggerType', width: 140 },
  { title: '主责（执行动作）', key: 'main', width: 150 },
  { title: '连带（执行动作）', key: 'related', width: 150 },
  { title: '触发月', dataIndex: 'triggerMonth', key: 'triggerMonth', width: 100 },
  { title: '恢复月', dataIndex: 'recoveryMonth', key: 'recoveryMonth', width: 100 },
  { title: '奖金资格', key: 'bonus', width: 90 },
  { title: '状态', key: 'status', width: 100 },
  { title: '操作', key: 'actions', width: 170 },
];

function executionTag(execution: null | string): string {
  const value = execution as NegativeExecution | null;
  return value ? (executionText[value] ?? value) : '—';
}

async function load(): Promise<void> {
  const pid = projectId.value.trim();
  if (!pid || loading.value) return;
  loading.value = true;
  errorMsg.value = '';
  try {
    items.value = await listNegativeFeedback(pid, status.value || undefined);
    loaded.value = true;
  } catch (cause) {
    items.value = [];
    errorMsg.value = ipdErrorText(cause, { fallback: '负反馈列表加载失败' });
  } finally {
    loading.value = false;
  }
}

const isEmpty = computed(() => loaded.value && !errorMsg.value && items.value.length === 0);

// ---------- P0-5 补齐：状态机操作（submit / decide / lift） ----------

const actingId = ref('');

function fail(text: string, cause: unknown): void {
  errorMsg.value = ipdErrorText(cause, { fallback: text });
}

/** Table bodyCell 的 record 不做类型收窄：在此收敛断言（与 project/list openDetail 同模式）。 */
function asFeedback(record: Record<string, any>): NegativeFeedback {
  return record as unknown as NegativeFeedback;
}

async function submitAction(rawRecord: Record<string, any>): Promise<void> {
  const record = asFeedback(rawRecord);
  if (actingId.value) return;
  actingId.value = String(record.id ?? '');
  try {
    await submitNegativeFeedback(String(record.id ?? ''));
    await load();
  } catch (cause) {
    fail('提交认定失败', cause);
  } finally {
    actingId.value = '';
  }
}

/** 组长认定：Modal 双按钮（确定=认定执行扣减，取消=驳回）。 */
function decideAction(rawRecord: Record<string, any>): void {
  const record = asFeedback(rawRecord);
  Modal.confirm({
    title: '组长认定',
    content: `对负反馈 ${record.triggerMonth ?? ''}（${triggerText[record.triggerType as NegativeTriggerType] ?? record.triggerType}）做认定：确定=执行扣减，取消=驳回？`,
    okText: '认定执行扣减',
    cancelText: '驳回',
    onOk: async () => {
      try {
        await decideNegativeFeedback(String(record.id ?? ''), 'APPROVE');
        await load();
      } catch (cause) {
        fail('认定失败', cause);
      }
    },
    onCancel: async () => {
      try {
        await decideNegativeFeedback(String(record.id ?? ''), 'REJECT');
        await load();
      } catch (cause) {
        fail('驳回失败', cause);
      }
    },
  });
}

/** 解除：恢复津贴 + 奖金资格（EXECUTED → LIFTED）。 */
async function liftAction(rawRecord: Record<string, any>): Promise<void> {
  const record = asFeedback(rawRecord);
  if (actingId.value) return;
  actingId.value = String(record.id ?? '');
  try {
    await liftNegativeFeedback(String(record.id ?? ''));
    await load();
  } catch (cause) {
    fail('解除失败', cause);
  } finally {
    actingId.value = '';
  }
}
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="负反馈：主责停发 / 连带减半 / 双 PM 共同担责（错过市场窗口无主次之分）；重复事件不重复扣减；录入与认定操作走待办/超管入口。"
      show-icon
      type="info"
    />

    <Card class="mb-4" title="过滤条件（项目编号必填）">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">项目编号（必填）</div>
          <Input v-model:value="projectId" placeholder="按项目过滤" style="width: 220px" />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">状态（可选）</div>
          <Select
            v-model:value="status"
            :options="statusOptions"
            allow-clear
            placeholder="全部状态"
            style="width: 160px"
          />
        </div>
        <button class="primary-button" :disabled="!projectId.trim() || loading" type="button" @click="load">
          查询负反馈
        </button>
      </div>
    </Card>

    <Card title="负反馈列表">
      <Table
        :columns="columns"
        :data-source="items"
        :loading="loading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'triggerType'">
            <Tag :color="triggerColor[record.triggerType as NegativeTriggerType]">
              {{ triggerText[record.triggerType as NegativeTriggerType] ?? record.triggerType }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'main'">
            {{ record.mainPersonId ?? '—' }}（{{ executionTag(record.mainExecution) }}）
          </template>
          <template v-else-if="column.key === 'related'">
            {{ record.relatedPersonId ?? '—' }}（{{ executionTag(record.relatedExecution) }}）
          </template>
          <template v-else-if="column.key === 'recoveryMonth'">{{ record.recoveryMonth ?? '—' }}</template>
          <template v-else-if="column.key === 'bonus'">
            <Tag :color="record.bonusDisqualify ? 'red' : 'green'">
              {{ record.bonusDisqualify ? '取消资格' : '保留' }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="statusColor[record.status as NegativeStatus]">
              {{ statusText[record.status as NegativeStatus] ?? record.status }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'actions'">
            <template v-if="record.status === 'DRAFT'">
              <Button size="small" type="link" :loading="actingId === String(record.id ?? '')" @click="submitAction(record)">
                提交认定
              </Button>
            </template>
            <template v-else-if="record.status === 'PENDING_DECISION'">
              <Button size="small" type="link" @click="decideAction(record)">认定 / 驳回</Button>
            </template>
            <template v-else-if="record.status === 'EXECUTED'">
              <Button size="small" type="link" :loading="actingId === String(record.id ?? '')" @click="liftAction(record)">
                解除
              </Button>
            </template>
            <span v-else>—</span>
          </template>
        </template>
        <template #emptyText>
          <Empty :description="errorMsg || (isEmpty ? '当前过滤条件下无负反馈记录' : '请输入项目编号后查询')" />
        </template>
      </Table>
    </Card>
  </div>
</template>

<style scoped>
.primary-button {
  min-height: 38px;
  padding: 0 16px;
  font-weight: 700;
  color: white;
  cursor: pointer;
  background: var(--ipd-blue);
  border: 0;
  border-radius: 6px;
}

.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
