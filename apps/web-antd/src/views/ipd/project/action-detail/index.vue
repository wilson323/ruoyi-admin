<script setup lang="ts">
/**
 * 页12/13 动作详情（卡 P0-10.12/13；同一组件按 depth 分形态）。
 *  - DEEP（深管）：状态流转 + 关键字段 + 交付物登记 + 阻断性动作徽标；
 *  - LIGHT（轻管）：BR-IPD-04 严格三字段卡（status / actualDoneAt / remark），
 *    无附件上传入口（G-10）。
 *
 * 路由：/ipd/projects/:projectId/actions/:actionId
 *
 * 真值：StageActionController。
 * - 后端无 GET /{id} 单查，按 projectId 全量列表后客户端筛 id。
 * - 状态流转唯一入口 POST /{id}/transit；不接受 PATCH status 字段（P1-4.3）。
 * - 字段录入（actualDoneAt/FAR/FRR/certNo/certPassedAt/algoType）走 POST /{id}/fields，
 *   严禁携带 status。
 * - 并发由乐观锁拦截：50002。
 * - D11 FAR+FRR ≤ 1.000000（后端 40001）。
 * - V02 certNo 格式 ^[A-Za-z0-9\-/]+$（后端 10001）。
 * - P10/V02 阻断性动作：/transit?target=DONE 前 /fields 必须含 certNo+certPassedAt；不通过则 40001。
 */
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  message,
} from 'ant-design-vue';

import type {
  ActionDeliverableRow,
  StageAction,
  StageActionFieldsBody,
  StageActionStatus,
} from '../../../../api/ipd/stage-action';
import {
  acceptStageAction,
  uploadStageActionDeliverable,
  aiExecuteStageAction,
  listActionDeliverables,
  listStageActions,
  recordStageActionFields,
  transitStageAction,
} from '../../../../api/ipd/stage-action';
import { ipdDownload } from '../../../../api/ipd/http';
import type { IpdContentViewPayload } from '../../_shared/ipd-content-view/ipd-content-view';
import IpdContentView from '../../_shared/ipd-content-view/ipd-content-view.vue';
import { registerCopilotPageContext, stageActionIdText } from '../../../../api/ipd/ai-copilot';
import { isTransportError, ipdErrorText } from '../../_shared/ipd-error-text';
import {
  actionStatusColor,
  actionStatusText,
  algoText,
  blockingBadge,
  depthColor,
  depthText,
  historyMarkText,
  projectDateTimeText,
} from '../project-display';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';
import { roleText } from '../../_shared/ipd-enums';

const route = useRoute();
const router = useRouter();

const projectId = computed(() => String(route.params.projectId ?? ''));
const actionId = computed(() => String(route.params.actionId ?? ''));

/** 带上当前项目和动作，打开项目智能体。不在本页另开一条发送。 */
function openInProjectAgent(): void {
  const code = action.value?.actionCode;
  if (!code || !projectId.value) return;
  void router.push({
    path: '/ipd/ai-assistant',
    query: { actionCode: code, projectId: projectId.value },
  });
}

const loading = ref(false);
const loadError = ref<unknown>(null);
const action = ref<StageAction | null>(null);

/** 区分 IpdRequestError / 普通 Error：业务拒绝走 ipdErrorText（domain: 'project'），本地判定走原 message。 */
const loadErrorText = computed(() => {
  if (!loadError.value) return '';
  if (isTransportError(loadError.value)) return '无法连接服务，请检查网络后重试';
  if (loadError.value instanceof Error && !(loadError.value as { kind?: string }).kind) {
    return loadError.value.message || '动作详情加载失败，请稍后重试';
  }
  return ipdErrorText(loadError.value, { domain: 'project', fallback: '动作详情加载失败，请稍后重试' });
});

const statusOptions: Array<{ label: string; value: StageActionStatus }> = [
  { label: '未开始', value: 'NOT_STARTED' },
  { label: '进行中', value: 'IN_PROGRESS' },
  { label: '已完成', value: 'DONE' },
  { label: '已逾期', value: 'DELAYED' },
  { label: '不适用', value: 'NA' },
];

