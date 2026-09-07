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
import { computed, onMounted, reactive, ref } from 'vue';
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
  StageAction,
  StageActionFieldsBody,
  StageActionStatus,
} from '../../../../api/ipd/stage-action';
import {
  addStageActionDeliverable,
  listStageActions,
  recordStageActionFields,
  transitStageAction,
} from '../../../../api/ipd/stage-action';
import { isTransportError, projectErrorText } from '../project-error';
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

const route = useRoute();
const router = useRouter();

const projectId = computed(() => String(route.params.projectId ?? ''));
const actionId = computed(() => String(route.params.actionId ?? ''));

const loading = ref(false);
const loadError = ref<unknown>(null);
const action = ref<StageAction | null>(null);

/** 区分 IpdRequestError / 普通 Error：业务拒绝走 projectErrorText，本地判定走原 message。 */
const loadErrorText = computed(() => {
  if (!loadError.value) return '';
  if (isTransportError(loadError.value)) return '无法连接服务，请检查网络后重试';
  if (loadError.value instanceof Error && !(loadError.value as { kind?: string }).kind) {
    return loadError.value.message || '动作详情加载失败，请稍后重试';
  }
  return projectErrorText(loadError.value, { fallback: '动作详情加载失败，请稍后重试' });
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

const busyAction = ref<'' | 'saveFields' | 'transit'>('');
const submitError = ref<unknown>(null);

const transitReasonModalOpen = ref(false);
const pendingTarget = ref<StageActionStatus>('');
const transitReason = ref('');

/** D11/Z01：FAR/FRR 例外字段；非例外动作不展示。 */
const showFarFrr = computed(() => needsFarFrr.value);

/** V02/P10：certNo/certPassedAt 例外字段；非例外动作不展示。 */
const showCert = computed(() => needsCert.value);

/** 深管交付物登记弹窗（不实现 OSS 上传；前端封装 /deliverables?fileName=&ossId=）。 */
const deliverableModalOpen = ref(false);
const deliverableFileName = ref('');
const deliverableOssId = ref('');

async function load(): Promise<void> {
  if (!projectId.value || !actionId.value) {
    loadError.value = new Error('路由参数缺失：项目 ID 或动作 ID 为空');
    return;
  }
  loading.value = true;
  loadError.value = null;
  try {
    const list = await listStageActions(projectId.value);
    const found = list.find((row) => row.id === actionId.value);
    if (!found) {
      loadError.value = new Error(`动作 ID ${actionId.value} 不在项目 ${projectId.value} 下`);
      return;
    }
    action.value = found;
    fields.actualDoneAt = typeof found.actualDoneAt === 'number' ? found.actualDoneAt : null;
    fields.algoType = found.algoType ?? '';
    fields.certNo = found.certNo ?? '';
    fields.certPassedAt = typeof found.certPassedAt === 'number' ? found.certPassedAt : null;
    fields.farValue = found.farValue == null ? null : Number(found.farValue);
    fields.frrValue = found.frrValue == null ? null : Number(found.frrValue);
    fields.remark = found.remark ?? '';
  } catch (cause) {
    loadError.value = cause;
  } finally {
    loading.value = false;
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
  };
}

async function saveFields(): Promise<void> {
  if (!action.value) return;
  if (!farFrrValid.value) {
    submitError.value = new Error('FAR+FRR 之和需小于等于 1.000000（系统参数可配）');
    return;
  }
  submitError.value = null;
  busyAction.value = 'saveFields';
  try {
    action.value = await recordStageActionFields(action.value.id, toFieldsBody());
    message.success('动作字段已保存（status 未变更，请走状态流转接口）');
  } catch (cause) {
    submitError.value = cause;
  } finally {
    busyAction.value = '';
  }
}

function askTransit(target: StageActionStatus): void {
  pendingTarget.value = target;
  transitReason.value = '';
  transitReasonModalOpen.value = true;
}

async function confirmTransit(): Promise<void> {
  if (!action.value || !pendingTarget.value) return;
  if (pendingTarget.value === 'NA' && !transitReason.value.trim()) {
    message.warning('切到「不适用」必须填写原因');
    return;
  }
  transitReasonModalOpen.value = false;
  submitError.value = null;
  busyAction.value = 'transit';
  try {
    action.value = await transitStageAction(action.value.id, pendingTarget.value, transitReason.value.trim() || undefined);
    message.success(`状态已流转为 ${actionStatusText(action.value.status)}`);
  } catch (cause) {
    submitError.value = cause;
  } finally {
    busyAction.value = '';
  }
}

function openDeliverable(): void {
  if (!isDeep.value) return;
  deliverableFileName.value = '';
  deliverableOssId.value = '';
  deliverableModalOpen.value = true;
}

async function submitDeliverable(): Promise<void> {
  if (!action.value) return;
  if (!deliverableFileName.value.trim()) {
    message.warning('请填写交付物文件名');
    return;
  }
  busyAction.value = 'saveFields';
  try {
    await addStageActionDeliverable(
      action.value.id,
      deliverableFileName.value.trim(),
      deliverableOssId.value.trim(),
    );
    message.success('交付物已登记（OSS 上传需走 /api/v1/attachments 流程，UI 不实现）');
    deliverableModalOpen.value = false;
  } catch (cause) {
    submitError.value = cause;
  } finally {
    busyAction.value = '';
  }
}

function backToList(): void {
  router.replace(`/ipd/projects/${projectId.value}/flow`);
}

onMounted(load);
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
        <Button @click="backToList">返回 IPD 流程</Button>
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
            : projectErrorText(submitError, {
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
            <Descriptions.Item label="主责角色">{{ action.ownerRole ?? '待补充' }}</Descriptions.Item>
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
            message="深管动作：状态流转与字段录入走 /transit 与 /fields；交付物需先经 /api/v1/attachments 上传 OSS 拿到 ossId，再登记到本动作。SOP 模板与 AI 面板等待后端支撑接入。"
          />

          <Alert
            v-if="isLight"
            class="mb-4"
            type="info"
            show-icon
            message="轻管动作（BR-IPD-04 / G-10）：仅三字段（status / actualDoneAt / remark），无附件上传入口；保存字段后通过状态流转切到「已完成」。"
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

              <Space>
                <Button type="primary" v-access:code="IPD_PERMISSION_CODES.STAGE_ACTION_EXECUTE" :loading="busyAction === 'saveFields'" @click="saveFields">
                  保存字段
                </Button>
                <Button v-if="isDeep" v-access:code="IPD_PERMISSION_CODES.STAGE_ACTION_DELIVERABLE" :loading="busyAction === 'saveFields'" @click="openDeliverable">
                  登记交付物
                </Button>
              </Space>
            </Form>
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
                :disabled="isBlocking && showCert && (!action.certNo || !action.certPassedAt)
                  && !(fields.certNo && fields.certPassedAt)"
                @click="askTransit('DONE')"
              >
                切到「已完成」
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

            <div v-if="isDeep" class="text-muted-foreground mt-2 text-xs">
              状态选项：{{ statusOptions.map((o) => o.label).join(' / ') }}
            </div>
            <div v-else class="text-muted-foreground mt-2 text-xs">
              轻管可用：{{ lightStatusOptions.map((o) => o.label).join(' / ') }}
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

    <!-- 深管交付物登记 -->
    <Modal
      v-model:open="deliverableModalOpen"
      title="登记深管交付物"
      ok-text="登记"
      cancel-text="取消"
      @ok="submitDeliverable"
    >
      <Form layout="vertical">
        <Form.Item label="文件名" required>
          <Input v-model:value="deliverableFileName" placeholder="例如：算法验证报告 v1.pdf" />
        </Form.Item>
        <Form.Item label="OSS 文件 ID（选填）" extra="需先经 /api/v1/attachments 上传拿到 ossId；UI 不实现上传流程。">
          <Input v-model:value="deliverableOssId" placeholder="OSS 对象 ID；无 ossId 仍可登记文件名" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>