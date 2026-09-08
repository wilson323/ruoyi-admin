<script setup lang="ts">
/**
 * 页25 项目详情-需求与变更（看板卡 P0-10.25）。
 *
 * 真实交付（POST 写端点）：
 * - POST /api/v1/coefficient-change-requests            系数变更双PM 联合提议
 * - POST /api/v1/coefficient-change-requests/{id}/leader-decision  产品组长确认/驳回
 * - POST /api/v1/launch-date-change-requests            上市日期变更第一签提议
 * - POST /api/v1/launch-date-change-requests/{id}/second-decision  另一侧PM 第二签
 *
 * 未交付（挂占位，G-06 不展示任何模拟数据）：
 * - 系数/上市日期两类变更单的 GET 列表/详情读端点（仅 POST 发起+决策）。
 *
 * 已交付（RequirementChange，P2-6.1/6.2 双签否决 6 端点）：
 * - POST /requirement-changes、PUT /{id}/submit、PUT /{id}/sign、
 *   GET /{id}、GET /requirement-changes?pageNo&pageSize&projectId&status、
 *   GET /requirement-changes/open。本页 Tab3 接完整工作流（创建草稿 → 提交双签 → 签署 → 列表）。
 *
 * 决策操作内联到发起成功卡内：发起后按返回的申请 ID 直接做确认/驳回（approve 走 query 串），
 * 无需导航到独立详情页。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  DescriptionsItem,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  Radio,
  RadioGroup,
  Select,
  SelectOption,
  Space,
  TabPane,
  Tabs,
  Table,
  Tag,
  Textarea,
  message,
} from 'ant-design-vue';

import BackendPending from '../../_shared/backend-pending.vue';
import { PENDING_TEXT } from '../../_shared/format';
import { ipdApiErrorText } from '../../../../api/ipd/ai-document';
import { IpdRequestError } from '../../../../api/ipd/auth';
import {
  type CoefficientChangeRequest,
  type LaunchDateChangeRequest,
  type RequirementChange,
  decideCoefficientChange,
  decideLaunchDateChange,
  createRequirementChange,
  listRequirementChanges,
  proposeCoefficientChange,
  proposeLaunchDateChange,
  signRequirementChange,
  submitRequirementChange,
} from '../../../../api/ipd/change';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import {
  COEF_CHANGE_STATUS_TEXT,
  DECISION_LABEL,
  changeStateLabel,
  changeStateTone,
} from '../../_shared/ipd-enums';

const route = useRoute();
const auth = useIpdAuthStore();

const projectId = computed(() => String(route.params.projectId ?? ''));

/** 系数/上市日变更审批状态（仅本页用，非通用状态机；走 SSOT 见 _shared/ipd-enums.COEF_CHANGE_STATUS_TEXT）。 */
const STATUS_TEXTS: Record<string, string> = COEF_CHANGE_STATUS_TEXT;

function statusText(status: null | string): string {
  return status ? (STATUS_TEXTS[status] ?? status) : PENDING_TEXT;
}

function decisionText(value: null | string): string {
  return value ? (DECISION_LABEL[value] ?? value) : PENDING_TEXT;
}

// ---------- 系数变更（真实端点） ----------
const coefForm = reactive({
  marketPmId: auth.identity?.person.personType === 'MARKET_PM' ? (auth.identity.person.id ?? '') : '',
  proposedCoefficient: null as null | number,
  rdPmId: auth.identity?.person.personType === 'RD_PM' ? (auth.identity.person.id ?? '') : '',
  reason: '',
});
const coefSubmitting = ref(false);
const coefError = ref<null | string>(null);
const coefResult = ref<null | CoefficientChangeRequest>(null);

const coefDecision = reactive({ approve: true, opinion: '' });
const coefDecisionSubmitting = ref(false);
const coefDecisionError = ref<null | string>(null);
const coefDecisionResult = ref<null | CoefficientChangeRequest>(null);

/** InputNumber 不收 null：与 coefForm.proposedCoefficient（null|number）双向适配。 */
const proposedCoefficientModel = computed<number | string | undefined>({
  get: () => (coefForm.proposedCoefficient == null ? undefined : coefForm.proposedCoefficient),
  set: (value) => {
    coefForm.proposedCoefficient = value == null || value === '' ? null : Number(value);
  },
});