/** 轻管可选状态（无 DELAYED；DONE 需先 fields 写 actualDoneAt）。 */
const lightStatusOptions: Array<{ label: string; value: StageActionStatus }> = [
  { label: '未开始', value: 'NOT_STARTED' },
  { label: '进行中', value: 'IN_PROGRESS' },
  { label: '已完成', value: 'DONE' },
  { label: '不适用', value: 'NA' },
];

const isDeep = computed(() => action.value?.depth === 'DEEP');
const isLight = computed(() => action.value?.depth === 'LIGHT');
const isBlocking = computed(() => blockingBadge(action.value?.isBlocking ?? null) !== '');
const isHistoricalMissing = computed(() => action.value?.historyMark === 'HISTORICAL_MISSING');

interface FieldsState {
  actualDoneAt: null | number;
  algoType: string;
  certNo: string;
  certPassedAt: null | number;
  farValue: null | number;
  frrValue: null | number;
  remark: string;
}

const fields = reactive<FieldsState>({
  actualDoneAt: null,
  algoType: '',
  certNo: '',
  certPassedAt: null,
  farValue: null,
  frrValue: null,
  remark: '',
});

/** 深管动态字段（D11/Z01：FAR/FRR；P10/V02：certNo/certPassedAt）。 */
const needsFarFrr = computed(() => ['D11', 'Z01'].includes(action.value?.actionCode ?? ''));

/** DatePicker 收 dayjs 对象、InputNumber 不收 null：与 FieldsState（时间戳/number|null）双向适配。 */
const actualDoneAtModel = computed<Dayjs | string | undefined>({
  get: () => (fields.actualDoneAt == null ? undefined : dayjs(fields.actualDoneAt)),
  set: (value) => {
    fields.actualDoneAt = dayjs.isDayjs(value) ? value.valueOf() : null;
  },
});
const certPassedAtModel = computed<Dayjs | string | undefined>({
  get: () => (fields.certPassedAt == null ? undefined : dayjs(fields.certPassedAt)),
  set: (value) => {
    fields.certPassedAt = dayjs.isDayjs(value) ? value.valueOf() : null;
  },
});
const farValueModel = computed<number | string | undefined>({
  get: () => (fields.farValue == null ? undefined : fields.farValue),
  set: (value) => {
    fields.farValue = value == null || value === '' ? null : Number(value);
  },
});
const frrValueModel = computed<number | string | undefined>({
  get: () => (fields.frrValue == null ? undefined : fields.frrValue),
  set: (value) => {
    fields.frrValue = value == null || value === '' ? null : Number(value);
  },
});
const needsCert = computed(() => ['P10', 'V02'].includes(action.value?.actionCode ?? ''));
const needsAlgoType = computed(() => ['D11', 'Z01', 'D08', 'Z02'].includes(action.value?.actionCode ?? ''));

/** 业务校验：FAR+FRR ≤ 1.000000（后端 40001 同源）。 */
const farFrrValid = computed(() => {
  if (!needsFarFrr.value) return true;
  if (fields.farValue === null || fields.frrValue === null) return false;
  return Number(fields.farValue) + Number(fields.frrValue) <= 1.000001;
});

const busyAction = ref<'' | 'accept' | 'aiExecute' | 'saveFields' | 'transit'>('');
const submitError = ref<unknown>(null);

const transitReasonModalOpen = ref(false);
const pendingTarget = ref<StageActionStatus>('');
const transitReason = ref('');

/** D11/Z01：FAR/FRR 例外字段；非例外动作不展示。 */
const showFarFrr = computed(() => needsFarFrr.value);

/** V02/P10：certNo/certPassedAt 例外字段；非例外动作不展示。 */
const showCert = computed(() => needsCert.value);

/** 深管交付物：POST /deliverables/upload 由服务端登记 ossId。 */
const deliverableModalOpen = ref(false);
const deliverableFile = ref<File | null>(null);

/** 文档预览 G3（2026-10-08）：已上传交付物只读列表 + 统一预览查看/下载。 */
const deliverableRows = ref<ActionDeliverableRow[]>([]);
const deliverablesLoading = ref(false);
const deliverablesError = ref('');
const deliverableViewOpen = ref(false);
const deliverableViewPayload = ref<IpdContentViewPayload | null>(null);

