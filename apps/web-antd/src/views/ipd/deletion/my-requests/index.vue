<script setup lang="ts">
/**
 * 页04 删除审核-我的申请。
 * G-02：全站任何「删除」入口统一收敛到本页发起两级审核，不做即时删除。
 * BR-DEL-04：申请人 24 小时内、未终态可撤回。
 *
 * <p>P1-1（R25 真白屏修复）：原实现两处需手填申请 ID（提交结果回显 + 撤回），
 * 真白屏下用户无法自纠。本版本引入「我的申请列表」Table：
 * <ul>
 *   <li>每行展示申请编号、状态、对象、提交时间、组长初审截止、超管终审截止</li>
 *   <li>未终态且在 24h 窗口内的行 → 行内「撤回」按钮；其余行仅展示状态</li>
 *   <li>提交新申请成功后自动 reload 列表，无需手填</li>
 * </ul>
 * 撤回申请 Input 仍保留作为兜底（防止列表为空或极端场景）。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Input,
  Popconfirm,
  Select,
  SelectOption,
  Table,
  Textarea,
  message,
} from 'ant-design-vue';

import {
  DELETION_ENTITY_TYPES,
  listMyDeletionRequests,
  submitDeletionRequest,
  withinWithdrawWindow,
  withdrawDeletionRequest,
  type DeletionEntityType,
  type DeletionRequest,
} from '../../../../api/ipd/deletion';
import { formatDateTime } from '../../_shared/format';
import { DELETION_STATUS_TEXT } from '../../_shared/ipd-enums';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';

const route = useRoute() as unknown as { query?: Record<string, unknown> } | undefined;

/** G-02：项目概览等删除入口携 query 预填（entityType/entityId），非法值回落默认。 */
function prefilledEntityType(): DeletionEntityType {
  const q = String(route?.query?.entityType ?? '');
  return DELETION_ENTITY_TYPES.some((item) => item.value === q) ? (q as DeletionEntityType) : 'projects';
}

const form = reactive({
  entityType: prefilledEntityType(),
  entityId: String(route?.query?.entityId ?? ''),
  reason: '',
  snapshot: '',
});
const reasonTooShort = computed(() => form.reason.trim().length > 0 && form.reason.trim().length < 6);
const canSubmit = computed(() => form.entityId.trim() !== '' && form.reason.trim().length >= 6);
const submitting = ref(false);
const lastResult = ref<DeletionRequest | null>(null);

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  try {
    lastResult.value = await submitDeletionRequest({
      entityType: form.entityType,
      entityId: form.entityId.trim(),
      reason: form.reason.trim(),
      snapshot: form.snapshot.trim() || undefined,
    });
    message.success('删除申请已提交，进入组长初审（2 个工作日）');
    form.entityId = '';
    form.reason = '';
    form.snapshot = '';
    await loadMyRequests();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '提交失败，请稍后重试');
  } finally {
    submitting.value = false;
  }
}

/**
 * P1-1：「我的申请」列表（服务端按当前会话人 ID 权威过滤）。
 * <p>设计：onMounted 自动加载；提交新申请后、撤回成功后都 reload，避免脏读。
 */
const myRequests = ref<DeletionRequest[]>([]);
const listLoading = ref(false);
const withdrawingId = ref<string>('');

async function loadMyRequests() {
  listLoading.value = true;
  try {
    myRequests.value = await listMyDeletionRequests();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '加载我的申请失败');
  } finally {
    listLoading.value = false;
  }
}

onMounted(loadMyRequests);

/** P1-1：行内「撤回」按钮的可用性——24h 窗口内、未终态。 */
function canWithdrawRow(row: DeletionRequest): boolean {
  if (!row.status) return false;
  // 终态：DELETED / REJECTED / WITHDRAWN
  if (row.status === 'DELETED' || row.status === 'REJECTED' || row.status === 'WITHDRAWN') return false;
  return withinWithdrawWindow(row.createTime);
}

async function withdrawRow(row: DeletionRequest | string) {
  // P1-1：table bodyCell 的 record 类型为 Record<string, any>，
  // 函数同时支持 DeletionRequest 全文与仅 id 字符串两种入参，避免泛型不匹配。
  const id = typeof row === 'string' ? row : String(row.id ?? '');
  if (!id || withdrawingId.value) return;
  withdrawingId.value = id;
  try {
    const updated = await withdrawDeletionRequest(id);
    message.success('申请已撤回');
    // 乐观更新本地行：状态置 WITHDRAWN，避免重新请求
    const idx = myRequests.value.findIndex((it) => String(it.id) === id);
    if (idx >= 0) myRequests.value[idx] = updated;
    await loadMyRequests();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '撤回失败');
  } finally {
    withdrawingId.value = '';
  }
}

/** P1-1：兜底手填撤回（兼容列表为空 / 极端场景）。 */
const withdrawId = ref('');
const withdrawing = ref(false);
async function withdrawManual() {
  const id = withdrawId.value.trim();
  if (!id || withdrawing.value) return;
  withdrawing.value = true;
  try {
    const updated = await withdrawDeletionRequest(id);
    message.success('申请已撤回');
    // P1-1：把撤回结果同步到 lastResult 便于「最近一次申请结果」卡片回显，
    // 兼容原 index.test.ts 对 lastResult 文本的断言。
    lastResult.value = updated;
    withdrawId.value = '';
    const idx = myRequests.value.findIndex((it) => String(it.id) === id);
    if (idx >= 0) myRequests.value[idx] = updated;
    await loadMyRequests();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '撤回失败');
  } finally {
    withdrawing.value = false;
  }
}

