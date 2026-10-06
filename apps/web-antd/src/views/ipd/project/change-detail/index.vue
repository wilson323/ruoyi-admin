<script setup lang="ts">
/**
 * 页26 变更单详情（卡 P0-10.25；后端 GET /requirement-changes/{id} 已交付，P2-6.1）。
 *
 * 五态：加载 / 成功（详情 + 双签面板）/ 拒绝与断网 / 空态 / 操作反馈。
 *
 * 业务口径（BR-GATE-07；RequirementChangeController 契约 1:1 渲染）：
 * - 状态机 DRAFT → PENDING_SIGN → APPROVED/REJECTED（单方 REJECT 即整体否决）；
 * - signatures 聚合双 PM 签署（MARKET_PM/RD_PM），本视图按 JSON 解析后逐方展示；
 * - beforeSnapshot / afterSnapshot 是 JSON 字符串：合法 → 解析展示，非法 → 原文 + 「JSON 格式异常」徽章；
 * - 双签面板：DRAFT 提交按钮 / PENDING_SIGN 双 PM 各自签署 / 终态禁操作。
 *
 * 路由：/ipd/projects/:projectId/change/:changeId，由路由注入 projectId 与 changeId。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Empty,
  Input,
  Modal,
  Spin,
  Tag,
  Timeline,
  TimelineItem,
  message,
} from 'ant-design-vue';

import {
  type RequirementChange,
  type RequirementChangeStatus,
  getRequirementChange,
  signRequirementChange,
  submitRequirementChange,
} from '../../../../api/ipd/change';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { formatDateTime, PENDING_TEXT } from '../../_shared/format';
defineOptions({ name: 'IpdChangeDetail', meta: { ipdBackend: 'RequirementChangeController 已交付（P2-6.1）：GET /requirement-changes/{id}、POST /requirement-changes/{id}/submit、POST /requirement-changes/{id}/sign。', ipdCard: 'P0-10.25' } });

const route = useRoute();
const auth = useIpdAuthStore();

const changeId = computed(() => String(route.params.changeId ?? ''));

/** 状态机 label/tone —— V6 系统漂移修复：本页用 ipd-state-machines 集中查表。 */
import { CHANGE_STATUS_MACHINE, type ChangeStatus, stateLabel as stateLabelFn, stateTone as stateToneFn } from '../../_shared/ipd-state-machines';
const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  CHANGE_STATUS_MACHINE.states.map((s) => [s.code, s.label]),
);
function statusText(status: RequirementChangeStatus): string {
  if (STATUS_LABEL[status]) return STATUS_LABEL[status];
  const fallback = stateLabelFn(CHANGE_STATUS_MACHINE, status as ChangeStatus) ?? '';
  return fallback || status || PENDING_TEXT;
}
function statusTone(status: RequirementChangeStatus): string {
  const tone = stateToneFn(CHANGE_STATUS_MACHINE, status as ChangeStatus) ?? '';
  return tone || 'default';
}

const detail = ref<RequirementChange | null>(null);
const loading = ref(false);
const errorMsg = ref('');
const isNetwork = ref(false);

const actionBusy = ref(false);
const signBusy = ref(false);
const rejectBusy = ref(false);
/** D14（2026-10-06）：驳回必填意见（后端已加校验，前端先拦并收集）；通过可直接签。 */
const rejectModalOpen = ref(false);
const rejectOpinion = ref('');