function validateId(value: string, label: string): null | string {
  return /^\d+$/.test(value.trim()) ? null : `请输入正确的${label}账号 ID（纯数字）。`;
}

async function submitCoefficient() {
  const coefficient = coefForm.proposedCoefficient;
  if (coefficient === null || Number.isNaN(coefficient) || coefficient <= 0) {
    coefError.value = '请填写大于 0 的建议系数（保留两位小数）。';
    return;
  }
  const marketError = validateId(coefForm.marketPmId, '市场PM');
  if (marketError) {
    coefError.value = marketError;
    return;
  }
  const rdError = validateId(coefForm.rdPmId, '研发PM');
  if (rdError) {
    coefError.value = rdError;
    return;
  }
  if (!coefForm.reason.trim() || coefForm.reason.length > 500) {
    coefError.value = '请填写变更原因（不超过 500 字）。';
    return;
  }
  coefSubmitting.value = true;
  coefError.value = null;
  try {
    coefResult.value = await proposeCoefficientChange({
      marketPmId: coefForm.marketPmId.trim(),
      proposedCoefficient: coefficient.toFixed(2),
      rdPmId: coefForm.rdPmId.trim(),
      projectId: projectId.value,
      reason: coefForm.reason.trim(),
    });
    coefDecisionError.value = null;
    coefDecisionResult.value = null;
    message.success('系数变更申请已提交，可在下方对变更单执行确认/驳回');
  } catch (cause) {
    coefResult.value = null;
    coefError.value = ipdApiErrorText(cause);
  } finally {
    coefSubmitting.value = false;
  }
}

async function submitCoefDecision() {
  if (!coefResult.value) return;
  coefDecisionSubmitting.value = true;
  coefDecisionError.value = null;
  try {
    coefDecisionResult.value = await decideCoefficientChange(
      coefResult.value.id,
      coefDecision.approve,
      coefDecision.opinion.trim() || null,
    );
    message.success(coefDecision.approve ? '已确认通过' : '已驳回');
  } catch (cause) {
    if (cause instanceof IpdRequestError && cause.code === 50002) {
      coefDecisionError.value = '该变更单已被处理或状态已变更，请联系产品组长或超级管理员确认。';
    } else {
      coefDecisionError.value = ipdApiErrorText(cause);
    }
  } finally {
    coefDecisionSubmitting.value = false;
  }
}

// ---------- 上市日期变更（真实端点） ----------
const launchForm = reactive({ proposedLaunchDate: '', reason: '' });
const launchSubmitting = ref(false);
const launchError = ref<null | string>(null);
const launchResult = ref<null | LaunchDateChangeRequest>(null);

const launchDecision = reactive({ approve: true, opinion: '' });
const launchDecisionSubmitting = ref(false);
const launchDecisionError = ref<null | string>(null);
const launchDecisionResult = ref<null | LaunchDateChangeRequest>(null);

async function submitLaunchDate() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(launchForm.proposedLaunchDate)) {
    launchError.value = '请选择建议上市日期。';
    return;
  }
  if (!launchForm.reason.trim() || launchForm.reason.length > 500) {
    launchError.value = '请填写变更原因（不超过 500 字）。';
    return;
  }
  launchSubmitting.value = true;
  launchError.value = null;
  try {
    launchResult.value = await proposeLaunchDateChange({
      proposedLaunchDate: launchForm.proposedLaunchDate,
      projectId: projectId.value,
      reason: launchForm.reason.trim(),
    });
    launchDecisionError.value = null;
    launchDecisionResult.value = null;
    message.success('上市日期变更申请已提交，可在下方对变更单执行第二签');
  } catch (cause) {
    launchResult.value = null;
    launchError.value = ipdApiErrorText(cause);
  } finally {
    launchSubmitting.value = false;
  }
}