const myRequestColumns = [
  { title: '申请编号', dataIndex: 'id', key: 'id', width: 150 },
  { title: '状态', key: 'status', width: 110 },
  { title: '删除对象', key: 'entity', width: 160 },
  { title: '原因', dataIndex: 'reason', key: 'reason', ellipsis: true },
  { title: '提交时间', key: 'createTime', width: 160 },
  { title: '组长截止', key: 'leaderDueAt', width: 160 },
  { title: '超管截止', key: 'adminDueAt', width: 160 },
  { title: '操作', key: 'actions', width: 110 },
];
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      message="全站任何「删除」入口都统一走删除申请两级审核（组长初审 → 超管终审），不做即时删除；申请人可在提交后 24 小时内撤回。「我的申请」列表已接入后端查询，可直接行内撤回。"
      show-icon
      type="info"
    />

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="发起删除申请">
        <div class="flex flex-col gap-4">
          <div>
            <div class="mb-1 text-sm">删除对象类型</div>
            <Select v-model:value="form.entityType" class="w-full">
              <SelectOption v-for="item in DELETION_ENTITY_TYPES" :key="item.value" :value="item.value">
                {{ item.label }}
              </SelectOption>
            </Select>
          </div>
          <div>
            <div class="mb-1 text-sm">对象 ID</div>
            <Input v-model:value="form.entityId" placeholder="待删除实体的 ID" />
          </div>
          <div>
            <div class="mb-1 text-sm">删除原因（至少 6 个字符）</div>
            <Textarea v-model:value="form.reason" :rows="3" placeholder="说明删除原因，供两级审核参考" />
            <div v-if="reasonTooShort" class="text-destructive mt-1 text-xs">删除原因至少 6 个字符</div>
          </div>
          <div>
            <div class="mb-1 text-sm">补充说明（可选）</div>
            <Textarea v-model:value="form.snapshot" :rows="2" placeholder="替代资料、快照说明等补充信息" />
          </div>
          <Button danger :disabled="!canSubmit" :loading="submitting" type="primary" v-access:code="IPD_PERMISSION_CODES.DELETION_REQUEST_SUBMIT" @click="submit">
            发起删除申请
          </Button>
        </div>
      </Card>

      <div class="flex flex-col gap-4">
        <!-- P1-1：我的申请列表（替换手填编号） -->
        <Card title="我的申请">
          <Table
            :columns="myRequestColumns"
            :data-source="myRequests"
            :loading="listLoading"
            :pagination="{ pageSize: 10, showSizeChanger: false }"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                {{ DELETION_STATUS_TEXT[(record as DeletionRequest).status] ?? (record as DeletionRequest).status }}
              </template>
              <template v-else-if="column.key === 'entity'">
                {{ (record as DeletionRequest).entityType }} / {{ (record as DeletionRequest).entityId }}
              </template>
              <template v-else-if="column.key === 'createTime'">{{ formatDateTime((record as DeletionRequest).createTime) }}</template>
              <template v-else-if="column.key === 'leaderDueAt'">{{ formatDateTime((record as DeletionRequest).leaderDueAt) }}</template>
              <template v-else-if="column.key === 'adminDueAt'">{{ formatDateTime((record as DeletionRequest).adminDueAt) }}</template>
              <template v-else-if="column.key === 'actions'">
                <Popconfirm
                  v-if="canWithdrawRow(record as DeletionRequest)"
                  title="撤回后无法恢复，确认执行？"
                  ok-text="确认撤回"
                  ok-type="danger"
                  cancel-text="取消"
                  @confirm="withdrawRow(record as DeletionRequest)"
                >
                  <Button :loading="withdrawingId === (record as DeletionRequest).id" danger size="small" type="link">撤回</Button>
                </Popconfirm>
                <span v-else class="text-muted-foreground text-xs">—</span>
              </template>
            </template>
          </Table>
        </Card>

        <Card title="按编号撤回（兜底）">
          <div class="flex flex-col gap-4">
            <Alert message="仅申请人本人、提交后 24 小时内且未终态的申请可撤回（BR-DEL-04）。列表为空或找不到时可使用此兜底入口。" show-icon type="warning" />
            <div class="flex gap-2">
              <Input v-model:value="withdrawId" placeholder="申请编号" />
              <Button :disabled="withdrawId.trim() === ''" :loading="withdrawing" @click="withdrawManual">撤回</Button>
            </div>
          </div>
        </Card>

        <Card v-if="lastResult" title="最近一次申请结果">
          <Descriptions bordered :column="1" size="small">
            <DescriptionsItem label="申请编号">{{ lastResult.id }}</DescriptionsItem>
            <DescriptionsItem label="状态">
              {{ DELETION_STATUS_TEXT[lastResult.status] ?? lastResult.status }}
            </DescriptionsItem>
            <DescriptionsItem label="删除对象">{{ lastResult.entityType }} / {{ lastResult.entityId }}</DescriptionsItem>
            <DescriptionsItem label="提交时间">{{ formatDateTime(lastResult.createTime) }}</DescriptionsItem>
            <DescriptionsItem label="组长初审截止">{{ formatDateTime(lastResult.leaderDueAt) }}</DescriptionsItem>
            <DescriptionsItem label="超管终审截止">{{ formatDateTime(lastResult.adminDueAt) }}</DescriptionsItem>
            <DescriptionsItem label="撤回窗口">
              {{ lastResult.status === 'WITHDRAWN' ? '已撤回' : (withinWithdrawWindow(lastResult.createTime) ? '24 小时内可撤回' : '已超出撤回窗口') }}
            </DescriptionsItem>
          </Descriptions>
        </Card>
      </div>
    </div>
  </div>
</template>
