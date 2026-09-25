<script setup lang="ts">
/**
 * 人员同步任务管理页（R215 GAP-F7；卡 e9721c5c，PersonSyncController 5 端点全接）。
 *
 * 权限分级（后端代码内 require*，无注解码 → 前端零权限码登记）：
 * - 任务全量表 / 仅看异常 / 批量回补：仅 SUPER_ADMIN（GET /jobs :82、GET /jobs/abnormal :90、
 *   POST /jobs/retry-all :71 三处 requireAdmin）；
 * - 提交任务 / 单任务重试：SUPER_ADMIN + GROUP_LEADER（:53/:62 requireLeaderOrAdmin）；
 *   组长无列表读口 → 提供「按任务 ID 直接重试」入口（jobId 来自提交响应回执）。
 *
 * 落点裁决（准备包）：新建独立子页，不在 identity-sync 页加 Tab（该页无 Tabs 骨架且与 F3 撞车）。
 * ID/Instant 全 string 透传（api/ipd/person-sync.ts 归一），本视图不做任何数值化与日期运算。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  message,
  Switch,
  Table,
  Tag,
} from 'ant-design-vue';

import { IpdRequestError } from '../../../../api/ipd/auth';
import {
  type SyncJob,
  listAbnormalSyncJobs,
  listSyncJobs,
  retryAllSyncJobs,
  retrySyncJob,
  submitSyncJob,
} from '../../../../api/ipd/person-sync';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { PENDING_TEXT } from '../../_shared/format';
import '../../_shared/ipd-theme.css';

defineOptions({ name: 'IpdAdminPersonSync', meta: { ipdCard: 'R215-GAP-F7' } });

const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
const isSuperAdmin = computed(() => personType.value === 'SUPER_ADMIN');
const isLeader = computed(() => personType.value === 'GROUP_LEADER');

// ipd-error-text 的 domain 联合类型无 'person_sync'（该文件禁改），走通用码表 + fallback 通道
function rejectText(cause: unknown): string {
  return ipdErrorText(cause, { fallback: cause instanceof IpdRequestError ? cause.message : '操作失败，请稍后重试' });
}

// ---------- 任务状态显示（未知枚举值原样透传，与 api 层值域守卫同口径） ----------
const SYNC_STATUS_TEXT: Record<string, string> = {
  FAILED: '失败',
  PENDING: '待执行',
  RETRYING: '重试中',
  SUCCESS: '成功',
};
const SYNC_STATUS_COLOR: Record<string, string> = {
  FAILED: 'red',
  PENDING: 'orange',
  RETRYING: 'blue',
  SUCCESS: 'green',
};
function statusText(status: string): string {
  return SYNC_STATUS_TEXT[status] ?? status;
}
function statusColor(status: string): string {
  return SYNC_STATUS_COLOR[status] ?? 'default';
}

// ---------- 任务列表（仅超管；onMounted 一次 + 手动刷新，禁轮询） ----------
const jobs = ref<SyncJob[]>([]);
const listLoading = ref(false);
const listError = ref('');
const abnormalOnly = ref(false);
const rowRetryingId = ref('');

const columns = [
  { title: '任务 ID', dataIndex: 'jobId', key: 'jobId', width: 200 },
  { title: '工号', dataIndex: 'employeeNo', key: 'employeeNo', width: 170 },
  { title: '状态', key: 'status', width: 110 },
  { title: '尝试次数', key: 'attempts', width: 110 },
  { title: '异常分类', key: 'failureKind', width: 120 },
  { title: '失败原因', dataIndex: 'failureReason', key: 'failureReason', width: 200 },
  { title: '下次重试', dataIndex: 'nextRetryAt', key: 'nextRetryAt', width: 190 },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 190 },
  { title: '操作', key: 'action', width: 100 },
];

async function loadJobs(): Promise<void> {
  if (!isSuperAdmin.value) return;
  listLoading.value = true;
  listError.value = '';
  try {
    jobs.value = abnormalOnly.value ? await listAbnormalSyncJobs() : await listSyncJobs();
  } catch (cause) {
    jobs.value = [];
    listError.value = rejectText(cause);
  } finally {
    listLoading.value = false;
  }
}

function onAbnormalChange(checked: unknown): void {
  abnormalOnly.value = checked === true;
  loadJobs().catch(() => { /* 错误已进 listError 呈现 */ });
}