async function submitLaunchDecision() {
  if (!launchResult.value) return;
  launchDecisionSubmitting.value = true;
  launchDecisionError.value = null;
  try {
    launchDecisionResult.value = await decideLaunchDateChange(
      launchResult.value.id,
      launchDecision.approve,
      launchDecision.opinion.trim() || null,
    );
    message.success(launchDecision.approve ? '已确认通过' : '已驳回');
  } catch (cause) {
    if (cause instanceof IpdRequestError && cause.code === 50002) {
      launchDecisionError.value = '该变更单已被处理或状态已变更，请联系另一侧PM确认。';
    } else {
      launchDecisionError.value = ipdApiErrorText(cause);
    }
  } finally {
    launchDecisionSubmitting.value = false;
  }
}

// ---------- 需求变更（RequirementChange，P2-6.1 双签否决 BR-GATE-07） ----------
/** 需求变更类型选项；后端 changeType 走 OPEN 字符串，新加类型需同步 RequirementChangeService。 */
const CHANGE_TYPE_OPTIONS = [
  { label: '功能调整', value: 'FUNCTIONAL' },
  { label: '需求变更', value: 'REQUIREMENT' },
  { label: '上市调整', value: 'LAUNCH' },
  { label: '优先级调整', value: 'PRIORITY' },
];

const reqForm = reactive({
  requirementId: '',
  changeType: 'REQUIREMENT',
  reason: '',
  beforeSnapshot: '',
  afterSnapshot: '',
});
const reqSubmitting = ref(false);
const reqError = ref<null | string>(null);
const reqResult = ref<null | RequirementChange>(null);

const reqDecision = reactive({ approve: true, opinion: '' });
const reqDecisionSubmitting = ref(false);
const reqDecisionError = ref<null | string>(null);
const reqDecisionResult = ref<null | RequirementChange>(null);

const reqList = ref<RequirementChange[]>([]);
const reqListLoading = ref(false);
const reqListError = ref('');

function statusToneFor(status: string): string {
  return changeStateTone(status, 'default');
}
function statusLabelFor(status: null | string): string {
  return changeStateLabel(status, PENDING_TEXT);
}

async function loadReqList() {
  const id = projectId.value.trim();
  if (!id) {
    reqList.value = [];
    return;
  }
  reqListLoading.value = true;
  reqListError.value = '';
  try {
    const page = await listRequirementChanges(id);
    reqList.value = page.records;
  } catch (cause) {
    reqList.value = [];
    reqListError.value = ipdApiErrorText(cause);
  } finally {
    reqListLoading.value = false;
  }
}

async function submitRequirement() {
  const reqId = reqForm.requirementId.trim();
  const reason = reqForm.reason.trim();
  if (!/^\d+$/.test(reqId)) {
    reqError.value = '请填写需求编号（纯数字 ID）。';
    return;
  }
  if (!reason) {
    reqError.value = '请填写变更原因。';
    return;
  }
  if (!reqForm.changeType.trim()) {
    reqError.value = '请选择变更类型。';
    return;
  }
  const id = projectId.value.trim();
  if (!id) {
    reqError.value = '缺少项目编号，请在项目详情页进入。';
    return;
  }
  reqSubmitting.value = true;
  reqError.value = null;
  try {
    reqResult.value = await createRequirementChange({
      requirementId: reqId,
      changeType: reqForm.changeType,
      reason,
      beforeSnapshot: reqForm.beforeSnapshot.trim() || null,
      afterSnapshot: reqForm.afterSnapshot.trim() || null,
      projectId: id,
    });
    reqDecisionError.value = null;
    reqDecisionResult.value = null;
    message.success('需求变更草稿已创建，请在下方提交双签');
  } catch (cause) {
    reqResult.value = null;
    reqError.value = ipdApiErrorText(cause);
  } finally {
    reqSubmitting.value = false;
  }
}