/** uploadedAt 后端序列化为 epoch 毫秒数字（实体 Date），与 actualDoneAt 同惯例走 dayjs 格式化。 */
function formatUploadedAt(value: null | number | string | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : '';
}

function formatBytes(size: null | string): string {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function loadDeliverables(): Promise<void> {
  if (!action.value?.id) return;
  const epoch = identityEpoch;
  deliverablesLoading.value = true;
  deliverablesError.value = '';
  try {
    const rows = await listActionDeliverables(action.value.id);
    if (epoch !== identityEpoch) return;
    deliverableRows.value = rows;
  } catch (cause) {
    if (epoch !== identityEpoch) return;
    deliverableRows.value = [];
    deliverablesError.value = ipdErrorText(cause, { fallback: '交付物列表加载失败' });
  } finally {
    if (epoch === identityEpoch) deliverablesLoading.value = false;
  }
}

function openDeliverableView(row: ActionDeliverableRow): void {
  deliverableViewPayload.value = {
    kind: 'auto',
    title: row.fileName,
    download: {
      filename: row.fileName,
      fetch: () => ipdDownload(`/deliverables/${row.id}/download`),
    },
  };
  deliverableViewOpen.value = true;
}

let identityEpoch = 0;

async function load(): Promise<void> {
  const epoch = identityEpoch;
  const requestedProject = projectId.value;
  const requestedAction = actionId.value;
  if (!projectId.value || !actionId.value) {
    loadError.value = new Error('路由参数缺失：项目 ID 或动作 ID 为空');
    registerCopilotPageContext(null);
    return;
  }
  loading.value = true;
  loadError.value = null;
  try {
    const list = await listStageActions(requestedProject);
    if (epoch !== identityEpoch) return;
    const found = list.find((row) => row.id === requestedAction);
    if (!found) {
      loadError.value = new Error(`动作 ID ${actionId.value} 不在项目 ${projectId.value} 下`);
      registerCopilotPageContext(null);
      return;
    }
    action.value = found;
    syncFillPageContext();
    // G3：深管动作同步拉已登记交付物（供查看/下载入口）
    if (isDeep.value) void loadDeliverables();
    fields.actualDoneAt = typeof found.actualDoneAt === 'number' ? found.actualDoneAt : null;
    fields.algoType = found.algoType ?? '';
    fields.certNo = found.certNo ?? '';
    fields.certPassedAt = typeof found.certPassedAt === 'number' ? found.certPassedAt : null;
    fields.farValue = found.farValue == null ? null : Number(found.farValue);
    fields.frrValue = found.frrValue == null ? null : Number(found.frrValue);
    fields.remark = found.remark ?? '';
  } catch (cause) {
    if (epoch === identityEpoch) loadError.value = cause;
  } finally {
    if (epoch === identityEpoch) loading.value = false;
  }
}

function toFieldsBody(): StageActionFieldsBody {
  return {
    actualDoneAt: fields.actualDoneAt,
    algoType: needsAlgoType.value ? (fields.algoType || null) : null,
    certNo: needsCert.value ? (fields.certNo || null) : null,
    certPassedAt: needsCert.value ? (fields.certPassedAt ?? null) : null,
    farValue: needsFarFrr.value ? fields.farValue : null,
    frrValue: needsFarFrr.value ? fields.frrValue : null,
    // D4 修复（2026-10-06）：备注是 /fields 第 7 个可写字段；无条件携带（空串由后端
    // 判空白后清空列），使「只改备注」不再全 null 触发 400、「清空备注」也能生效。
    remark: fields.remark,
  };
}

async function saveFields(): Promise<void> {
  if (!action.value) return;
  if (!farFrrValid.value) {
    submitError.value = new Error('FAR+FRR 之和需小于等于 1.000000（系统参数可配）');
    return;
  }
  const epoch = identityEpoch;
  submitError.value = null;
  busyAction.value = 'saveFields';
  try {
    const updated = await recordStageActionFields(action.value.id, toFieldsBody());
    if (epoch !== identityEpoch) return;
    action.value = updated;
    aiFillHint.value = '';
    message.success('字段已保存。如需变更状态，请使用下方「状态流转」按钮');
  } catch (cause) {
    if (epoch !== identityEpoch) return;
    submitError.value = cause;
    // D4 修复（2026-10-06）：顶部 Alert 可能在滚动视口外，补 toast 即时反馈保存失败。
    message.error(isTransportError(cause) ? '无法连接服务，请检查网络后重试' : '保存失败，请稍后重试');
  } finally {
    if (epoch === identityEpoch) busyAction.value = '';
  }
}

function askTransit(target: StageActionStatus): void {
  pendingTarget.value = target;
  transitReason.value = '';
  transitReasonModalOpen.value = true;
}

async function approveAcceptance(): Promise<void> {
  if (!action.value) return;
  const epoch = identityEpoch;
  submitError.value = null;
  busyAction.value = 'accept';
  try {
    const updated = await acceptStageAction(action.value.id);
    if (epoch !== identityEpoch) return;
    action.value = updated;
    message.success(action.value.confirmedBy ? '已由产线负责人批准' : '批准已提交');
  } catch (cause) {
    if (epoch !== identityEpoch) return;
    submitError.value = cause;
  } finally {
    if (epoch === identityEpoch) busyAction.value = '';
  }
}

async function confirmTransit(): Promise<void> {
  if (!action.value || !pendingTarget.value) return;
  if (pendingTarget.value === 'NA' && !transitReason.value.trim()) {
    message.warning('切到「不适用」必须填写原因');
    return;
  }
  transitReasonModalOpen.value = false;
  const epoch = identityEpoch;
  submitError.value = null;
  busyAction.value = 'transit';
  try {
    const updated = await transitStageAction(action.value.id, pendingTarget.value, transitReason.value.trim() || undefined);
    if (epoch !== identityEpoch) return;
    action.value = updated;
    message.success(`状态已流转为 ${actionStatusText(action.value.status)}`);
  } catch (cause) {
    if (epoch !== identityEpoch) return;
    submitError.value = cause;
  } finally {
    if (epoch === identityEpoch) busyAction.value = '';
  }
}

function openDeliverable(): void {
  if (!isDeep.value) return;
  deliverableFile.value = null;
  deliverableModalOpen.value = true;
}

function onDeliverableFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  deliverableFile.value = input.files?.[0] ?? null;
}