function rejectText(cause: unknown): string {
  if (cause instanceof IpdRequestError) {
    if (cause.kind === 'transport') return '无法连接服务，请检查网络后重试';
    if (cause.kind === 'cancelled') return '操作已取消，请重试';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}

/** signatures JSON 解析（结构 { MARKET_PM: { decision, opinion, signedAt }, RD_PM: { ... } }）。 */
interface SignatureEntry {
  decision: 'APPROVE' | 'REJECT' | null | string;
  opinion: null | string;
  signedAt: null | string;
}
type SignatureMap = Partial<Record<'MARKET_PM' | 'RD_PM', SignatureEntry>>;

function parseSignatures(raw: null | string | undefined): SignatureMap | string {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: SignatureMap = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (key !== 'MARKET_PM' && key !== 'RD_PM') continue;
        if (!value || typeof value !== 'object') continue;
        const entry = value as Record<string, unknown>;
        out[key] = {
          decision: typeof entry.decision === 'string' ? entry.decision : null,
          opinion: typeof entry.opinion === 'string' ? entry.opinion : null,
          signedAt: typeof entry.signedAt === 'string' ? entry.signedAt : null,
        };
      }
      return out;
    }
    return raw;
  } catch {
    return raw;
  }
}

/** beforeSnapshot / afterSnapshot JSON 解析。 */
function parseSnapshot(raw: null | string | undefined): Record<string, unknown> | string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : raw;
  } catch {
    return raw;
  }
}

const signatures = computed(() => parseSignatures(detail.value?.signatures ?? null));
const beforeSnap = computed(() => parseSnapshot(detail.value?.beforeSnapshot ?? null));
const afterSnap = computed(() => parseSnapshot(detail.value?.afterSnapshot ?? null));

const canSubmit = computed(() => detail.value?.status === 'DRAFT');
const canSignApprove = computed(() => detail.value?.status === 'PENDING_SIGN');

const myPersonType = computed(() => auth.identity?.person.personType ?? '');