async function submitReqSign() {
  if (!reqResult.value) return;
  reqDecisionSubmitting.value = true;
  reqDecisionError.value = null;
  try {
    if (reqResult.value.status === 'DRAFT') {
      reqResult.value = await submitRequirementChange(reqResult.value.id);
      message.success('已提交双签（DRAFT → PENDING_SIGN），等待对方签署');
    } else if (reqResult.value.status === 'PENDING_SIGN') {
      reqDecisionResult.value = await signRequirementChange(
        reqResult.value.id,
        reqDecision.approve ? 'APPROVE' : 'REJECT',
        reqDecision.opinion.trim() || null,
      );
      message.success(reqDecision.approve ? '已签署通过' : '已签署驳回');
    } else {
      reqDecisionError.value = `当前状态 ${reqResult.value.status} 不支持该操作。`;
      return;
    }
  } catch (cause) {
    if (cause instanceof IpdRequestError && cause.code === 50002) {
      reqDecisionError.value = '该变更单已被处理或状态已变更，请刷新后查看。';
    } else {
      reqDecisionError.value = ipdApiErrorText(cause);
    }
  } finally {
    reqDecisionSubmitting.value = false;
    // 列表自动同步（不在加载中才刷新，避免重入）
    if (!reqListLoading.value) {
      void loadReqList();
    }
  }
}

const reqListColumns = [
  { title: '变更单编号', dataIndex: 'id', key: 'id', width: 110 },
  { title: '需求编号', dataIndex: 'requirementId', key: 'requirementId', width: 110 },
  { title: '变更类型', dataIndex: 'changeType', key: 'changeType', width: 110 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 110 },
  { title: '创建时间', dataIndex: 'createTime', key: 'createTime', width: 160 },
  { title: '变更原因', dataIndex: 'reason', key: 'reason' },
];