async function submitDeliverable(): Promise<void> {
  if (!action.value) return;
  if (!deliverableFile.value) {
    message.warning('请选择要上传的文件');
    return Promise.reject(new Error('missing-file'));
  }
  const epoch = identityEpoch;
  busyAction.value = 'saveFields';
  try {
    await uploadStageActionDeliverable(action.value.id, deliverableFile.value);
    if (epoch !== identityEpoch) return;
    message.success('交付物已上传');
    deliverableModalOpen.value = false;
    void loadDeliverables();
  } catch (cause) {
    if (epoch !== identityEpoch) return;
    submitError.value = cause;
    return Promise.reject(cause instanceof Error ? cause : new Error('upload-failed'));
  } finally {
    if (epoch === identityEpoch) busyAction.value = '';
  }
}

function backToList(): void {
  router.replace(`/ipd/projects/${projectId.value}/flow`);
}

// ============================================================
//  R221 Task 14：AI 代理执行（PASSIVE）+ 对话即填表前端消费（suggest）
// ============================================================

/** AI 执行按钮可见：非终态（DONE/NA 无执行意义，后端 transit 幂等 no-op，前端直接隐藏）。 */
const canAiExecute = computed(
  () => !!action.value && !['DONE', 'NA'].includes(action.value.status),
);

let aiExecuteTimer: ReturnType<typeof setTimeout> | undefined;

async function aiExecute(): Promise<void> {
  if (!action.value) return;
  const epoch = identityEpoch;
  submitError.value = null;
  busyAction.value = 'aiExecute';
  try {
    await aiExecuteStageAction(action.value.id);
    if (epoch !== identityEpoch) return;
    message.success('AI 任务已提交，稍后刷新查看结果');
    // 引擎 afterCommit 异步跑：延时 3s 后自动刷新一次拉取结果（不阻塞、不轮询；卸载时 clearTimeout 防对已销毁组件回调）。
    aiExecuteTimer = setTimeout(() => { void load(); }, 3000);
  } catch (cause) {
    if (epoch !== identityEpoch) return;
    submitError.value = cause;
  } finally {
    if (epoch === identityEpoch) busyAction.value = '';
  }
}

