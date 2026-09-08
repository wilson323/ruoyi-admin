<script setup lang="ts">
/**
 * 页25 项目详情-需求与变更（看板卡 P0-10.25）。
 *
 * 真实交付（POST 写端点）：
 * - POST /api/v1/coefficient-change-requests            系数变更双PM 联合提议
 * - POST /api/v1/coefficient-change-requests/{id}/leader-decision  产品组长确认/驳回
 * - POST /api/v1/launch-date-change-requests            上市日期变更第一签提议
 * - POST /api/v1/launch-date-change-requests/{id}/second-decision  另一侧PM 第二签
 * 未交付（挂占位，G-06 不展示任何模拟数据）：
 * - 两类变更单的 GET 列表/详情读端点；
 * - 需求变更（RequirementChange 双签，P2-6.1/6.2）后端无 controller/service。
 *
 * 决策操作内联到发起成功卡内：发起后按返回的申请 ID 直接做确认/驳回（approve 走 query 串），
 * 无需导航到独立详情页（详情读端点未交付，空壳详情页不可用）。
 */
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  DescriptionsItem,
  Form,
  FormItem,
  Input,
  InputNumber,
  Radio,
  RadioGroup,
  Space,
  TabPane,
  Tabs,
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
  decideCoefficientChange,
  decideLaunchDateChange,
  proposeCoefficientChange,
  proposeLaunchDateChange,
} from '../../../../api/ipd/change';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { COEF_CHANGE_STATUS_TEXT, DECISION_LABEL } from '../../_shared/ipd-enums';

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
        <BackendPending
          backend="P2-6.1 / P2-6.2 未开始（RequirementChange 仅有 domain 类，无 controller/service）"
          card="P0-10.25"
          note="需求变更类目整类等待后端交付；交付后将按需求变更双签（BR-GATE-07 五节点决策链）实现。"
        />
      </TabPane>
    </Tabs>
  </div>
</template>