onMounted(() => {
  loadJobs().catch(() => { /* 错误已进 listError 呈现 */ });
});

// ---------- 行重试（仅 FAILED 行显示；组长/超管均可调，后端守卫非 FAILED → STATE_CONFLICT） ----------
async function doRetry(jobId: string): Promise<void> {
  if (rowRetryingId.value) return; // UI 防抖（幂等语义可连点，但避免双 loading 态）
  rowRetryingId.value = jobId;
  try {
    const job = await retrySyncJob(jobId);
    message.success(`任务 ${job.jobId} 已触发重试（当前 ${statusText(job.status)}）`);
    await loadJobs();
  } catch (cause) {
    message.error(rejectText(cause));
  } finally {
    rowRetryingId.value = '';
  }
}

// ---------- 批量回补（仅 SUPER_ADMIN，后端 :71 requireAdmin） ----------
const retryAllLoading = ref(false);
async function doRetryAll(): Promise<void> {
  if (retryAllLoading.value) return;
  retryAllLoading.value = true;
  try {
    const r = await retryAllSyncJobs();
    message.success(`批量回补完成：重试 ${r.retried} · 成功 ${r.succeeded} · 失败 ${r.failed} · 跳过 ${r.skipped}`);
    await loadJobs();
  } catch (cause) {
    message.error(rejectText(cause));
  } finally {
    retryAllLoading.value = false;
  }
}

// ---------- 提交同步任务（超管+组长共用；idempotencyKey 自动 ui-<ts> 防连点重复建任务） ----------
const submitForm = reactive({ employeeNo: '', idempotencyKey: '' });
const submitLoading = ref(false);
const submitError = ref('');
const submitResult = ref('');

async function doSubmit(): Promise<void> {
  submitError.value = '';
  submitResult.value = '';
  const employeeNo = submitForm.employeeNo.trim();
  if (!employeeNo) {
    submitError.value = '工号为必填（后端 @NotBlank）';
    return;
  }
  submitLoading.value = true;
  try {
    const key = submitForm.idempotencyKey.trim() || `ui-${Date.now()}`;
    const r = await submitSyncJob(employeeNo, key);
    submitResult.value = `任务已提交：${r.jobId}（状态 ${statusText(r.status)}）`;
    submitForm.employeeNo = '';
    submitForm.idempotencyKey = '';
    if (isSuperAdmin.value) await loadJobs();
  } catch (cause) {
    submitError.value = rejectText(cause);
  } finally {
    submitLoading.value = false;
  }
}

// ---------- 组长直连重试（组长无列表读口，用提交回执的 jobId 手动重试） ----------
const leaderRetryId = ref('');
const leaderRetryError = ref('');
async function doLeaderRetry(): Promise<void> {
  leaderRetryError.value = '';
  const jobId = leaderRetryId.value.trim();
  if (!jobId) {
    leaderRetryError.value = '请填写任务 ID（提交回执中的 sync-… 串）';
    return;
  }
  try {
    await doRetry(jobId);
  } catch {
    leaderRetryError.value = '重试失败，详见提示';
  }
}
</script>

