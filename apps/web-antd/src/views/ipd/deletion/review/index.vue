<script setup lang="ts">
/**
 * 页05 删除审核-待我审核。
 * 组长初审 → 超管终审，各 2 个工作日（BR-DEL-04）；超管另有组长超期升级与超期终审清单工具（AC-DEL-07）。
 * G-02：权限不足不隐藏入口——普通 PM 展示禁用态与原因。
 *
 * <p>P1-1（R25 真白屏修复）：原实现按申请编号决策（手填 ID），真白屏无法自纠。
 * 本版本引入「待我审核列表」Table：
 * <ul>
 *   <li>每行展示申请编号、状态、对象、原因、提交时间、期限</li>
 *   <li>点击行 → 选中填到决策 id（自动同步）</li>
 *   <li>未审批的行 → 行内「通过 / 驳回」按钮（Popconfirm 二级确认）</li>
 *   <li>已审批的行 → 仅展示状态，无行内操作</li>
 * </ul>
 * 申请编号 Input 仍保留作为兜底入口（防止列表为空或极端场景）。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Input,
  Popconfirm,
  RadioButton,
  RadioGroup,
  Table,
  Textarea,
  Tooltip,
  message,
} from 'ant-design-vue';

import {
  adminDecideDeletion,
  escalateOverdueLeaderReview,
  leaderDecideDeletion,
  listDeletionReviewQueue,
  listOverdueAdminReview,
  type DeletionRequest,
} from '../../../../api/ipd/deletion';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { formatDateTime } from '../../_shared/format';
import { DELETION_STATUS_TEXT } from '../../_shared/ipd-enums';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';

const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
const isLeader = computed(() => personType.value === 'GROUP_LEADER');
const isAdmin = computed(() => personType.value === 'SUPER_ADMIN');
const canDecide = computed(() => isLeader.value || isAdmin.value);
const decisionTitle = computed(() => (isLeader.value ? '组长初审' : '超管终审'));

const decision = reactive({ id: '', approve: true, opinion: '' });
const deciding = ref(false);
const lastResult = ref<DeletionRequest | null>(null);

async function submitDecision() {
  const id = decision.id.trim();
  if (!id || deciding.value) return;
  deciding.value = true;
  try {
    const opinion = decision.opinion.trim() || undefined;
    lastResult.value = isLeader.value
      ? await leaderDecideDeletion(id, decision.approve, opinion)
      : await adminDecideDeletion(id, decision.approve, opinion);
    message.success(decision.approve ? '已通过' : '已驳回');
    decision.id = '';
    decision.opinion = '';
    await loadReviewQueue();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败，请稍后重试');
  } finally {
    deciding.value = false;
  }
}

const escalating = ref(false);
async function escalate() {
  if (escalating.value) return;
  escalating.value = true;
  try {
    const { escalated } = await escalateOverdueLeaderReview();
    message.success(`已将 ${escalated} 条组长初审超期申请升级至超管终审`);
    await loadOverdue();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '升级失败');
  } finally {
    escalating.value = false;
  }
}

const overdue = ref<DeletionRequest[]>([]);
const overdueLoading = ref(false);
async function loadOverdue() {
  if (!isAdmin.value) return;
  overdueLoading.value = true;
  try {
    overdue.value = await listOverdueAdminReview();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '加载超期清单失败');
  } finally {
    overdueLoading.value = false;
  }
}

/**
 * P1-1：「待我审核」列表（服务端按当前会话人角色分流）。
 * <ul>
 *   <li>组长 → LEADER_REVIEW（待初审）</li>
 *   <li>超管 → ADMIN_REVIEW（待终审）</li>
 *   <li>其他内部角色 → 空集</li>
 * </ul>
 */
const reviewQueue = ref<DeletionRequest[]>([]);
const queueLoading = ref(false);
const decidingRowId = ref<string>('');

async function loadReviewQueue() {
  if (!canDecide.value) {
    reviewQueue.value = [];
    return;
  }
  queueLoading.value = true;
  try {
    reviewQueue.value = await listDeletionReviewQueue();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '加载待我审核列表失败');
  } finally {
    queueLoading.value = false;
  }
}