/** 对话即填表：与 ai-assistant.vue 广播侧同名事件（`ipd:` 前缀惯例）。 */
const AI_FILL_EVENT = 'ipd:ai-fill-payload';
/**
 * C08 对话即填表回填集：与后端唯一事实源 AiCopilotService.FILL_FIELD_WHITELIST['stage-action-fields']
 * （AiCopilotService.java L285-287）**逐字段同源镜像**（R232 P2-03 fillContext）：
 * 后端 6 字段 = actualDoneAt / farValue / frrValue / certNo / certPassedAt / algoType
 * （R230 起 remark 已被后端从白名单移除，与 /fields 端点可落库字段同构，前端镜像随之 6 字段对齐）。
 * **禁扩铁律**：后端没有的字段一个不加——收到白名单外字段一律忽略（onAiFill 循环天然只认镜像清单，
 * 白名单外 key 不落表单并留 debug 日志）；后端白名单变更时以 L285-287 为源改本镜像，不得反向放宽。
 */
const FILLABLE_FIELDS = ['actualDoneAt', 'farValue', 'frrValue', 'certNo', 'certPassedAt', 'algoType'];
const aiFillHint = ref('');

function onAiFill(e: Event) {
  const detail = (e as CustomEvent).detail as
    | { fields?: Record<string, unknown>; mode?: string; scene?: string }
    | undefined;
  // 首切片只认 stage-action-fields；suggest 模式（后端永远 suggest）回填到本地 fields，
  // 绝不自动调 saveFields——敏感字段红线 spec §3.5，须人目检后手动提交。
  if (detail?.scene !== 'stage-action-fields' || !detail.fields) return;
  // 首切片只认 suggest（后端恒为 suggest）；auto 未落地前防御性忽略，避免被误当自动提交入口。
  if (detail.mode && detail.mode !== 'suggest') return;
  let applied = 0;
  const dropped: string[] = [];
  for (const key of Object.keys(detail.fields)) {
    if (detail.fields[key] === undefined) continue;
    // R232 P2-03 禁扩：只认 FILLABLE_FIELDS 同源镜像，白名单外字段忽略不落表单。
    if ((FILLABLE_FIELDS as readonly string[]).includes(key)) {
      (fields as Record<string, unknown>)[key] = detail.fields[key];
      applied++;
    } else {
      dropped.push(key);
    }
  }
  if (dropped.length > 0) {
    // debug 级留痕供走查观测（白名单外忽略是可预期防御行为，不上用户提示）。
    console.debug('[ai-fill] 白名单外字段已忽略（禁扩，FILL_FIELD_WHITELIST 同源镜像）:', dropped);
  }
  if (applied > 0) {
    aiFillHint.value = `AI 已填充 ${applied} 个字段（建议模式），请目检后点「保存字段」提交`;
  }
}

/**
 * 向副驾注册本页填表上下文。stageActionId 保持动作 ID 字符串，不经 Number()。
 * 非正整数或超出 Java long 的不送。上送时再按原文拼成 JSON 数字。
 */
function syncFillPageContext(): void {
  if (!action.value) {
    registerCopilotPageContext(null);
    return;
  }
  const stageActionId = stageActionIdText(action.value.id);
  registerCopilotPageContext({
    actionCode: action.value.actionCode ?? undefined,
    scene: 'stage-action-fields',
    ...(stageActionId ? { stageActionId } : {}),
  });
}

watch([projectId, actionId], () => {
  identityEpoch++;
  action.value = null;
  loading.value = false;
  loadError.value = null;
  submitError.value = null;
  busyAction.value = '';
  transitReasonModalOpen.value = false;
  pendingTarget.value = '';
  deliverableModalOpen.value = false;
  deliverableFile.value = null;
  aiFillHint.value = '';
  registerCopilotPageContext(null);
  if (aiExecuteTimer) clearTimeout(aiExecuteTimer);
  void load();
}, { immediate: true });