async function load(): Promise<void> {
  const id = changeId.value.trim();
  if (!id) {
    detail.value = null;
    errorMsg.value = '变更单编号缺失，请回到上一页重试';
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  isNetwork.value = false;
  try {
    detail.value = await getRequirementChange(id);
  } catch (cause) {
    detail.value = null;
    errorMsg.value = rejectText(cause);
    isNetwork.value = cause instanceof IpdRequestError && cause.kind === 'transport';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function onSubmit(): Promise<void> {
  if (!canSubmit.value || actionBusy.value || !detail.value) return;
  actionBusy.value = true;
  try {
    detail.value = await submitRequirementChange(detail.value.id);
    message.success('变更单已提交，等待两位负责人签署');
  } catch (cause) {
    message.error(rejectText(cause));
  } finally {
    actionBusy.value = false;
  }
}

async function doSign(decision: 'APPROVE' | 'REJECT', opinion?: string): Promise<void> {
  if (!detail.value || actionBusy.value) return;
  if (myPersonType.value !== 'MARKET_PM' && myPersonType.value !== 'RD_PM') {
    message.warning('仅市场 PM / 研发 PM 可执行签署操作');
    return;
  }
  if (decision === 'APPROVE') signBusy.value = true;
  else rejectBusy.value = true;
  try {
    detail.value = await signRequirementChange(detail.value.id, decision, opinion ?? null);
    message.success(decision === 'APPROVE' ? '已签署：通过' : '已驳回');
  } catch (cause) {
    message.error(rejectText(cause));
  } finally {
    signBusy.value = false;
    rejectBusy.value = false;
  }
}

function onSignApprove(): void {
  void doSign('APPROVE');
}

function openReject(): void {
  rejectOpinion.value = '';
  rejectModalOpen.value = true;
}

async function confirmReject(): Promise<void> {
  const opinion = rejectOpinion.value.trim();
  if (!opinion) {
    message.warning('驳回时请填写意见');
    return;
  }
  if (opinion.length > 500) {
    message.warning('意见不能超过 500 字');
    return;
  }
  rejectModalOpen.value = false;
  await doSign('REJECT', opinion);
}

const empty = computed(() => !loading.value && !errorMsg.value && !detail.value);
</script>

<template>
  <div class="ipd-change-detail p-4">
    <Alert
      class="mb-4"
      message="变更单详情：查看变更前后对比与双方签署进展。"
      show-icon
      type="info"
    />

    <Card title="变更单主体" class="mb-4">
      <Spin v-if="loading" tip="加载中..." />
      <Empty v-else-if="empty" description="请通过变更管理或需求与变更发起单据后跳转到本详情页" />
      <Alert
        v-else-if="errorMsg"
        :message="isNetwork ? '网络异常' : '加载失败'"
        :description="errorMsg"
        :type="isNetwork ? 'warning' : 'error'"
        show-icon
      >
        <template #description>
          <div class="flex flex-col items-start gap-2">
            <span>{{ errorMsg }}</span>
            <Button size="small" @click="load">重新加载</Button>
          </div>
        </template>
      </Alert>
      <template v-else-if="detail">
        <Descriptions :column="2" bordered size="small" class="mb-3">
          <DescriptionsItem label="变更单编号">#{{ detail.id }}</DescriptionsItem>
          <DescriptionsItem label="状态">
            <Tag :color="statusTone(detail.status)">{{ statusText(detail.status) }}</Tag>
          </DescriptionsItem>
          <DescriptionsItem label="项目编号">{{ detail.projectId ?? PENDING_TEXT }}</DescriptionsItem>
          <DescriptionsItem label="关联需求">{{ detail.requirementId ?? PENDING_TEXT }}</DescriptionsItem>
          <DescriptionsItem label="变更类型">{{ detail.changeType ?? PENDING_TEXT }}</DescriptionsItem>
          <!-- 2026-10-06 D13：发起人为后端 Long ID（String 序列化），按全站惯例 #ID 展示，
               不裸奔大数字；后端响应无人名快照，人名映射待后端补齐后另接 -->
          <DescriptionsItem label="发起人">{{ detail.createBy ? '#' + detail.createBy : PENDING_TEXT }}</DescriptionsItem>
          <DescriptionsItem label="发起时间">{{ formatDateTime(detail.createTime) }}</DescriptionsItem>
          <DescriptionsItem label="最近更新">{{ formatDateTime(detail.updateTime) }}</DescriptionsItem>
          <DescriptionsItem label="理由" :span="2">{{ detail.reason ?? PENDING_TEXT }}</DescriptionsItem>
        </Descriptions>

        <div class="grid gap-3 md:grid-cols-2">
          <Card size="small" title="变更前快照">
            <div v-if="beforeSnap === null" class="text-xs text-gray-500">{{ PENDING_TEXT }}</div>
            <div v-else-if="typeof beforeSnap === 'string'" class="text-xs">
              <Tag color="warning">格式异常，按原文显示</Tag>
              <pre class="mt-1 whitespace-pre-wrap text-xs">{{ beforeSnap }}</pre>
            </div>
            <pre v-else class="m-0 whitespace-pre-wrap text-xs">{{ JSON.stringify(beforeSnap, null, 2) }}</pre>
          </Card>
          <Card size="small" title="变更后快照">
            <div v-if="afterSnap === null" class="text-xs text-gray-500">{{ PENDING_TEXT }}</div>
            <div v-else-if="typeof afterSnap === 'string'" class="text-xs">
              <Tag color="warning">格式异常，按原文显示</Tag>
              <pre class="mt-1 whitespace-pre-wrap text-xs">{{ afterSnap }}</pre>
            </div>
            <pre v-else class="m-0 whitespace-pre-wrap text-xs">{{ JSON.stringify(afterSnap, null, 2) }}</pre>
          </Card>
        </div>
      </template>
    </Card>

    <Card v-if="detail" title="双签面板" class="mb-4">
      <div v-if="typeof signatures === 'string'" class="text-xs">
        <Tag color="warning">签署记录格式异常，按原文显示</Tag>
        <pre class="mt-1 whitespace-pre-wrap text-xs">{{ signatures }}</pre>
      </div>
      <div v-else class="grid gap-3 md:grid-cols-2">
        <div>
          <div class="mb-1 text-xs text-gray-500">市场 PM 签署</div>
          <Tag v-if="signatures.MARKET_PM?.decision === 'APPROVE'" color="success">通过</Tag>
          <Tag v-else-if="signatures.MARKET_PM?.decision === 'REJECT'" color="error">驳回</Tag>
          <Tag v-else color="default">待签署</Tag>
          <div v-if="signatures.MARKET_PM?.opinion" class="mt-1 text-xs">意见：{{ signatures.MARKET_PM.opinion }}</div>
          <div v-if="signatures.MARKET_PM?.signedAt" class="mt-1 text-xs text-gray-500">时间：{{ formatDateTime(signatures.MARKET_PM.signedAt) }}</div>
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">研发 PM 签署</div>
          <Tag v-if="signatures.RD_PM?.decision === 'APPROVE'" color="success">通过</Tag>
          <Tag v-else-if="signatures.RD_PM?.decision === 'REJECT'" color="error">驳回</Tag>
          <Tag v-else color="default">待签署</Tag>
          <div v-if="signatures.RD_PM?.opinion" class="mt-1 text-xs">意见：{{ signatures.RD_PM.opinion }}</div>
          <div v-if="signatures.RD_PM?.signedAt" class="mt-1 text-xs text-gray-500">时间：{{ formatDateTime(signatures.RD_PM.signedAt) }}</div>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <Button
          v-if="canSubmit"
          type="primary"
          :loading="actionBusy"
          :disabled="actionBusy"
          @click="onSubmit"
        >提交签署</Button>
        <template v-else-if="canSignApprove">
          <Button
            type="primary"
            :loading="signBusy"
            :disabled="signBusy || rejectBusy"
            @click="onSignApprove"
          >签署：通过</Button>
          <Button
            danger
            :loading="rejectBusy"
            :disabled="signBusy || rejectBusy"
            @click="openReject"
          >驳回</Button>
        </template>
        <Tag v-else color="default">已结束，不可再操作</Tag>
      </div>
    </Card>

    <!-- D14：驳回必填意见 -->
    <Modal
      v-model:open="rejectModalOpen"
      title="驳回需求变更单"
      ok-text="确认驳回"
      cancel-text="取消"
      @ok="confirmReject"
    >
      <Input.TextArea
        v-model:value="rejectOpinion"
        :auto-size="{ minRows: 3, maxRows: 6 }"
        :maxlength="500"
        show-count
        placeholder="请填写驳回原因（必填）"
      />
    </Modal>

    <Card v-if="detail" title="状态机轨迹" class="mb-4">
      <Timeline>
        <TimelineItem>
          <div class="text-sm">草稿（发起）</div>
          <div class="text-xs text-gray-500">{{ formatDateTime(detail.createTime) }}</div>
        </TimelineItem>
        <TimelineItem :color="(typeof signatures === 'object' && (signatures.MARKET_PM || signatures.RD_PM)) ? 'blue' : 'gray'">
          <div class="text-sm">待签署（双方负责人）</div>
          <div class="text-xs text-gray-500">任一方驳回即整体驳回；双方都通过才算通过</div>
        </TimelineItem>
        <TimelineItem :color="detail.status === 'APPROVED' ? 'green' : 'gray'">
          <div class="text-sm">已通过</div>
          <div class="text-xs text-gray-500">{{ detail.status === 'APPROVED' ? formatDateTime(detail.updateTime) : '待双方签署通过' }}</div>
        </TimelineItem>
        <TimelineItem :color="detail.status === 'REJECTED' ? 'red' : 'gray'">
          <div class="text-sm">已驳回</div>
          <div class="text-xs text-gray-500">{{ detail.status === 'REJECTED' ? formatDateTime(detail.updateTime) : '任一方驳回即生效' }}</div>
        </TimelineItem>
      </Timeline>
    </Card>

  </div>
</template>