/** P1-1：行内「通过/驳回」直发，不需经手填表单。 */
async function decideRow(row: DeletionRequest | string, approve: boolean) {
  // P1-1：table bodyCell 的 record 类型为 Record<string, any>，
  // 函数同时支持 DeletionRequest 全文与仅 id 字符串两种入参。
  const id = typeof row === 'string' ? row : String(row.id ?? '');
  if (!id || decidingRowId.value) return;
  decidingRowId.value = id;
  try {
    const updated = isLeader.value
      ? await leaderDecideDeletion(id, approve)
      : await adminDecideDeletion(id, approve);
    lastResult.value = updated;
    message.success(approve ? '已通过' : '已驳回');
    // 乐观更新：被审批的申请从队列中移除（状态转 ADMIN_REVIEW / REJECTED / DELETED，不再属于待我审核）
    reviewQueue.value = reviewQueue.value.filter((it) => String(it.id) !== id);
    await loadReviewQueue();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败，请稍后重试');
  } finally {
    decidingRowId.value = '';
  }
}

onMounted(() => {
  loadOverdue();
  loadReviewQueue();
});

const overdueColumns = [
  { title: '申请编号', dataIndex: 'id', key: 'id' },
  { title: '删除对象', key: 'entity' },
  { title: '原因', dataIndex: 'reason', key: 'reason', ellipsis: true },
  { title: '状态', key: 'status' },
  { title: '终审截止', key: 'adminDueAt' },
  { title: '申请时间', key: 'createTime' },
];

