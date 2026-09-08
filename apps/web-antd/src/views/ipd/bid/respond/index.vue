<template>
  <div class="mx-auto max-w-[760px] p-4">
    <!-- 加载态 -->
    <Card v-if="loading">
      <Spin class="flex justify-center py-12" />
    </Card>

    <template v-else>
      <!-- 断网 / 拒绝态 -->
      <Alert
        v-if="loadError"
        class="mb-4"
        :message="ipdErrorText(loadError, { domain: 'bid', fallback: '招标单加载失败，请稍后重试', codeTexts: { 50001: '招标单不存在或已被删除', 90001: '招标单不存在或服务暂时不可用，请稍后重试' } })"
        type="error"
        show-icon
        role="alert"
      >
        <template #description>
          <Button size="small" @click="load">重新加载</Button>
          <Button size="small" type="link" @click="goBack">返回招标单列表</Button>
        </template>
      </Alert>

      <Alert v-else-if="!bidId" class="mb-4" message="缺少招标单标识，请从招标单列表进入。" type="warning" show-icon>
        <template #description>
          <Button size="small" @click="goBack">返回招标单列表</Button>
        </template>
      </Alert>

      <!-- 提交/拒绝/撤回操作的拒绝/断网态 -->
      <Alert
        v-else-if="actionError"
        class="mb-4"
        :message="actionError"
        type="error"
        show-icon
        role="alert"
      />

      <!-- ZK-IPD §四.1 应标业务规则提示（BR-TEAM-03 拒绝不留痕） -->
      <Alert
        v-if="!invitation"
        class="mb-4"
        type="info"
        show-icon
        message="ZK-IPD 应标规则"
        :description="respondRules"
      />

      <template v-if="invitation">
        <Card class="mb-4">
          <template #title>{{ invitation.title || '待补充' }}</template>
          <Descriptions :column="1" size="small">
            <Descriptions.Item label="状态">
              <Tag :color="bidStatusColor(invitation.status)">{{ bidStatusText(invitation.status) }}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="招标方式">{{ bidModeText(invitation.mode) }}</Descriptions.Item>
            <Descriptions.Item label="有效期至">{{ bidTimeText(invitation.expireAt) }}</Descriptions.Item>
          </Descriptions>
          <h4 class="mt-3 mb-1 font-medium">招标内容</h4>
          <p class="whitespace-pre-wrap">{{ invitation.content || '待补充' }}</p>
        </Card>

        <!-- 发起人视角提示：应标编辑器仅面向受邀研发PM -->
        <Alert
          v-if="isCreatorView"
          class="mb-4"
          message="您是本招标单的发起人，发起人不参与应标。"
          type="info"
          show-icon
        >
          <template #description>
            <Button size="small" type="primary" @click="goSelect">前往遴选页查看全部应标</Button>
          </template>
        </Alert>

        <template v-else>
          <!-- 不可应标说明（权限边界可见，不隐藏原因） -->
          <Alert v-if="!canRespond" class="mb-4" :message="cannotRespondReason" type="info" show-icon />

          <!-- 我的应标状态 -->
          <Card v-if="latestMine" class="mb-4" title="我的应标">
            <template #extra>
              <Tag :color="bidResponseStatusColor(latestMine.status)">{{ bidResponseStatusText(latestMine.status) }}</Tag>
            </template>
            <p v-if="latestMine.respondedAt" class="text-muted-foreground text-xs">应标时间：{{ bidTimeText(latestMine.respondedAt) }}</p>
            <p class="mt-1 whitespace-pre-wrap">{{ latestMine.responseNote || '待补充' }}</p>
            <Popconfirm
              v-if="latestMine.status === 'PENDING' && invitation.status === 'OPEN'"
              title="确认撤回应标？撤回后可重新提交。"
              @confirm="doWithdraw"
            >
              <Button class="mt-2" size="small" danger :loading="withdrawBusy">撤回应标</Button>
            </Popconfirm>
          </Card>

          <!-- 拒绝成功后的确认视图（拒绝不留痕：重新加载后无应标行） -->
          <Alert
            v-else-if="rejectedLocal"
            class="mb-4"
            message="您已拒绝本招标单的应标邀请（拒绝不留痕，系统未保留任何记录）。如改变主意，可在招标有效期内重新提交应标。"
            type="success"
            show-icon
          />

          <!-- 应标编辑器：仅招标中 + 受邀研发PM 时渲染（spec 页21 / BR-REC-BID-01） -->
          <Card v-if="canRespond" title="我的密封应标" class="mb-4">
            <template #extra>
              <span class="text-muted-foreground text-xs">密封应标：仅招标发起人可见，其他候选人不可见</span>
            </template>
            <p class="text-muted-foreground mb-4 text-xs">
              同一招标单仅保留您最新一份有效应标，重复提交将覆盖原内容；提交后等待发起人遴选。
            </p>

            <Form layout="vertical">
              <Form.Item
                label="方案摘要"
                required
                :validate-status="errors.plan ? 'error' : ''"
                :help="errors.plan"
              >
                <Textarea
                  v-model:value="form.plan"
                  :rows="5"
                  placeholder="请阐述技术方案与实现思路（不少于 40 字）"
                  :disabled="submitBusy"
                />
              </Form.Item>
              <Form.Item
                label="预计周期（天）"
                required
                :validate-status="errors.estimatedDays ? 'error' : ''"
                :help="errors.estimatedDays"
              >
                <InputNumber
                  v-model:value="estimatedDaysModel"
                  :min="1"
                  :max="365"
                  :precision="0"
                  :disabled="submitBusy"
                />
              </Form.Item>
              <Form.Item
                label="资源投入"
                required
                :validate-status="errors.resourceCommitment ? 'error' : ''"
                :help="errors.resourceCommitment"
              >
                <Textarea
                  v-model:value="form.resourceCommitment"
                  :rows="2"
                  :maxlength="200"
                  show-count
                  placeholder="请说明可投入的人力与排期（1-200 字）"
                  :disabled="submitBusy"
                />
              </Form.Item>
              <Form.Item
                label="主要风险"
                required
                :validate-status="errors.majorRisks ? 'error' : ''"
                :help="errors.majorRisks"
              >
                <Textarea
                  v-model:value="form.majorRisks"
                  :rows="3"
                  placeholder="请说明主要交付风险（不少于 20 字）"
                  :disabled="submitBusy"
                />
              </Form.Item>

              <p :class="['mb-3 text-xs', noteOverflow ? 'text-destructive' : 'text-muted-foreground']">
                提交说明合计 {{ noteLength }} 字（后端限制 40-500 字；预计周期、资源投入与主要风险将拼入说明文本）。
              </p>
              <Alert
                v-if="errors.noteTotal"
                class="mb-3"
                :message="errors.noteTotal"
                type="error"
                show-icon
              />

              <div class="flex gap-2">
                <Button type="primary" :loading="submitBusy" @click="doAccept">提交应标</Button>
                <Popconfirm
                  title="拒绝后不留任何应标记录，也不通知发起人（拒绝不留痕）。确认拒绝？"
                  @confirm="doReject"
                >
                  <Button danger :disabled="submitBusy" :loading="rejectBusy">拒绝应标</Button>
                </Popconfirm>
              </div>
            </Form>
          </Card>
        </template>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