onMounted(() => {
  // 首次进入预拉需求变更列表（Tab3）；Tab1/Tab2 是表单驱动，不预拉。
  void loadReqList();
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <Alert
      message="发起系数/上市日期变更后即可在同卡片内对变更单执行确认/驳回；变更单列表与详情读端点尚未交付，本页不展示任何模拟数据。"
      show-icon
      type="info"
    />

    <!-- 变更单列表：读端点未交付，占位（G-06） -->
    <Card title="变更单列表">
      <BackendPending
        backend="两类变更单的 GET 列表/详情读端点均未交付"
        card="P0-10.25"
        note="读端点交付前本区不展示任何模拟数据；发起动作与决策操作按已交付的真实端点实现。"
      />
    </Card>

    <Tabs default-active-key="coefficient">
      <TabPane key="coefficient" tab="系数变更（S/B 级）">
        <Card title="发起系数变更（双PM 联合提议）">
          <Alert
            class="mb-4"
            message="仅 S/B 级项目适用差异化系数定值；提交后由产品组长确认写入项目档案。双方提交前请先行线下对齐。"
            show-icon
            type="info"
          />
          <Form layout="horizontal" :label-col="{ style: { width: '130px' } }">
            <FormItem label="建议系数" required>
              <InputNumber
                v-model:value="proposedCoefficientModel"
                :min="0"
                :precision="2"
                placeholder="如 1.20"
                style="width: 200px"
              />
            </FormItem>
            <FormItem label="市场PM 账号 ID" required>
              <Input v-model:value="coefForm.marketPmId" placeholder="市场PM 的账号 ID（纯数字）" style="width: 280px" />
            </FormItem>
            <FormItem label="研发PM 账号 ID" required>
              <Input v-model:value="coefForm.rdPmId" placeholder="研发PM 的账号 ID（纯数字）" style="width: 280px" />
            </FormItem>
            <FormItem label="变更原因" required>
              <Textarea
                v-model:value="coefForm.reason"
                :maxlength="500"
                :rows="4"
                placeholder="请说明系数调整依据"
                show-count
              />
            </FormItem>
            <FormItem label=" " :colon="false">
              <Button :loading="coefSubmitting" type="primary" @click="submitCoefficient">提交系数变更申请</Button>
            </FormItem>
          </Form>
          <Alert v-if="coefError" class="mt-2" show-icon type="error" role="alert" :message="coefError" />
          <Alert v-if="coefResult" class="mt-2" show-icon type="success">
            <template #message>系数变更申请已提交</template>
            <template #description>
              <p>变更单 ID：{{ coefResult.id }}</p>
              <p>状态：{{ statusText(coefResult.status) }}</p>
              <p class="text-muted-foreground text-xs">发起成功后请在下方操作卡片内执行产品组长确认/驳回。</p>
            </template>
          </Alert>

          <Card v-if="coefResult" class="mt-3" title="产品组长决策（针对上方变更单）">
            <template v-if="!coefDecisionResult">
              <Alert
                class="mb-3"
                message="由产品组长或超级管理员执行；确认通过后写入项目档案；重复处理将由后端按 409 状态冲突裁决。"
                show-icon
                type="info"
              />
              <Form layout="horizontal" :label-col="{ style: { width: '110px' } }">
                <FormItem label="决策" required>
                  <RadioGroup v-model:value="coefDecision.approve">
                    <Radio :value="true">确认通过</Radio>
                    <Radio :value="false">驳回</Radio>
                  </RadioGroup>
                </FormItem>
                <FormItem label="决策意见">
                  <Textarea
                    v-model:value="coefDecision.opinion"
                    :maxlength="500"
                    :rows="3"
                    placeholder="选填，不超过 500 字"
                    show-count
                  />
                </FormItem>
                <FormItem label=" " :colon="false">
                  <Space>
                    <Button :loading="coefDecisionSubmitting" type="primary" @click="submitCoefDecision">提交决策</Button>
                  </Space>
                </FormItem>
              </Form>
              <Alert v-if="coefDecisionError" class="mt-2" show-icon type="error" role="alert" :message="coefDecisionError" />
            </template>
            <template v-else>
              <Descriptions :column="2" size="small" bordered>
                <DescriptionsItem label="变更单 ID">{{ coefDecisionResult.id }}</DescriptionsItem>
                <DescriptionsItem label="状态">{{ statusText(coefDecisionResult.status) }}</DescriptionsItem>
                <DescriptionsItem label="组长决策">{{ decisionText(coefDecisionResult.leaderDecision) }}</DescriptionsItem>
                <DescriptionsItem label="决策时间">
                  {{ coefDecisionResult.leaderDecidedAt ? coefDecisionResult.leaderDecidedAt.replace('T', ' ') : PENDING_TEXT }}
                </DescriptionsItem>
                <DescriptionsItem label="决策意见" :span="2">
                  {{ coefDecisionResult.leaderOpinion || PENDING_TEXT }}
                </DescriptionsItem>
              </Descriptions>
            </template>
          </Card>
        </Card>
      </TabPane>

      <TabPane key="launch-date" tab="上市日期变更">
        <Card title="发起上市日期变更（双签）">
          <Alert
            class="mb-4"
            message="上市日期变更须双签：一方提议后，由另一侧PM确认写入项目档案，禁止单方面修改。"
            show-icon
            type="info"
          />
          <Form layout="horizontal" :label-col="{ style: { width: '130px' } }">
            <FormItem label="建议上市日期" required>
              <DatePicker
                v-model:value="launchForm.proposedLaunchDate"
                value-format="YYYY-MM-DD"
                style="width: 200px"
              />
            </FormItem>
            <FormItem label="变更原因" required>
              <Textarea
                v-model:value="launchForm.reason"
                :maxlength="500"
                :rows="4"
                placeholder="请说明日期调整依据"
                show-count
              />
            </FormItem>
            <FormItem label=" " :colon="false">
              <Button :loading="launchSubmitting" type="primary" @click="submitLaunchDate">提交上市日期变更申请</Button>
            </FormItem>
          </Form>
          <Alert v-if="launchError" class="mt-2" show-icon type="error" role="alert" :message="launchError" />
          <Alert v-if="launchResult" class="mt-2" show-icon type="success">
            <template #message>上市日期变更申请已提交</template>
            <template #description>
              <p>变更单 ID：{{ launchResult.id }}</p>
              <p>状态：{{ statusText(launchResult.status) }}</p>
              <p>原上市日期：{{ launchResult.previousLaunchDate ? launchResult.previousLaunchDate.slice(0, 10) : PENDING_TEXT }}</p>
              <p class="text-muted-foreground text-xs">发起成功后请在下方操作卡片内执行第二签（另一侧PM）。</p>
            </template>
          </Alert>

          <Card v-if="launchResult" class="mt-3" title="第二签确认（针对上方变更单）">
            <template v-if="!launchDecisionResult">
              <Alert
                class="mb-3"
                message="由另一侧PM（与发起方不同角色）确认；提议方不可自签；重复处理将由后端按 409 状态冲突裁决。"
                show-icon
                type="info"
              />
              <Form layout="horizontal" :label-col="{ style: { width: '110px' } }">
                <FormItem label="决策" required>
                  <RadioGroup v-model:value="launchDecision.approve">
                    <Radio :value="true">确认通过</Radio>
                    <Radio :value="false">驳回</Radio>
                  </RadioGroup>
                </FormItem>
                <FormItem label="决策意见">
                  <Textarea
                    v-model:value="launchDecision.opinion"
                    :maxlength="500"
                    :rows="3"
                    placeholder="选填，不超过 500 字"
                    show-count
                  />
                </FormItem>
                <FormItem label=" " :colon="false">
                  <Space>
                    <Button :loading="launchDecisionSubmitting" type="primary" @click="submitLaunchDecision">提交第二签</Button>
                  </Space>
                </FormItem>
              </Form>
              <Alert v-if="launchDecisionError" class="mt-2" show-icon type="error" role="alert" :message="launchDecisionError" />
            </template>
            <template v-else>
              <Descriptions :column="2" size="small" bordered>
                <DescriptionsItem label="变更单 ID">{{ launchDecisionResult.id }}</DescriptionsItem>
                <DescriptionsItem label="状态">{{ statusText(launchDecisionResult.status) }}</DescriptionsItem>
                <DescriptionsItem label="第二签决策">{{ decisionText(launchDecisionResult.decision) }}</DescriptionsItem>
                <DescriptionsItem label="确认时间">
                  {{ launchDecisionResult.confirmedAt ? launchDecisionResult.confirmedAt.replace('T', ' ') : PENDING_TEXT }}
                </DescriptionsItem>
                <DescriptionsItem label="决策意见" :span="2">
                  {{ launchDecisionResult.opinion || PENDING_TEXT }}
                </DescriptionsItem>
              </Descriptions>
            </template>
          </Card>
        </Card>
      </TabPane>

      <TabPane key="requirement" tab="需求变更（双签）">
        <Card title="发起需求变更（双签否决：BR-GATE-07）">
          <Alert
            class="mb-4"
            message="需求变更双签：创建草稿 → 提交双签 → 对方/产品组长签署。单方 REJECT 即整体否决。变更类型与原因必须非空，前后快照为选填（JSON/纯文本皆可，提交双签前服务端要求非空）。"
            show-icon
            type="info"
          />
          <Form layout="horizontal" :label-col="{ style: { width: '120px' } }">
            <FormItem label="需求编号" required>
              <Input v-model:value="reqForm.requirementId" placeholder="需求 ID（纯数字）" style="width: 280px" />
            </FormItem>
            <FormItem label="变更类型" required>
              <Select v-model:value="reqForm.changeType" placeholder="选择变更类型" style="width: 200px" allow-clear>
                <SelectOption v-for="opt in CHANGE_TYPE_OPTIONS" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </SelectOption>
              </Select>
            </FormItem>
            <FormItem label="变更原因" required>
              <Textarea
                v-model:value="reqForm.reason"
                :maxlength="500"
                :rows="3"
                placeholder="请说明变更缘由"
                show-count
              />
            </FormItem>
            <FormItem label="原状快照">
              <Textarea
                v-model:value="reqForm.beforeSnapshot"
                :rows="2"
                placeholder="变更前需求快照（选填）"
              />
            </FormItem>
            <FormItem label="目标快照">
              <Textarea
                v-model:value="reqForm.afterSnapshot"
                :rows="2"
                placeholder="变更后需求快照（选填）"
              />
            </FormItem>
            <FormItem label=" " :colon="false">
              <Button :loading="reqSubmitting" type="primary" @click="submitRequirement">创建变更草稿</Button>
            </FormItem>
          </Form>
          <Alert v-if="reqError" class="mt-2" show-icon type="error" role="alert" :message="reqError" />
          <Alert v-if="reqResult && reqResult.status === 'DRAFT'" class="mt-2" show-icon type="success">
            <template #message>变更单草稿已创建</template>
            <template #description>
              <p>变更单 ID：{{ reqResult.id }}</p>
              <p>状态：{{ statusLabelFor(reqResult.status) }}</p>
              <p class="text-muted-foreground text-xs">点击下方「提交双签」进入 PENDING_SIGN，等待对方/产品组长签署。</p>
            </template>
          </Alert>
          <Alert v-if="reqResult && reqResult.status === 'PENDING_SIGN'" class="mt-2" show-icon type="success">
            <template #message>变更单已提交双签</template>
            <template #description>
              <p>变更单 ID：{{ reqResult.id }}</p>
              <p>状态：{{ statusLabelFor(reqResult.status) }}</p>
              <p class="text-muted-foreground text-xs">请在下方签署区选择「通过/驳回」完成签署。</p>
            </template>
          </Alert>

          <Card v-if="reqResult && reqResult.status !== 'APPROVED' && reqResult.status !== 'REJECTED'" class="mt-3" :title="reqResult.status === 'DRAFT' ? '提交双签（DRAFT → PENDING_SIGN）' : '签署决策（PENDING_SIGN）'">
            <template v-if="reqResult.status === 'DRAFT'">
              <Button :loading="reqDecisionSubmitting" type="primary" @click="submitReqSign">提交双签</Button>
            </template>
            <template v-else-if="reqResult.status === 'PENDING_SIGN'">
              <Form layout="horizontal" :label-col="{ style: { width: '110px' } }">
                <FormItem label="决策" required>
                  <RadioGroup v-model:value="reqDecision.approve">
                    <Radio :value="true">通过</Radio>
                    <Radio :value="false">驳回</Radio>
                  </RadioGroup>
                </FormItem>
                <FormItem label="签署意见">
                  <Textarea
                    v-model:value="reqDecision.opinion"
                    :maxlength="500"
                    :rows="3"
                    placeholder="选填，不超过 500 字"
                    show-count
                  />
                </FormItem>
                <FormItem label=" " :colon="false">
                  <Button :loading="reqDecisionSubmitting" type="primary" @click="submitReqSign">提交签署</Button>
                </FormItem>
              </Form>
            </template>
            <Alert v-if="reqDecisionError" class="mt-2" show-icon type="error" role="alert" :message="reqDecisionError" />
          </Card>

          <Card v-if="reqDecisionResult" class="mt-3" title="签署结果">
            <Descriptions :column="2" size="small" bordered>
              <DescriptionsItem label="变更单 ID">{{ reqDecisionResult.id }}</DescriptionsItem>
              <DescriptionsItem label="状态">
                <Tag :color="statusToneFor(reqDecisionResult.status)">{{ statusLabelFor(reqDecisionResult.status) }}</Tag>
              </DescriptionsItem>
              <DescriptionsItem label="变更原因" :span="2">{{ reqDecisionResult.reason || PENDING_TEXT }}</DescriptionsItem>
              <DescriptionsItem label="更新时间" :span="2">{{ reqDecisionResult.updateTime || PENDING_TEXT }}</DescriptionsItem>
            </Descriptions>
          </Card>
        </Card>

        <Card class="mt-4" title="本项目需求变更单列表">
          <template #extra>
            <Button :loading="reqListLoading" size="small" @click="loadReqList">刷新</Button>
          </template>
          <Table
            :columns="reqListColumns"
            :data-source="reqList"
            :loading="reqListLoading"
            :pagination="false"
            row-key="id"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <Tag :color="statusToneFor(record.status)">{{ statusLabelFor(record.status) }}</Tag>
              </template>
              <template v-else-if="column.key === 'createTime'">
                {{ record.createTime ? record.createTime.replace('T', ' ') : PENDING_TEXT }}
              </template>
            </template>
            <template #emptyText>
              <Empty :description="reqListError || '该项目暂无需求变更单'" />
            </template>
          </Table>
        </Card>
      </TabPane>
    </Tabs>
  </div>
</template>