const reviewColumns = [
  { title: '申请编号', dataIndex: 'id', key: 'id', width: 150 },
  { title: '删除对象', key: 'entity', width: 160 },
  { title: '原因', dataIndex: 'reason', key: 'reason', ellipsis: true },
  { title: '提交时间', key: 'createTime', width: 160 },
  { title: '期限', key: 'dueAt', width: 160 },
  { title: '操作', key: 'actions', width: 180 },
];
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="组长初审、超管终审各 2 个工作日；组长超期未审可由超管一键升级。「待我审核」列表已接入后端查询，可行内直接通过/驳回，无需手填申请编号。"
      show-icon
      type="info"
    />

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card :title="decisionTitle">
        <Tooltip v-if="!canDecide" title="删除初审由产品组长负责、终审由超级管理员负责（BR-ORG-06）">
          <div class="flex flex-col gap-4 opacity-50">
            <Alert message="当前角色无删除审核权限" show-icon type="warning" />
            <Input disabled placeholder="申请编号" />
            <Button disabled type="primary">提交审核意见</Button>
          </div>
        </Tooltip>
        <div v-else class="flex flex-col gap-4">
          <div>
            <div class="mb-1 text-sm">申请编号（点击列表行可自动填入）</div>
            <Input v-model:value="decision.id" placeholder="待审核的删除申请编号" />
          </div>
          <div>
            <div class="mb-1 text-sm">审核意见</div>
            <RadioGroup v-model:value="decision.approve">
              <RadioButton :value="true">通过</RadioButton>
              <RadioButton :value="false">驳回</RadioButton>
            </RadioGroup>
            <div v-if="isLeader && decision.approve" class="text-muted-foreground mt-1 text-xs">
              通过后将进入超级管理员终审（AC-DEL-02）。
            </div>
            <div v-if="isAdmin && decision.approve" class="text-destructive mt-1 text-xs">
              终审通过将原子软删目标对象，请谨慎操作。
            </div>
          </div>
          <div>
            <div class="mb-1 text-sm">意见说明（驳回时建议填写）</div>
            <Textarea v-model:value="decision.opinion" :rows="3" placeholder="审核意见，随申请记录与审计留存" />
          </div>
          <Button :disabled="decision.id.trim() === ''" :loading="deciding" type="primary" v-access:code="[IPD_PERMISSION_CODES.DELETION_REQUEST_LEADER, IPD_PERMISSION_CODES.DELETION_REQUEST_ADMIN]" @click="submitDecision">
            提交审核意见
          </Button>
        </div>
      </Card>

      <div class="flex flex-col gap-4">
        <!-- P1-1：待我审核列表（替换手填编号） -->
        <Card :title="isLeader ? '待我初审' : '待我终审'">
          <Table
            :columns="reviewColumns"
            :data-source="reviewQueue"
            :loading="queueLoading"
            :pagination="{ pageSize: 10, showSizeChanger: false }"
            :row-class-name="(record) => String(record.id) === decision.id ? 'ipd-row-selected' : ''"
            row-key="id"
            size="small"
            @row-click="(record) => (decision.id = String(record.id))"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'entity'">
                {{ (record as DeletionRequest).entityType }} / {{ (record as DeletionRequest).entityId }}
              </template>
              <template v-else-if="column.key === 'createTime'">{{ formatDateTime((record as DeletionRequest).createTime) }}</template>
              <template v-else-if="column.key === 'dueAt'">
                {{ formatDateTime(isLeader ? (record as DeletionRequest).leaderDueAt : (record as DeletionRequest).adminDueAt) }}
              </template>
              <template v-else-if="column.key === 'actions'">
                <Popconfirm
                  v-access:code="isLeader ? IPD_PERMISSION_CODES.DELETION_REQUEST_LEADER : IPD_PERMISSION_CODES.DELETION_REQUEST_ADMIN"
                  :title="isLeader ? '组长初审通过后进入超管终审（AC-DEL-02），确认执行？' : '终审通过将原子软删目标对象（AC-DEL-02），确认执行？'"
                  ok-text="确认通过"
                  ok-type="primary"
                  cancel-text="取消"
                  @confirm="decideRow(record as DeletionRequest, true)"
                >
                  <Button :loading="decidingRowId === (record as DeletionRequest).id" size="small" type="link">通过</Button>
                </Popconfirm>
                <Popconfirm
                  v-access:code="isLeader ? IPD_PERMISSION_CODES.DELETION_REQUEST_LEADER : IPD_PERMISSION_CODES.DELETION_REQUEST_ADMIN"
                  title="驳回后申请转为终态（REJECTED），不可恢复，确认执行？"
                  ok-text="确认驳回"
                  ok-type="danger"
                  cancel-text="取消"
                  @confirm="decideRow(record as DeletionRequest, false)"
                >
                  <Button :loading="decidingRowId === (record as DeletionRequest).id" danger size="small" type="link">驳回</Button>
                </Popconfirm>
              </template>
            </template>
          </Table>
        </Card>

        <Card v-if="lastResult" title="最近一次审核结果">
          <Descriptions bordered :column="1" size="small">
            <DescriptionsItem label="申请编号">{{ lastResult.id }}</DescriptionsItem>
            <DescriptionsItem label="状态">
              {{ DELETION_STATUS_TEXT[lastResult.status] ?? lastResult.status }}
            </DescriptionsItem>
            <DescriptionsItem label="删除对象">{{ lastResult.entityType }} / {{ lastResult.entityId }}</DescriptionsItem>
            <DescriptionsItem label="执行时间">{{ formatDateTime(lastResult.executedAt) }}</DescriptionsItem>
          </Descriptions>
        </Card>

        <Card v-if="isAdmin" title="超期工具（仅超管）">
          <div class="mb-3 flex items-center justify-between">
            <span class="text-sm">将组长初审超期（2 个工作日）的申请一键升级至超管终审（AC-DEL-07，幂等）</span>
            <Button :loading="escalating" v-access:code="IPD_PERMISSION_CODES.DELETION_REQUEST_ADMIN" @click="escalate">升级超期申请</Button>
          </div>
          <div class="mb-2 text-sm font-medium">超管终审超期清单（{{ overdue.length }} 条）</div>
          <Table
            :columns="overdueColumns"
            :data-source="overdue"
            :loading="overdueLoading"
            :pagination="false"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'entity'">{{ record.entityType }} / {{ record.entityId }}</template>
              <template v-else-if="column.key === 'status'">
                {{ DELETION_STATUS_TEXT[record.status] ?? record.status }}
              </template>
              <template v-else-if="column.key === 'adminDueAt'">{{ formatDateTime(record.adminDueAt) }}</template>
              <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
            </template>
          </Table>
        </Card>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* P1-1：选中的待审行高亮，强化"点行 → 自动填到决策"的视觉反馈 */
:deep(.ipd-row-selected) td {
  background-color: rgb(var(--primary) / 0.08);
}
</style>