// 页21 应标（看板卡 P0-10.21；后端 P2-3.2 已交付）。
// 契约差异对齐（docs/ipd-系统说明/前端对接/页21-应标-后端API契约-20260905.md）：
// - D-1 提交路径：POST /bid-responses（invitationId 入请求体）；
// - D-2 状态机错误码：50002（非 spec 的 40001）；
// - D-3~D-5：预计周期/资源投入/主要风险无独立通道，拼入 responseNote 文本；
// - D-6：reconfirm 未实现，40002 分支仅做文案兜底，不阻塞主流程；
// - D-7：solution_summary 映射 responseNote（40-500 字）；
// - U1-4（20260906 蜂群快修登记）：模板 v-else-if="invitation" 双用互斥致正文 Card
//   不渲染 → 改 v-if="!invitation"（规则提示）/ v-if="invitation"（正文）两支（提交 005986b）。
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  message,
  Popconfirm,
  Spin,
  Tag,
} from 'ant-design-vue';
import {
  getBidInvitation,
  listBidResponses,
  submitBidResponse,
  withdrawBidResponse,
} from '../../../../api/ipd/bid';
import type { BidInvitation, BidResponse } from '../../../../api/ipd/bid';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import {
  bidModeText,
  bidResponseStatusColor,
  bidResponseStatusText,
  bidStatusColor,
  bidStatusText,
  bidTimeText,
  composeResponseNote,
  validateRespondForm,
} from '../bid-display';
import { RULES_BY_PAGE, renderRulesDescription } from '../../_shared/zk-ipd-rules';

const route = useRoute();
const router = useRouter();
const respondRules = computed(() => renderRulesDescription(RULES_BY_PAGE.bidRespond));
const auth = useIpdAuthStore();
const Textarea = Input.TextArea;

const loading = ref(false);
const loadError = ref<unknown>(null);
const invitation = ref<BidInvitation | null>(null);
const responses = ref<BidResponse[]>([]);
const rejectedLocal = ref(false);
const submitBusy = ref(false);
const rejectBusy = ref(false);
const withdrawBusy = ref(false);
const actionError = ref('');

const form = reactive({
  plan: '',
  estimatedDays: 90 as null | number,
  resourceCommitment: '',
  majorRisks: '',
});

/** InputNumber 不收 null：与 form.estimatedDays（null|number）双向适配。 */
const estimatedDaysModel = computed<number | string | undefined>({
  get: () => (form.estimatedDays == null ? undefined : form.estimatedDays),
  set: (value) => {
    form.estimatedDays = value == null || value === '' ? null : Number(value);
  },
});
const errors = reactive({
  plan: '',
  estimatedDays: '',
  resourceCommitment: '',
  majorRisks: '',
  noteTotal: '',
});

const bidId = computed(() => {
  const raw = route.params.bidId;
  return (Array.isArray(raw) ? raw[0] : raw) ?? '';
});