onMounted(() => {
  window.addEventListener(AI_FILL_EVENT, onAiFill);
});
onUnmounted(() => {
  identityEpoch++;
  window.removeEventListener(AI_FILL_EVENT, onAiFill);
  registerCopilotPageContext(null);
  if (aiExecuteTimer) clearTimeout(aiExecuteTimer);
});
</script>

<template>
  <div class="p-4">
    <Card>
      <template #title>
        <Space>
          <span>{{ action?.actionName ?? '动作详情' }}</span>
          <Tag v-if="action" :color="depthColor(action.depth)">{{ depthText(action.depth) }}</Tag>
          <Tag v-if="action" :color="actionStatusColor(action.status)">{{ actionStatusText(action.status) }}</Tag>
          <Tag v-if="isBlocking" color="error">阻断性动作</Tag>
          <Tag v-if="isHistoricalMissing" color="warning">{{ historyMarkText(action?.historyMark ?? null) }}</Tag>
        </Space>
      </template>
      <template #extra>
        <Space>
          <Button
            v-if="action?.actionCode"
            data-testid="action-open-agent"
            @click="openInProjectAgent"
          >
            用项目智能体做这一动作
          </Button>
          <Button @click="backToList">返回 IPD 流程</Button>
        </Space>
      </template>

      <Alert
        v-if="loadError"
        class="mb-4"
        :message="loadErrorText"
        type="error"
        show-icon
      />

      <Alert
        v-if="submitError"
        class="mb-4"
        :message="submitError
          ? (isTransportError(submitError)
            ? '无法连接服务，请检查网络后重试'
            : ipdErrorText(submitError, { domain: 'project',
                fallback: '操作失败，请稍后重试',
                codeTexts: {
                  50002: '状态已变更（可能其他人已编辑），请刷新后重试',
                  40001: '阶段门禁校验未通过，请确认前置条件',
                  10001: '输入信息不符合要求，请检查后重试',
                },
              }))
          : ''"
        type="error"
        show-icon
      />

      <Spin :spinning="loading">
        <Empty
          v-if="!loading && !action && !loadError"
          description="未找到该动作。可能已被删除或不在项目下。"
        />

        <template v-else-if="action">
          <Descriptions :column="2" size="small" bordered class="mb-4">
            <Descriptions.Item label="动作编码">{{ action.actionCode ?? '待补充' }}</Descriptions.Item>
            <Descriptions.Item label="主责角色">{{ roleText(action.ownerRole) }}</Descriptions.Item>
            <Descriptions.Item label="管理类型">{{ depthText(action.depth) }}</Descriptions.Item>
            <Descriptions.Item label="当前状态">{{ actionStatusText(action.status) }}</Descriptions.Item>
            <Descriptions.Item label="所属阶段 ID">{{ action.stageId ?? '待补充' }}</Descriptions.Item>
            <Descriptions.Item label="SOP 模板 ID">{{ action.sopId ?? '待补充' }}</Descriptions.Item>
            <Descriptions.Item label="实际完成日期" :span="2">
              {{ projectDateTimeText(action.actualDoneAt) }}
            </Descriptions.Item>
            <Descriptions.Item v-if="action.certNo || showCert" label="认证编号">{{ action.certNo ?? '待补充' }}</Descriptions.Item>
            <Descriptions.Item v-if="action.certPassedAt || showCert" label="认证通过日期">
              {{ projectDateTimeText(action.certPassedAt) }}
            </Descriptions.Item>
            <Descriptions.Item v-if="action.farValue !== null || showFarFrr" label="FAR">
              <span class="tabular-nums">{{ action.farValue ?? '待补充' }}</span>
            </Descriptions.Item>
            <Descriptions.Item v-if="action.frrValue !== null || showFarFrr" label="FRR">
              <span class="tabular-nums">{{ action.frrValue ?? '待补充' }}</span>
            </Descriptions.Item>
            <Descriptions.Item v-if="action.algoType || needsAlgoType" label="算法分类">
              {{ algoText(action.algoType) }}
            </Descriptions.Item>
            <Descriptions.Item v-if="action.remark" label="备注" :span="2">
              <span class="whitespace-pre-wrap">{{ action.remark }}</span>
            </Descriptions.Item>
          </Descriptions>

          <Alert
            v-if="isDeep"
            class="mb-4"
            type="info"
            show-icon
            message="此动作需上传交付物后才能提交验收。建议先切到「进行中」，完成时上传交付物、填写实际完成日期，再点「提交验收」。"
          />

          <Alert
            v-if="isLight"
            class="mb-4"
            type="info"
            show-icon
            message="此动作无需上传交付物：填写实际完成日期（可加备注）后，点「提交验收」即完成。"
          />

          <!-- 字段录入 -->
          <Card type="inner" title="字段录入" class="mb-4">
            <Form layout="vertical">
              <Space size="large" wrap>
                <Form.Item label="实际完成日期">
                  <DatePicker
                    v-model:value="actualDoneAtModel"
                    show-time
                    class="!w-72"
                    :disabled="isBlocking && action.status !== 'IN_PROGRESS'"
                  />
                </Form.Item>
                <Form.Item v-if="showFarFrr" label="FAR（BioCV）">
                  <InputNumber
                    v-model:value="farValueModel"
                    :min="0"
                    :max="1"
                    :step="0.0001"
                    :precision="6"
                  />
                </Form.Item>
                <Form.Item v-if="showFarFrr" label="FRR（BioCV）">
                  <InputNumber
                    v-model:value="frrValueModel"
                    :min="0"
                    :max="1"
                    :step="0.0001"
                    :precision="6"
                  />
                </Form.Item>
              </Space>

              <Space size="large" wrap>
                <Form.Item v-if="showCert" label="认证编号">
                  <Input v-model:value="fields.certNo" placeholder="^[A-Za-z0-9\-/]+$" />
                </Form.Item>
                <Form.Item v-if="showCert" label="认证通过日期">
                  <DatePicker v-model:value="certPassedAtModel" class="!w-72" />
                </Form.Item>
                <Form.Item v-if="needsAlgoType" label="算法分类">
                  <Select
                    v-model:value="fields.algoType"
                    :options="[
                      { label: '指纹', value: 'FINGERPRINT' },
                      { label: '人脸', value: 'FACE' },
                      { label: '掌纹', value: 'PALM' },
                      { label: '指静脉', value: 'VEIN' },
                      { label: '多模态', value: 'MULTI' },
                    ]"
                    class="!w-40"
                    allow-clear
                  />
                </Form.Item>
              </Space>

              <Form.Item label="备注">
                <Input.TextArea
                  v-model:value="fields.remark"
                  :maxlength="500"
                  show-count
                  :auto-size="{ minRows: 2, maxRows: 4 }"
                />
              </Form.Item>

              <Alert
                v-if="needsFarFrr && !farFrrValid"
                class="mb-4"
                type="warning"
                show-icon
                :message="`FAR + FRR 之和需 ≤ 1.000000，当前 ${(Number(fields.farValue ?? 0) + Number(fields.frrValue ?? 0)).toFixed(6)}`"
              />

              <Alert
                v-if="aiFillHint"
                class="mb-4"
                type="info"
                show-icon
                closable
                :message="aiFillHint"
              />

              <Space>
                <Button type="primary" v-access:code="IPD_PERMISSION_CODES.STAGE_ACTION_EXECUTE" :loading="busyAction === 'saveFields'" @click="saveFields">
                  保存字段
                </Button>
                <Button
                  v-if="canAiExecute"
                  type="primary"
                  ghost
                  v-access:code="IPD_PERMISSION_CODES.STAGE_ACTION_EXECUTE"
                  :loading="busyAction === 'aiExecute'"
                  @click="aiExecute"
                >
                  AI 执行
                </Button>
                <Button v-if="isDeep" v-access:code="IPD_PERMISSION_CODES.STAGE_ACTION_DELIVERABLE" :loading="busyAction === 'saveFields'" @click="openDeliverable">
                  上传交付物
                </Button>
              </Space>
            </Form>

            <!-- 文档预览 G3：已上传交付物列表（查看/下载入口） -->
            <div v-if="isDeep" class="mt-3" data-testid="action-deliverable-list">
              <div class="mb-1 text-sm font-medium">已上传交付物</div>
              <div v-if="deliverablesLoading" class="text-muted-foreground text-xs">正在加载交付物……</div>
              <Alert v-else-if="deliverablesError" show-icon type="error" :message="deliverablesError" />
              <div v-else-if="deliverableRows.length === 0" class="text-muted-foreground text-xs">尚未上传交付物。</div>
              <ul v-else class="space-y-1 text-sm">
                <li v-for="row in deliverableRows" :key="row.id" class="flex flex-wrap items-center gap-2">
                  <span class="max-w-[320px] truncate font-medium" :title="row.fileName">{{ row.fileName }}</span>
                  <span v-if="formatBytes(row.fileSize)" class="text-muted-foreground text-xs">{{ formatBytes(row.fileSize) }}</span>
                  <span v-if="formatUploadedAt(row.uploadedAt)" class="text-muted-foreground text-xs">{{ formatUploadedAt(row.uploadedAt) }}</span>
                  <Button size="small" type="link" @click="openDeliverableView(row)">查看</Button>
                </li>
              </ul>
            </div>
          </Card>

          <!-- 状态流转（按 depth 分支） -->
          <Card type="inner" title="状态流转">
            <Space wrap>
              <Button
                v-if="action.status !== 'IN_PROGRESS'"
                :loading="busyAction === 'transit'"
                @click="askTransit('IN_PROGRESS')"
              >
                切到「进行中」
              </Button>
              <Button
                v-if="action.status !== 'DONE'"
                type="primary"
                :loading="busyAction === 'transit'"
                :disabled="(isBlocking && showCert && (!action.certNo || !action.certPassedAt)
                  && !(fields.certNo && fields.certPassedAt))
                  || (isDeep && action.status === 'NOT_STARTED')"
                @click="askTransit('DONE')"
              >
                提交验收
              </Button>
              <Button
                v-if="action.status === 'DONE' && !action.confirmedBy"
                type="primary"
                :loading="busyAction === 'accept'"
                @click="approveAcceptance"
              >
                批准验收
              </Button>
              <Button
                v-if="isDeep && action.status !== 'DELAYED'"
                :loading="busyAction === 'transit'"
                @click="askTransit('DELAYED')"
              >
                切到「已逾期」
              </Button>
              <Button
                v-if="action.status !== 'NA'"
                :loading="busyAction === 'transit'"
                @click="askTransit('NA')"
              >
                切到「不适用」
              </Button>
              <Button
                v-if="action.status !== 'NOT_STARTED'"
                :loading="busyAction === 'transit'"
                @click="askTransit('NOT_STARTED')"
              >
                切到「未开始」
              </Button>
            </Space>

            <div class="text-muted-foreground mt-2 text-xs">
              可切换状态：{{ (isDeep ? statusOptions : lightStatusOptions).map((o) => o.label).join(' / ') }}
            </div>
          </Card>
        </template>
      </Spin>
    </Card>

    <!-- NA / DELAYED 流转需传 reason -->
    <Modal
      v-model:open="transitReasonModalOpen"
      :title="pendingTarget === 'NA' ? '切到「不适用」需填写原因' : pendingTarget === 'DELAYED' ? '切到「已逾期」可填写原因' : '状态流转确认'"
      ok-text="确认"
      cancel-text="取消"
      @ok="confirmTransit"
    >
      <Input.TextArea
        v-model:value="transitReason"
        :auto-size="{ minRows: 3, maxRows: 6 }"
        :maxlength="500"
        show-count
        :placeholder="pendingTarget === 'NA' ? '切到「不适用」必须填写原因' : '可填写原因（选填）'"
      />
    </Modal>

    <!-- 需交付物动作的上传入口 -->
    <Modal
      v-model:open="deliverableModalOpen"
      title="上传交付物"
      ok-text="上传"
      cancel-text="取消"
      @ok="submitDeliverable"
    >
      <Form layout="vertical">
        <Form.Item label="交付物文件" required>
          <input type="file" data-testid="deliverable-file" @change="onDeliverableFile" />
        </Form.Item>
      </Form>
    </Modal>

    <!-- 文档预览 G3：交付物统一查看/下载 -->
    <IpdContentView v-model:open="deliverableViewOpen" :payload="deliverableViewPayload" />
  </div>
</template>