<template>
  <div class="ipd-person-sync p-4">
    <Alert
      class="mb-4"
      type="info"
      show-icon
      message="人员同步任务管理（AC-USER-11/12）：任务三态 + 指数退避重试（最多 3 次）+ 异常项批量回补。列表/异常/批量回补仅超管；提交与单任务重试组长可用。"
    />

    <!-- 提交同步任务：超管 + 组长 -->
    <Card class="mb-4" title="提交同步任务（超管 / 组长）" :body-style="{ paddingBottom: '8px' }">
      <div class="mb-2 flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">工号（必填）</div>
          <Input v-model:value="submitForm.employeeNo" :maxlength="64" style="width: 220px" placeholder="如 E001 / 雪花工号按文本提交" />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">幂等键（选填，留空自动生成 ui-&lt;ts&gt; 防连点）</div>
          <Input v-model:value="submitForm.idempotencyKey" :maxlength="64" style="width: 260px" placeholder="同键重放返原任务不新建" />
        </div>
        <Button type="primary" :loading="submitLoading" @click="doSubmit">提交</Button>
      </div>
      <Alert v-if="submitError" class="mb-2" :message="submitError" type="error" show-icon role="alert" />
      <Alert v-if="submitResult" class="mb-2" :message="submitResult" type="success" show-icon />
    </Card>

    <!-- 组长视图：无列表读口（GET /jobs 仅超管），给直连重试入口 -->
    <Card v-if="isLeader" title="单任务重试（组长：粘贴提交回执中的任务 ID）">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">任务 ID（sync-&lt;uuid8&gt;-&lt;seq&gt;，原样文本）</div>
          <Input v-model:value="leaderRetryId" :maxlength="80" style="width: 300px" placeholder="如 sync-ab12cd34-7" />
        </div>
        <Button :disabled="!leaderRetryId.trim()" @click="doLeaderRetry">重试</Button>
      </div>
      <Alert v-if="leaderRetryError" class="mt-2" :message="leaderRetryError" type="error" show-icon role="alert" />
      <p class="mt-2 text-xs text-gray-400">任务全量表与批量回补为超管专属（后端 requireAdmin），组长页内如实隐藏。</p>
    </Card>

    <!-- 超管视图：任务全量表 + 异常切换 + 批量回补 -->
    <Card v-if="isSuperAdmin" title="同步任务列表">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <Button :loading="listLoading" @click="loadJobs">刷新</Button>
        <span class="flex items-center gap-2 text-sm">
          仅看异常（FAILED）
          <Switch :checked="abnormalOnly" @change="onAbnormalChange" />
        </span>
        <Button danger :loading="retryAllLoading" @click="doRetryAll">批量回补</Button>
      </div>
      <Alert v-if="listError" class="mb-3" :message="listError" type="error" show-icon role="alert" />
      <Table
        :columns="columns"
        :data-source="jobs"
        :loading="listLoading"
        :pagination="{ pageSize: 20, showSizeChanger: true }"
        row-key="jobId"
        size="small"
        bordered
        :scroll="{ x: 1280 }"
      >
        <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
          <template v-if="column.key === 'status'">
            <Tag :color="statusColor(String(record.status))">{{ statusText(String(record.status)) }}</Tag>
          </template>
          <template v-else-if="column.key === 'attempts'">
            {{ record.attempts }} / {{ record.maxAttempts }}
          </template>
          <template v-else-if="column.key === 'failureKind'">
            <span v-if="record.failureKind">{{ record.failureKind }}</span>
            <span v-else class="text-gray-400">{{ PENDING_TEXT }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <!-- 后端守卫：仅 FAILED 可手动重试（service :143-154），其余行不给按钮 -->
            <Button
              v-if="record.status === 'FAILED'"
              size="small"
              :loading="rowRetryingId === record.jobId"
              :disabled="rowRetryingId !== '' && rowRetryingId !== record.jobId"
              @click="doRetry(String(record.jobId))"
            >
              重试
            </Button>
          </template>
          <template v-else-if="column.key === 'nextRetryAt' || column.key === 'createdAt'">
            <span class="font-mono text-xs">{{ record[column.key as string] ?? PENDING_TEXT }}</span>
          </template>
        </template>
        <template #emptyText>
          <Empty :image="Empty.PRESENTED_IMAGE_SIMPLE" description="暂无同步任务" />
        </template>
      </Table>
    </Card>
  </div>
</template>