const myId = computed(() => auth.identity?.person.id ?? '');
const isRdPm = computed(() => auth.identity?.person.personType === 'RD_PM');

/** 发起人视角：会话用户是招标单创建人（后端 responses 将返回全量，编辑器不适用）。 */
const isCreatorView = computed(() => !!invitation.value && !!myId.value && String(invitation.value.createBy ?? '') === myId.value);

/** spec 页21：编辑器仅当招标中 && 受邀时渲染；受邀 = 公开征集 或 定向邀请本人。 */
const invited = computed(() => {
  if (!invitation.value) return false;
  return invitation.value.mode === 'PUBLIC' || String(invitation.value.targetPersonId ?? '') === myId.value;
});
const canRespond = computed(() =>
  !!invitation.value && invitation.value.status === 'OPEN' && isRdPm.value && invited.value && !rejectedLocal.value,
);

const cannotRespondReason = computed(() => {
  if (!invitation.value) return '';
  if (invitation.value.status !== 'OPEN') {
    return `本招标单当前状态为「${bidStatusText(invitation.value.status)}」，不再接受应标。`;
  }
  if (!isRdPm.value) return '应标人限定为研发PM，当前账号暂不能应标。';
  if (!invited.value) return '本招标单为定向邀请，您不在邀请名单内。';
  if (rejectedLocal.value) return '您已拒绝本次应标。';
  return '当前不满足应标条件。';
});

/** 列表按创建时间倒序返回，首行即本人最新应标。 */
const latestMine = computed(() => (!isCreatorView.value ? responses.value[0] ?? null : null));

const noteLength = computed(() => composeResponseNote(form).length);
const noteOverflow = computed(() => noteLength.value > 500);

function goBack(): void {
  router.push('/ipd/bids');
}

function goSelect(): void {
  router.push(`/ipd/bids/${bidId.value}/select`);
}

async function load(): Promise<void> {
  if (!bidId.value) return;
  loading.value = true;
  loadError.value = null;
  try {
    const [invitationData, responseData] = await Promise.all([
      getBidInvitation(bidId.value),
      listBidResponses(bidId.value),
    ]);
    invitation.value = invitationData;
    // 隐私过滤在后端：非发起人仅返回本人应标（BidInvitationService#listResponses）。
    responses.value = responseData ?? [];
  } catch (cause) {
    loadError.value = cause;
  } finally {
    loading.value = false;
  }
}

async function doAccept(): Promise<void> {
  if (submitBusy.value) return;
  const found = validateRespondForm(form);
  errors.plan = found.plan ?? '';
  errors.estimatedDays = found.estimatedDays ?? '';
  errors.resourceCommitment = found.resourceCommitment ?? '';
  errors.majorRisks = found.majorRisks ?? '';
  errors.noteTotal = found.noteTotal ?? '';
  if (Object.keys(found).length > 0) {
    actionError.value = '';
    return;
  }
  submitBusy.value = true;
  actionError.value = '';
  try {
    await submitBidResponse({
      decision: 'accept',
      invitationId: bidId.value,
      responseNote: composeResponseNote(form),
    });
    message.success('应标已提交，等待招标发起人遴选');
    await load();
  } catch (cause) {
    actionError.value = ipdErrorText(cause, { domain: 'bid',
      fallback: '应标提交失败，请稍后重试',
      codeTexts: {
        10001: '应标说明须为 40-500 字，请调整后重试',
        30001: '您不在本招标单的邀请名单内，无法应标',
        40002: '招募条件已变更，请确认新条件后重新提交',
        50002: '招标单已遴选或已关闭，不再接受应标，请刷新后查看',
        90001: '服务暂时不可用，请稍后重试',
      },
    });
  } finally {
    submitBusy.value = false;
  }
}

/** 拒绝不留痕（BR-TEAM-03）：成功判定只看 code=0，不检查 data 非空。 */
async function doReject(): Promise<void> {
  if (rejectBusy.value) return;
  rejectBusy.value = true;
  actionError.value = '';
  try {
    await submitBidResponse({ decision: 'reject', invitationId: bidId.value });
    message.success('已拒绝本次应标，系统未保留任何记录');
    rejectedLocal.value = true;
    await load();
  } catch (cause) {
    actionError.value = ipdErrorText(cause, { domain: 'bid',
      fallback: '操作失败，请稍后重试',
      codeTexts: { 30001: '您不在本招标单的邀请名单内' },
    });
  } finally {
    rejectBusy.value = false;
  }
}

async function doWithdraw(): Promise<void> {
  if (!latestMine.value || withdrawBusy.value) return;
  withdrawBusy.value = true;
  actionError.value = '';
  try {
    await withdrawBidResponse(latestMine.value.id);
    message.success('应标已撤回，可重新提交');
    await load();
  } catch (cause) {
    actionError.value = ipdErrorText(cause, { domain: 'bid',
      fallback: '撤回失败，请稍后重试',
      codeTexts: {
        30001: '仅应标本人可撤回',
        50002: '该应标当前状态不允许撤回，请刷新后查看',
      },
    });
  } finally {
    withdrawBusy.value = false;
  }
}

onMounted(load);
</script>
