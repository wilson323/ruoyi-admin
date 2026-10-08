<!--
  五大关键联合 Gate 评审面板（原型 /reviews KeyGatePanel 复刻 + 后端契约适配）—— P2-5.2/5.4/5.5

  一比一部分：section-title「五大关键联合 Gate」标题/副标题/「双PM否决项不可管理覆盖」、
  卡片 header（Gate 编号 · 第 N 轮 · 双签/主导方）+ 状态 pill + mini-chain 双签行 +
  footer 操作按钮语义（签署通过/驳回/整改后重开/仲裁/终裁/延期）。

  必要适配（原型 /api/key-gates 与后端 /api/v1/gates/{gateId} 不同构，逐条登记）：
  1. 原型为项目维度 Gate 列表（/api/key-gates?projectId=）；后端无项目级 Gate 列表
     端点，Gate 评审经 Gate 编号定位（审计/通知侧提供编号）。
  2. 原型材料归档（会议纪要/评审材料 FormData 上传）与协作决策链（旧「五节点顺序签署链」口径已废止）后端未交付，
     维持真缺口登记，不做假数据。
  3. 后端双签轮次制已交付：盲签视图（在途互盲仅"对方已提交"）、签署（每方每轮一条，
     任一 REJECT ⇒ REJECTED）、reopen（round+1，第 3 轮组长列席）、超管延期（最多 3 次）、
     组长仲裁、超管终裁——按 GateReviewController 契约 1:1 渲染（仲裁/终裁按后端受理状态
     REJECTED 显示，2026-10-07 P0 修复：旧实现挂在 PENDING 上导致驳回后无有效入口）。
  4. Gate 要素判定（[CONSISTENCY-4] 蜂群审计线1）：
     - 层1：countVetoFailures 控提交按钮 disabled（硬阻断 is_veto+FAIL）；
     - 层2：每要素 PASS / FAIL / 条件通过 三选一 + 条件项必填 closeDeadline+responsiblePersonId；
     - 层3：逐项调 submitGateElementResult 提交判定结果；
     - 层4：提交前预检查 + 红字提示（否决项 FAIL 阻断、必填项缺失）。
  5. R212 ORPHAN-A1（2026-09-24）：POST /gates/{gateId}/submit 接线——「提交评审结论」
     按钮此前仅做前端预检查未发请求。后端 [SEC-FIX-HIGH-1.1-FOLLOWUP] 契约要求
     materialsOssId + meetingMinutesOssId 必填（Long，服务端按 ossId 解析 URL，禁外部
     URL 防 SSRF）；文件上传入口仍是已登记真缺口，本面板收 OSS ID 数字串手输。
-->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

import { message } from 'ant-design-vue';
import { SafetyOutlined } from '@ant-design/icons-vue';

import { useIpdAuthStore } from '../../../store/ipd-auth';
import { formatDateTime } from '../_shared/format';
import { ipdErrorText } from '../_shared/ipd-error-text';
import AiSuggest from '../_shared/ai-suggest.vue';
import {
  arbitrateGate,
  extendGateDeadline,
  finalRulingGate,
  getGateReview,
  reopenGate,
  signGate,
  type GateDecision,
  type GateReviewView,
  type GateStatus,
} from '../../../api/ipd/gate-review';
import {
  countVetoFailures,
  getFallbackGateElements,
  isFallbackElement,
  listGateElementViews,
  storedElementResult,
  submitGateElementResult,
  submitGateReview,
  type GateElementResult,
  type IpdGateElementView,
} from '../../../api/ipd/gate-element-result';
import { downloadGateMaterial, uploadGateMaterial } from '../../../api/ipd/gate-material';
import type { IpdContentViewPayload } from '../_shared/ipd-content-view/ipd-content-view';
import IpdContentView from '../_shared/ipd-content-view/ipd-content-view.vue';
import {
  runArbitrationDivergences,
  runGatePrecheck,
  type GateArbitrationDivergencesView,
  type GatePrecheckItemStatus,
  type GatePrecheckView,
} from '../../../api/ipd/gate-precheck';
import { IPD_PERMISSION_CODES } from '../_shared/ipd-permission-codes';

const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
const isSuperAdmin = computed(() => personType.value === 'SUPER_ADMIN');
const isLeader = computed(() => personType.value === 'GROUP_LEADER');

/**
 * 可选初始 Gate 编号（R30 项目维度列表接线）：外部列表页选中后直接打开评审，
 * 免二次手输；不传时行为不变（review 页自输）。
 */
const props = defineProps<{ initialGateId?: null | string }>();

const gateIdInput = ref(props.initialGateId?.trim() ?? '');
const loading = ref(false);
const loadError = ref('');
const busy = ref(false);
const actionError = ref('');
const opinion = ref('');
const view = ref<null | GateReviewView>(null);

/** Gate 要素判定（[CONSISTENCY-4] 层1/层2/层3/层4）。 */
const elements = ref<IpdGateElementView[]>([]);
const elementsLoading = ref(false);
const elementsError = ref('');
/** 当前要素列表是否来自静态回退（API 失败/0 项时为 true；UI 显示 stale 标记）。 */
const elementsIsFallback = ref(false);
/** elementId → { result, closeDeadline, responsiblePersonId } 草稿态。
 *  verifications / writtenIntents 仅 G1-1 有意义（后端 verifyCustomerEvidence 校验），其余要素留空串。 */
const draftResults = reactive<Record<string, { closeDeadline: string; conditionNote: string; responsiblePersonId: string; result: GateElementResult | ''; verifications: string; writtenIntents: string }>>({});
/** 已成功提交到后端的 elementId → result（用于 countVetoFailures）。 */
const committedResults = reactive<Record<string, GateElementResult>>({});
const submittingElementId = ref('');

/** 后端 Gate 状态 → 原型 status-pill 文案。 */
const statusText: Record<GateStatus, string> = {
  ABSTAINED_TIMEOUT: '超时弃权',
  APPROVED: '已通过',
  PENDING: '流转中',
  REJECTED: '已驳回',
};

const reviewerText: Record<string, string> = {
  GROUP_LEADER: '产品组长',
  MARKET_PM: '市场PM',
  RD_PM: '研发PM',
  SUPER_ADMIN: '超级管理员',
};

const statusClass = computed(() => view.value?.status.toLowerCase().replaceAll('_', '-') ?? '');
const decisionText = (value?: string) =>
  value === 'APPROVE' ? '通过' : value === 'REJECT' ? '驳回' : (value ?? '—');
const reviewerName = (value: string) => reviewerText[value] ?? value;

/** 签署按钮：在途且本轮未签（超管走终裁/延期，不出现在签署位）。 */
const canSign = computed(
  () => view.value?.status === 'PENDING' && !view.value.my && !isSuperAdmin.value,
);
/** 否决后重开（AC-GATE-06）。 */
const canReopen = computed(() => view.value?.status === 'REJECTED');
/** 延期：仅超管，最多 3 次（AC-GATE-21）。 */
const canExtend = computed(
  () => view.value?.status === 'PENDING' && isSuperAdmin.value && (view.value.extensionCount ?? 0) < 3,
);

/** 层1：否决项 FAIL 数（草稿 + 已提交均计入；>0 则提交按钮硬阻断）。 */
const vetoFailureCount = computed(() => {
  const merged: Record<string, GateElementResult> = { ...committedResults };
  for (const [id, draft] of Object.entries(draftResults)) {
    if (draft.result) merged[id] = draft.result;
  }
  return countVetoFailures(elements.value, new Map(Object.entries(merged)));
});

/** 层4：要素判定预检查结果（缺失必填 / 否决项失败）。 */
const elementValidation = computed(() => {
  const missing: string[] = [];
  for (const el of elements.value) {
    const draft = draftResults[el.elementId];
    if (!draft || !draft.result) continue;
    if (draft.result === 'CONDITIONAL') {
      if (!draft.responsiblePersonId.trim()) missing.push(`${el.elementName}：条件通过必填责任人`);
      if (!draft.closeDeadline.trim()) missing.push(`${el.elementName}：条件通过必填关闭期限`);
    }
  }
  return missing;
});

const canSubmitElements = computed(() => {
  if (!view.value || view.value.status !== 'PENDING') return false;
  if (elementsIsFallback.value) return false;
  if (vetoFailureCount.value > 0) return false;
  if (elementValidation.value.length > 0) return false;
  return elements.value.length > 0;
});

/** R212 ORPHAN-A1：强制输出物 OSS ID（后端 submit 必填；纯数字校验，空/非法禁用提交）。 */
const materialsOssId = ref('');
const meetingMinutesOssId = ref('');
/** 文档预览 G4（2026-10-08）：上传后记录文件名，供统一预览查看/下载。 */
const materialsFileName = ref('');
const minutesFileName = ref('');
const materialViewOpen = ref(false);
const materialViewPayload = ref<IpdContentViewPayload | null>(null);
const submitBusy = ref(false);
const submitError = ref('');

const isDigits = (v: string): boolean => /^\d+$/.test(v.trim());

/** submit 可用：要素预检查通过 + 双 OSS ID 均为合法数字串。 */
const canSubmitReview = computed(
  () => canSubmitElements.value && isDigits(materialsOssId.value) && isDigits(meetingMinutesOssId.value),
);

/** 提交评审结论（POST /submit）：全要素已判+否决阻断由后端二次守卫，前端先做硬阻断。 */
async function submitReview(): Promise<void> {
  if (!view.value || !canSubmitReview.value || submitBusy.value) return;
  submitBusy.value = true;
  submitError.value = '';
  try {
    const result = await submitGateReview(view.value.gateId, {
      materialsOssId: materialsOssId.value.trim(),
      meetingMinutesOssId: meetingMinutesOssId.value.trim(),
    });
    message.success(
      `评审已提交（${result.gateCode} · 快照${result.snapshotFrozen ? '已冻结' : '未冻结'}），进入签署流程`,
    );
    view.value = await getGateReview(view.value.gateId);
  } catch (cause) {
    submitError.value = ipdErrorText(cause, { fallback: '评审提交失败' });
  } finally {
    submitBusy.value = false;
  }
}

/** AI-P2-1：材料 AI 预审（POST /gates/{gateId}/precheck；只读参考，不写 Gate 决策、不阻塞评审）。 */
const precheckBusy = ref(false);
const precheckError = ref('');
const precheckResult = ref<null | GatePrecheckView>(null);

const precheckStatusText: Record<GatePrecheckItemStatus, string> = {
  COVERED: '已覆盖',
  MISSING: '缺失',
  PARTIAL: '部分',
};

async function runPrecheck(): Promise<void> {
  if (!view.value || precheckBusy.value) return;
  precheckBusy.value = true;
  precheckError.value = '';
  try {
    precheckResult.value = await runGatePrecheck(view.value.gateId);
  } catch (cause) {
    precheckResult.value = null;
    precheckError.value = ipdErrorText(cause, { fallback: 'AI 预审失败，请稍后重试' });
  } finally {
    precheckBusy.value = false;
  }
}

/** AI-P2-1 R240：仲裁分歧点汇总（POST /gates/{gateId}/arbitration-divergences；AI 只归纳不裁决）。 */
const arbitrationBusy = ref(false);
const arbitrationError = ref('');
const arbitrationResult = ref<null | GateArbitrationDivergencesView>(null);

const arbitrationDecisionText: Record<string, string> = {
  APPROVE: '同意',
  REJECT: '驳回',
};

async function runArbitration(): Promise<void> {
  if (!view.value || arbitrationBusy.value) return;
  arbitrationBusy.value = true;
  arbitrationError.value = '';
  try {
    arbitrationResult.value = await runArbitrationDivergences(view.value.gateId);
  } catch (cause) {
    arbitrationResult.value = null;
    arbitrationError.value = ipdErrorText(cause, { fallback: '仲裁分歧点汇总失败，请稍后重试' });
  } finally {
    arbitrationBusy.value = false;
  }
}

const elementResultOptions: Array<{ label: string; value: GateElementResult }> = [
  { label: '通过', value: 'PASS' },
  { label: '不通过', value: 'FAIL' },
  { label: '条件通过', value: 'CONDITIONAL' },
];

/** G1-1「一手客户验证」是唯一带量化门槛的要素（后端 verifyCustomerEvidence：PASS 需
 *  一手验证 ≥ gate.g1.minCustomerVerifications（默认 5），或书面意向 ≥ 1 走替代路径）。
 *
 *  编码形态两套并存（2026-10-07 实测）：后端权威种子是 `G1-1`（无前导零），前端静态兜底表
 *  FALLBACK_GATE_ELEMENTS 写的是 `G1-01`（有前导零）——两者语义同指「市场机会真实性」。
 *  这里用容错正则同时认这两种形态：改兜底表编码会波及 elementId（fallback-G1-01）与
 *  多个测试夹具，收益不抵风险；在判据边界容错是改动面最小且不漏一条的解法。 */
function isG1Customer(el: IpdGateElementView): boolean {
  return /^G1-0?1$/.test(el.elementCode);
}

/** G1-1 两个数字输入统一取值。
 *
 *  ⚠️ 踩过的坑：Vue 3 的 vModelText 对 `type="number"` 输入会**自动把值转成 number**
 *  （runtime-dom `castToNumber = number || props.type === 'number'`），草稿里存的是
 *  `number` 而非 string——直接 `.trim()` 会抛 `trim is not a function`，提交静默失败。
 *  统一按字符串取再判空，两种形态都安全。
 */
function numText(v: null | number | string | undefined): string {
  return v === null || v === undefined || v === '' ? '' : String(v);
}

function ensureDraft(elementId: string): void {
  if (!draftResults[elementId]) {
    draftResults[elementId] = { closeDeadline: '', conditionNote: '', responsiblePersonId: '', result: '', verifications: '', writtenIntents: '' };
  }
}

function onResultChange(elementId: string, value: GateElementResult): void {
  ensureDraft(elementId);
  const draft = draftResults[elementId];
  if (!draft) return;
  draft.result = value;
}

async function submitElement(el: IpdGateElementView): Promise<void> {
  if (!view.value || submittingElementId.value) return;
  ensureDraft(el.elementId);
  const draft = draftResults[el.elementId];
  if (!draft) return;
  if (!draft.result) {
    message.warning(`请先勾选「${el.elementName}」的判定结果`);
    return;
  }
  if (draft.result === 'CONDITIONAL') {
    if (!draft.responsiblePersonId.trim() || !draft.closeDeadline.trim()) {
      message.warning(`条件通过项必须填写责任人与关闭期限`);
      return;
    }
  }
  const verificationsText = numText(draft.verifications);
  const writtenIntentsText = numText(draft.writtenIntents);
  if (isG1Customer(el) && draft.result === 'PASS' && !verificationsText && !writtenIntentsText) {
    // 阈值由后端 gate.g1.minCustomerVerifications 配置即时生效，前端不复制业务数字，
    // 只拦住「两条通道都没填」——那种情况后端必拒，提前给可操作的提示。
    message.warning('G1-1 判「通过」需填一手验证家数，或改填客户书面意向份数');
    return;
  }
  submittingElementId.value = el.elementId;
  try {
    await submitGateElementResult(view.value.gateId, {
      closeDeadline: draft.result === 'CONDITIONAL' ? draft.closeDeadline.trim() : null,
      conditionNote: draft.conditionNote.trim() || null,
      elementId: el.elementId,
      responsiblePersonId: draft.result === 'CONDITIONAL' ? draft.responsiblePersonId.trim() : null,
      result: draft.result,
      verifications: isG1Customer(el) && verificationsText ? Number(verificationsText) : null,
      writtenIntents: isG1Customer(el) && writtenIntentsText ? Number(writtenIntentsText) : null,
    });
    committedResults[el.elementId] = draft.result;
    message.success(`已提交「${el.elementName}」判定：${resultLabel(draft.result)}`);
  } catch (cause) {
    message.error(ipdErrorText(cause, { fallback: '要素判定提交失败' }));
  } finally {
    submittingElementId.value = '';
  }
}

function resultLabel(value: GateElementResult | ''): string {
  if (value === 'PASS') return '通过';
  if (value === 'FAIL') return '不通过';
  if (value === 'CONDITIONAL') return '条件通过';
  return '未判定';
}

async function loadElements(gateId: string): Promise<void> {
  elementsLoading.value = true;
  elementsError.value = '';
  elementsIsFallback.value = false;
  try {
    const fetched = await listGateElementViews(gateId);
    // [CONSISTENCY-4] V4 修复：API 失败 / 0 项时回退到 33 项种子要素并标记 stale，
    // 避免「19/33 渲染」类高危缺口——前端兜底不等同后端契约，后端恢复后即覆盖。
    if (fetched.length === 0) {
      elements.value = getFallbackGateElements();
      elementsIsFallback.value = true;
      elementsError.value = '';
    } else {
      elements.value = fetched;
    }
    for (const key of Object.keys(committedResults)) delete committedResults[key];
    if (!elementsIsFallback.value) {
      for (const el of fetched) {
        const stored = storedElementResult(el.result);
        if (stored) committedResults[el.elementId] = stored;
      }
    }
    // 为每个要素初始化草稿
    for (const el of elements.value) ensureDraft(el.elementId);
  } catch (cause) {
    elements.value = getFallbackGateElements();
    elementsIsFallback.value = true;
    elementsError.value = ipdErrorText(cause, { fallback: '评审要素加载失败' });
    for (const el of elements.value) ensureDraft(el.elementId);
  } finally {
    elementsLoading.value = false;
  }
}

/** 上传材料或纪要后回填数字 ossId，提交体仍走既有两个字段。 */
async function uploadOutput(kind: 'materials' | 'minutes', event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const gateId = gateIdInput.value.trim();
  if (!file || !gateId) return;
  try {
    const uploaded = await uploadGateMaterial(gateId, file);
    if (kind === 'materials') {
      materialsOssId.value = uploaded.ossId;
      materialsFileName.value = uploaded.fileName || file.name;
    } else {
      meetingMinutesOssId.value = uploaded.ossId;
      minutesFileName.value = uploaded.fileName || file.name;
    }
    message.success(kind === 'materials' ? '评审材料已上传' : '会议纪要已上传');
  } catch (cause) {
    message.error(ipdErrorText(cause, { fallback: '材料上传失败' }));
  }
}

/** G4：按本次会话上传的 ossId 打开统一预览（GET /gates/{gateId}/materials/download?ossId=）。 */
function openMaterialView(kind: 'materials' | 'minutes'): void {
  const gateId = gateIdInput.value.trim();
  const ossId = kind === 'materials' ? materialsOssId.value.trim() : meetingMinutesOssId.value.trim();
  if (!gateId || !isDigits(ossId)) return;
  const fileName = (kind === 'materials' ? materialsFileName.value : minutesFileName.value) || (kind === 'materials' ? '评审材料' : '会议纪要');
  materialViewPayload.value = {
    kind: 'auto',
    title: fileName,
    download: {
      filename: fileName,
      fetch: () => downloadGateMaterial(gateId, ossId),
    },
  };
  materialViewOpen.value = true;
}

async function loadGate(): Promise<void> {
  const id = gateIdInput.value.trim();
  if (!id || loading.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    view.value = await getGateReview(id);
    await loadElements(id);
  } catch (cause) {
    view.value = null;
    elements.value = [];
    loadError.value = ipdErrorText(cause, { fallback: 'Gate 评审视图加载失败，请稍后重试' });
  } finally {
    loading.value = false;
  }
}

/** R30 接线：外部传入 initialGateId 时挂载即加载（免二次手输）。 */
onMounted(() => {
  if (gateIdInput.value) {
    void loadGate();
  }
});

async function run(action: () => Promise<unknown>, successText: string): Promise<void> {
  if (busy.value || !view.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    await action();
    message.success(successText);
    view.value = await getGateReview(view.value.gateId);
  } catch (cause) {
    actionError.value = ipdErrorText(cause, { fallback: '操作失败，请稍后重试' });
  } finally {
    busy.value = false;
  }
}

function sign(decision: GateDecision): void {
  void run(
    () => signGate(view.value!.gateId, decision, opinion.value.trim() || undefined),
    decision === 'APPROVE' ? '已签署通过' : '已驳回，Gate 进入否决状态',
  );
}

function reopen(): void {
  void run(() => reopenGate(view.value!.gateId), '已发起新一轮评审');
}

function extend(days: number): void {
  void run(() => extendGateDeadline(view.value!.gateId, days), `签署期限已延长 ${days} 天`);
}

function arbitrate(decision: GateDecision): void {
  void run(
    () => arbitrateGate(view.value!.gateId, decision, opinion.value.trim() || undefined),
    decision === 'APPROVE' ? '仲裁意见已提交：同意' : '仲裁意见已提交：驳回',
  );
}

function finalRuling(decision: GateDecision): void {
  void run(
    () => finalRulingGate(view.value!.gateId, decision, opinion.value.trim() || undefined),
    decision === 'APPROVE' ? '终裁已锁定：通过' : '终裁已锁定：驳回',
  );
}
</script>

<template>
  <section class="surface final-gates">
    <div class="section-title">
      <div>
        <h2>五大关键联合 Gate</h2>
        <p>与六阶段确认独立显示；双 PM 盲签互不可见，任一否决即整单驳回。</p>
      </div>
      <span>双PM否决项不可管理覆盖</span>
    </div>

    <div class="gate-locate">
      <input
        id="gate-locate-input"
        v-model="gateIdInput"
        name="gate_id_input"
        aria-label="Gate 编号"
        placeholder="输入 Gate 编号定位评审（由审计/通知提供）"
        @keyup.enter="loadGate"
      />
      <button v-access:code="IPD_PERMISSION_CODES.GATE_REVIEW_LIST" :disabled="!gateIdInput.trim() || loading" class="primary-button" type="button" @click="loadGate">
        加载评审视图
      </button>
    </div>
    <div class="rev-pending">
      原型材料归档（会议纪要/评审材料上传）与协作决策链（旧五节点口径已废止）后端未交付，维持真缺口登记；Gate
      双签轮次评审链已交付，经 Gate 编号定位后在本面板办理。
    </div>

    <div v-if="loadError" class="gate-error">{{ loadError }}</div>

    <div v-if="loading" class="gate-loading">正在加载 Gate 评审视图…</div>

    <template v-if="view">
      <!-- R227-C1 AI-FUSION L2：评审前检查清单 + 结论草稿（后端按 gateId 拉评审链/要素结果；
           盲签互盲红线：AI 上下文只含已提交的 decision/opinion，在途互盲期后端自然拿不到对方在途值） -->
      <div class="gate-ai-row" style="display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap">
        <AiSuggest
          scene="gate.precheck-checklist"
          :entity-id="view.gateId"
          label="AI 评审前检查清单"
          data-testid="gate-ai-precheck"
        />
        <AiSuggest
          scene="gate.conclusion-draft"
          :entity-id="view.gateId"
          label="AI 结论草稿"
          data-testid="gate-ai-conclusion"
        />
        <button
          v-access:code="IPD_PERMISSION_CODES.GATE_REVIEW_LIST"
          class="panel-action"
          type="button"
          data-testid="gate-precheck-run"
          :disabled="precheckBusy"
          @click="runPrecheck"
        >
          {{ precheckBusy ? 'AI 预审中…' : 'AI 预审（材料覆盖检查）' }}
        </button>
        <button
          v-access:code="IPD_PERMISSION_CODES.GATE_REVIEW_LIST"
          class="panel-action"
          type="button"
          data-testid="gate-arbitration-run"
          :disabled="arbitrationBusy"
          @click="runArbitration"
        >
          {{ arbitrationBusy ? '汇总中…' : '仲裁分歧点汇总' }}
        </button>
      </div>
      <!-- AI-P2-1 预审结果面板：覆盖统计 + 证据定位 + AI 参考清单（blocking/decisionWritten 恒 false 自证） -->
      <article v-if="precheckResult" class="gate-elements-card" data-testid="gate-precheck-panel">
        <header class="elements-header">
          <strong>AI 预审结果（{{ precheckResult.gateCode ?? 'Gate' }}）</strong>
          <span class="elements-ok">只读参考 · 不写决策 · 不阻塞评审</span>
        </header>
        <p class="gate-opinion" data-testid="gate-precheck-summary">
          覆盖统计：共 {{ precheckResult.summary.total }} 项 — 已覆盖 {{ precheckResult.summary.covered }} / 部分 {{ precheckResult.summary.partial }} / 缺失 {{ precheckResult.summary.missing }}；材料归档 {{ precheckResult.materials.uploaded }}/{{ precheckResult.materials.total }}（{{ precheckResult.materials.isReady ? '齐套' : '缺 ' + precheckResult.materials.missing + ' 项' }}）。
        </p>
        <ul v-if="precheckResult.items.length" class="gate-precheck-list">
          <li v-for="item in precheckResult.items" :key="item.elementId" :data-status="item.status">
            <strong>{{ precheckStatusText[item.status] ?? item.status }}</strong>
            <span>要素 #{{ item.elementId }}（判定：{{ item.result ?? '未判定' }}）</span>
            <small v-if="item.evidenceRef">证据：{{ item.evidenceRef }}</small>
            <small v-if="item.conditionNote">条件：{{ item.conditionNote }}</small>
            <small v-if="item.leftoverStatus">遗留：{{ item.leftoverStatus }}</small>
          </li>
        </ul>
        <div
          v-if="precheckResult.aiChecklist.degraded"
          class="elements-stale"
          data-testid="gate-precheck-degraded"
        >
          {{ precheckResult.aiChecklist.markdown || 'AI 预审清单暂不可用，以上为结构化覆盖统计。' }}
        </div>
        <pre v-else class="gate-precheck-ai" data-testid="gate-precheck-ai">{{ precheckResult.aiChecklist.markdown }}</pre>
      </article>
      <div v-if="precheckError" class="gate-error" data-testid="gate-precheck-error">{{ precheckError }}</div>
      <!-- AI-P2-1 R240 仲裁分歧点汇总面板：分歧清单 + AI 归纳（只归纳不裁决，blocking/decisionWritten 恒 false 自证） -->
      <article v-if="arbitrationResult" class="gate-elements-card" data-testid="gate-arbitration-panel">
        <header class="elements-header">
          <strong>仲裁分歧点汇总（第 {{ arbitrationResult.round ?? '—' }} 轮）</strong>
          <span class="elements-ok">只读参考 · 只归纳不裁决 · 不阻塞仲裁</span>
        </header>
        <ul v-if="arbitrationResult.divergences.length" class="gate-precheck-list">
          <li v-for="row in arbitrationResult.divergences" :key="row.round" data-status="MISSING">
            <strong>第 {{ row.round }} 轮分歧</strong>
            <span>市场PM：{{ arbitrationDecisionText[row.marketDecision] ?? row.marketDecision }}（{{ row.marketOpinion || '无意见' }}）</span>
            <span>研发PM：{{ arbitrationDecisionText[row.rdDecision] ?? row.rdDecision }}（{{ row.rdOpinion || '无意见' }}）</span>
          </li>
        </ul>
        <p v-else class="gate-opinion" data-testid="gate-arbitration-empty">无分歧点：各轮双 PM 决策一致或存在未签评审行。</p>
        <div
          v-if="arbitrationResult.aiSummary.degraded"
          class="elements-stale"
          data-testid="gate-arbitration-degraded"
        >
          {{ arbitrationResult.aiSummary.markdown || 'AI 分歧归纳暂不可用，以上为结构化分歧数据。' }}
        </div>
        <pre v-else class="gate-precheck-ai" data-testid="gate-arbitration-ai">{{ arbitrationResult.aiSummary.markdown }}</pre>
      </article>
      <div v-if="arbitrationError" class="gate-error" data-testid="gate-arbitration-error">{{ arbitrationError }}</div>
      <article class="gate-card">
        <header>
          <span>
            <strong>{{ view.gateCode }}</strong>
            <small>
              第 {{ view.round }} 轮 · {{ view.dualSign ? '双PM盲签' : `主导方：${reviewerName(view.leadSide)}` }}
            </small>
          </span>
          <i class="status-pill" :class="statusClass">{{ statusText[view.status] }}</i>
        </header>

        <div class="gate-meta">
          <span>签署期限：{{ formatDateTime(view.signDueAt, '—') }}</span>
          <span>已延期 {{ view.extensionCount ?? 0 }}/3 次</span>
          <span v-if="view.observers?.length">
            第 3 轮起组长列席：{{ view.observers.map((item) => item.name).join('、') }}
          </span>
        </div>

        <div class="mini-chain">
          <span :class="view.my?.decision?.toLowerCase() || 'pending'">
            <i>{{ view.my ? decisionText(view.my.decision) : '未签' }}</i>
            <small>我（{{ reviewerName(personType) }}）</small>
          </span>
          <span v-if="view.other" :class="view.other.decision?.toLowerCase() || 'pending'">
            <i>{{ view.other.decision ? decisionText(view.other.decision) : '已提交' }}</i>
            <small>{{ reviewerName(view.other.reviewerType) }}</small>
          </span>
          <span v-else-if="view.otherSubmitted" class="blind">
            <i>已提交</i>
            <small>对方（盲签中）</small>
          </span>
          <span v-else class="blind">
            <i>—</i>
            <small>对方未签</small>
          </span>
        </div>

        <p v-if="view.hint" class="gate-hint">{{ view.hint }}</p>
        <template v-if="view.other?.opinion">
          <p class="gate-opinion"><strong>{{ reviewerName(view.other.reviewerType) }}意见：</strong>{{ view.other.opinion }}</p>
        </template>
        <p v-if="view.my?.opinion" class="gate-opinion"><strong>我的意见：</strong>{{ view.my.opinion }}</p>

        <footer>
          <template v-if="canSign">
            <input
              id="gate-sign-opinion-input"
              v-model="opinion"
              name="sign_opinion"
              aria-label="签署意见"
              class="gate-opinion-input"
              placeholder="签署意见（可空）；驳回请写明整改要求"
            />
            <button v-access:code="IPD_PERMISSION_CODES.GATE_REVIEW_APPROVE" :disabled="busy" class="secondary-button" type="button" @click="sign('REJECT')">驳回</button>
            <button v-access:code="IPD_PERMISSION_CODES.GATE_REVIEW_APPROVE" :disabled="busy" class="primary-button" type="button" @click="sign('APPROVE')">
              签署通过本节点
            </button>
          </template>
          <span v-else-if="view.status === 'PENDING' && view.my" class="gate-done">
            本轮已签署（{{ decisionText(view.my.decision) }}），等待对方或系统推进。
          </span>
          <template v-if="canReopen">
            <button :disabled="busy" class="secondary-button" type="button" @click="reopen">
              整改后发起新版本
            </button>
          </template>
          <!-- 组长仲裁（AC-GATE-10 中段）：后端 GateReviewService.requireArbitratable 前置 =
               角色匹配 + gate.status = REJECTED + 当轮双 PM 意见分歧（hasPmConflict），
               arbitrate() 先过该断言。2026-10-07 P0 修复：可见状态 PENDING → REJECTED，
               与后端受理状态同语义（旧口径在途可点必被拒、驳回后反而无入口）。
               数据限制（如实标注）：gate_arbitrations 无读取端点，前端拿不到「双 PM 分歧/
               组长已裁」数据，分歧仅由下方「仲裁分歧点汇总」人工核对，不参与显示判定。 -->
          <template v-if="isLeader && view.status === 'REJECTED'">
            <button :disabled="busy" class="secondary-button" type="button" @click="arbitrate('REJECT')">
              仲裁驳回
            </button>
            <button :disabled="busy" class="primary-button" type="button" @click="arbitrate('APPROVE')">
              仲裁同意
            </button>
          </template>
          <!-- 超管终裁（AC-GATE-10 尾段）：同样只在 REJECTED（被驳回）的 Gate 上受理。
               后端 finalRuling 另需「≥2 位组长的仲裁行已落决策且意见不一致」（已升级超管），
               但 gate_arbitrations 只有写入端点（POST /arbitrate、POST /final-ruling），
               前端无数据源可判「≥2 组长已裁」——故只按状态显示，未升级即提交由后端
               fail-closed 文案（组长仲裁尚未形成两组对立意见，暂无需超管终裁）兜住。 -->
          <template v-if="isSuperAdmin && view.status === 'REJECTED'">
            <button :disabled="busy" class="secondary-button" type="button" @click="finalRuling('REJECT')">
              终裁驳回
            </button>
            <button :disabled="busy" class="primary-button" type="button" @click="finalRuling('APPROVE')">
              终裁通过
            </button>
          </template>
          <!-- 延长签署期限（AC-GATE-21）：后端 extendDeadline 前置仍是 PENDING（签署中）且未超 3 次，
               与仲裁/终裁的 REJECTED 门槛不同，故单独成块（canExtend 已含 isSuperAdmin + PENDING + 次数）。 -->
          <template v-if="canExtend">
            <button :disabled="busy" class="panel-action" type="button" @click="extend(7)">延长 7 天</button>
            <button :disabled="busy" class="panel-action" type="button" @click="extend(15)">延长 15 天</button>
          </template>
        </footer>
      </article>

      <!-- [CONSISTENCY-4] 评审要素逐项打勾面板 -->
      <article class="gate-elements-card">
        <header class="elements-header">
          <strong>评审要素判定（{{ elements.length }} 项）</strong>
          <span v-if="vetoFailureCount > 0" class="elements-veto">否决项 FAIL {{ vetoFailureCount }} 项 → 提交被阻断</span>
          <span v-else-if="elementValidation.length > 0" class="elements-warn">要素待补：{{ elementValidation.length }} 项</span>
          <span v-else-if="elements.length > 0" class="elements-ok">要素预检查通过</span>
        </header>

        <div
          v-if="elementsIsFallback"
          class="elements-stale"
          data-testid="gate-elements-stale"
          role="alert"
        >
          当前展示为前端 33 项种子要素兜底（API 未返回或返回为空，提交判定暂不可用）。请刷新页面或联系超管在「Gate 评审要素」页登记。
        </div>

        <div v-if="elementsError" class="gate-error">{{ elementsError }}</div>
        <div v-if="elementsLoading" class="gate-loading">正在加载评审要素…</div>

        <ul v-if="elements.length > 0" class="elements-list">
          <li
            v-for="el in elements"
            :key="el.elementId"
            class="element-row"
            :class="{ 'is-veto-fail': draftResults[el.elementId]?.result === 'FAIL' && el.isVeto }"
            :data-veto="el.isVeto ? 'true' : 'false'"
            :data-stale="elementsIsFallback || isFallbackElement(el) ? 'true' : 'false'"
            :data-testid="`gate-element-${el.elementCode}`"
          >
            <div class="element-head">
              <span class="element-title">
                <strong>{{ el.elementName }}</strong>
                <em v-if="el.isVeto" class="element-veto-tag">否决项</em>
                <em v-else class="element-must-tag">必审</em>
              </span>
              <span v-if="committedResults[el.elementId]" class="element-committed">已提交：{{ resultLabel(committedResults[el.elementId]!) }}</span>
            </div>
            <p v-if="el.description" class="element-desc">{{ el.description }}</p>
            <p v-if="el.passStandard" class="element-std">通过标准：{{ el.passStandard }}</p>

            <div class="element-radios">
              <label v-for="opt in elementResultOptions" :key="opt.value" class="element-radio" :class="{ active: draftResults[el.elementId]?.result === opt.value }">
                <input
                  type="radio"
                  :name="`el-${el.elementId}`"
                  :value="opt.value"
                  :checked="draftResults[el.elementId]?.result === opt.value"
                  @change="onResultChange(el.elementId, opt.value)"
                />
                <span>{{ opt.label }}</span>
              </label>
            </div>

            <div v-if="draftResults[el.elementId]?.result === 'CONDITIONAL'" class="element-cond">
              <input
                :id="`el-${el.elementId}-responsible-person`"
                v-model="draftResults[el.elementId]!.responsiblePersonId"
                name="responsible_person_id"
                aria-label="责任人编号"
                class="element-input"
                placeholder="责任人编号（必填）"
              />
              <input
                :id="`el-${el.elementId}-close-deadline`"
                v-model="draftResults[el.elementId]!.closeDeadline"
                name="close_deadline"
                aria-label="关闭期限"
                class="element-input"
                placeholder="关闭期限 YYYY-MM-DD（必填）"
              />
              <input
                :id="`el-${el.elementId}-condition-note`"
                v-model="draftResults[el.elementId]!.conditionNote"
                name="condition_note"
                aria-label="条件说明"
                class="element-input"
                placeholder="条件说明（可选）"
              />
            </div>

            <div v-if="isG1Customer(el)" class="element-cond">
              <input
                :id="`el-${el.elementId}-verifications`"
                v-model="draftResults[el.elementId]!.verifications"
                name="verifications"
                type="number"
                min="0"
                inputmode="numeric"
                aria-label="一手验证家数"
                class="element-input"
                placeholder="一手验证家数（≥5 或填书面意向）"
              />
              <input
                :id="`el-${el.elementId}-written-intents`"
                v-model="draftResults[el.elementId]!.writtenIntents"
                name="written_intents"
                type="number"
                min="0"
                inputmode="numeric"
                aria-label="客户书面意向份数"
                class="element-input"
                placeholder="书面意向份数（≥1 走替代路径）"
              />
            </div>

            <div class="element-actions">
              <button
                class="panel-action"
                type="button"
                :disabled="!draftResults[el.elementId]?.result || submittingElementId === el.elementId || elementsIsFallback"
                @click="submitElement(el)"
              >
                {{ submittingElementId === el.elementId ? '提交中…' : '提交此项判定' }}
              </button>
            </div>
          </li>
        </ul>
        <div v-else-if="!elementsLoading && !elementsError" class="empty-state">
          <div><SafetyOutlined /></div>
          <strong>本 Gate 暂无评审要素</strong>
          <p>若后端未配置 33 项种子要素，请联系超管在「Gate 评审要素」页登记。</p>
        </div>

        <div v-if="elementValidation.length > 0" class="gate-error">
          提交前必填：
          <ul class="mt-1 list-disc pl-5">
            <li v-for="(msg, idx) in elementValidation" :key="idx">{{ msg }}</li>
          </ul>
        </div>
        <div v-if="submitError" class="gate-error" data-testid="gate-submit-error">{{ submitError }}</div>
        <div class="gate-elements-foot">
          <!-- 强制输出物（SEC-FIX-HIGH-1.1-FOLLOWUP）：只收 OSS ID，服务端按 ossId 解析，禁任意外部 URL -->
          <div class="submit-outputs">
            <input
              id="gate-materials-oss-input"
              v-model="materialsOssId"
              name="materials_oss_id"
              aria-label="评审材料OSS ID"
              class="element-input"
              data-testid="gate-submit-materials-oss"
              inputmode="numeric"
              placeholder="评审材料 OSS ID（必填数字）"
            />
            <input
              type="file"
              aria-label="上传评审材料"
              data-testid="gate-upload-materials"
              @change="uploadOutput('materials', $event)"
            />
            <button
              v-if="isDigits(materialsOssId)"
              type="button"
              class="element-input"
              data-testid="gate-view-materials"
              @click="openMaterialView('materials')"
            >
              查看评审材料
            </button>
            <input
              id="gate-meeting-minutes-oss-input"
              v-model="meetingMinutesOssId"
              name="meeting_minutes_oss_id"
              aria-label="会议纪要OSS ID"
              class="element-input"
              data-testid="gate-submit-minutes-oss"
              inputmode="numeric"
              placeholder="会议纪要 OSS ID（必填数字）"
            />
            <input
              type="file"
              aria-label="上传会议纪要"
              data-testid="gate-upload-minutes"
              @change="uploadOutput('minutes', $event)"
            />
            <button
              v-if="isDigits(meetingMinutesOssId)"
              type="button"
              class="element-input"
              data-testid="gate-view-minutes"
              @click="openMaterialView('minutes')"
            >
              查看会议纪要
            </button>
          </div>
          <button
            type="button"
            class="primary-button"
            data-testid="gate-elements-submit"
            v-access:code="IPD_PERMISSION_CODES.GATE_REVIEW_APPROVE"
            :disabled="!canSubmitReview || busy || submitBusy"
            :title="vetoFailureCount > 0 ? `否决项 FAIL ${vetoFailureCount} 项被阻断` : (elementValidation.length > 0 ? '必填项未完成' : (!isDigits(materialsOssId) || !isDigits(meetingMinutesOssId) ? '需先填写材料与纪要 OSS ID' : '提交评审结论'))"
            @click="submitReview"
          >
            {{ submitBusy ? '提交中…' : `提交评审结论（${elements.length} 项）` }}
          </button>
        </div>
      </article>
    </template>
    <div v-else-if="!loading && !loadError" class="empty-state">
      <div><SafetyOutlined /></div>
      <strong>尚未加载 Gate</strong>
      <p>输入 Gate 编号后加载双签评审视图；在途双方互不可见结论。</p>
    </div>

    <div v-if="actionError" class="gate-error">{{ actionError }}</div>

    <!-- 文档预览 G4：材料/纪要统一查看/下载 -->
    <IpdContentView v-model:open="materialViewOpen" :payload="materialViewPayload" />
  </section>
</template>

<style scoped>
/* 原型 styles.css 摘录；--blue/--line/--muted/--text/--green 映射为 --ipd-*，
   --blue-soft/--blue-dark 原型字面量 #edf2ff/#1747d7 直接保留。 */
.final-gates {
  margin: 18px 0;
}

.surface {
  background: white;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--ipd-line);
}

.section-title h2 {
  margin: 0;
  font-size: 15px;
}

.section-title > span {
  font-size: 12px;
  color: var(--ipd-muted);
}

.section-title p {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--ipd-muted);
}

.primary-button,
.secondary-button,
.panel-action {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 16px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  border: 0;
  border-radius: 6px;
}

.primary-button {
  color: white;
  background: var(--ipd-blue);
  box-shadow: 0 4px 12px rgb(36 91 244 / 18%);
}

.primary-button:hover {
  background: #1747d7;
}

.primary-button:disabled,
.secondary-button:disabled,
.panel-action:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.secondary-button {
  color: #465168;
  background: white;
  border: 1px solid #cdd4df;
}

.panel-action {
  min-height: 30px;
  padding: 0 11px;
  font-size: 12px;
  color: var(--ipd-text);
  background: white;
  border: 1px solid #cfd6e1;
}

.gate-locate {
  display: flex;
  gap: 10px;
  padding: 16px 20px 0;
}

.gate-locate input {
  flex: 1;
  min-width: 0;
  max-width: 420px;
  height: 38px;
  padding: 0 10px;
  color: var(--ipd-text);
  border: 1px solid #cfd6e1;
  border-radius: 6px;
}

.rev-pending {
  padding: 10px 12px;
  margin: 12px 20px 0;
  font-size: 12px;
  line-height: 1.6;
  color: #6b7a90;
  background: #f6f8fb;
  border: 1px dashed #cfd9e5;
  border-radius: 6px;
}

.gate-error {
  padding: 10px 12px;
  margin: 12px 20px 0;
  font-size: 12px;
  color: #a8071a;
  background: #fff2f0;
  border: 1px solid #ffccc7;
  border-radius: 6px;
}

.gate-loading {
  padding: 24px 20px;
  font-size: 12px;
  color: var(--ipd-muted);
}

.gate-card {
  margin: 16px 20px 20px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}

.gate-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ipd-line);
}

.gate-card header strong {
  font-size: 14px;
}

.gate-card header small {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--ipd-muted);
}

.status-pill {
  padding: 4px 8px;
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  border-radius: 4px;
}

.status-pill.pending {
  color: var(--ipd-blue);
  background: #edf2ff;
}

.status-pill.approved {
  color: var(--ipd-green);
  background: #eaf7ed;
}

.status-pill.rejected {
  color: #b42318;
  background: #fee4e2;
}

.status-pill.abstained-timeout {
  color: #9a6509;
  background: #fff4df;
}

.gate-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding: 12px 16px;
  font-size: 11px;
  color: var(--ipd-muted);
}

.mini-chain {
  display: flex;
  gap: 10px;
  padding: 0 16px 4px;
}

.mini-chain span {
  display: grid;
  gap: 4px;
  justify-items: center;
}

.mini-chain i {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
  color: var(--ipd-muted);
  background: #f1f4f9;
  border-radius: 50%;
}

.mini-chain span.approve i {
  color: var(--ipd-green);
  background: #eaf7ed;
}

.mini-chain span.reject i {
  color: #b42318;
  background: #fee4e2;
}

.mini-chain span.blind i {
  color: var(--ipd-blue);
  background: #edf2ff;
}

.mini-chain small {
  font-size: 10px;
  color: var(--ipd-muted);
}

.gate-hint {
  padding: 8px 10px;
  margin: 8px 16px 0;
  font-size: 12px;
  color: var(--ipd-blue);
  background: #edf2ff;
  border-radius: 6px;
}

.gate-opinion {
  margin: 8px 16px 0;
  font-size: 12px;
  color: #56647c;
}

.gate-opinion strong {
  color: var(--ipd-text);
}

.gate-card footer {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 14px 16px;
}

.gate-opinion-input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 10px;
  color: var(--ipd-text);
  border: 1px solid #cfd6e1;
  border-radius: 6px;
}

.gate-done {
  font-size: 12px;
  color: var(--ipd-muted);
}

.empty-state {
  display: grid;
  place-content: center;
  justify-items: center;
  min-height: 200px;
  color: var(--ipd-muted);
  text-align: center;
}

.empty-state > div {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  font-size: 28px;
  color: var(--ipd-blue);
  background: #edf2ff;
  border-radius: 50%;
}

.empty-state strong {
  margin: 12px 0 4px;
  color: var(--ipd-text);
}

.empty-state p {
  max-width: 380px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

/* [CONSISTENCY-4] Gate 要素判定面板 */
.gate-elements-card {
  margin: 0 20px 20px;
  background: #fbfcfe;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}

.elements-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: white;
  border-bottom: 1px solid var(--ipd-line);
  border-radius: 8px 8px 0 0;
}

.elements-header strong {
  font-size: 13px;
}

.elements-veto {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  color: #b42318;
  background: #fee4e2;
  border-radius: 4px;
}

.elements-warn {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  color: #9a6509;
  background: #fff4df;
  border-radius: 4px;
}

.elements-ok {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--ipd-green);
  background: #eaf7ed;
  border-radius: 4px;
}

.elements-stale {
  padding: 10px 12px;
  margin: 12px 16px 0;
  font-size: 12px;
  line-height: 1.6;
  color: #9a6509;
  background: #fff4df;
  border: 1px solid #ffd591;
  border-radius: 6px;
}

.elements-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.element-row {
  padding: 14px 16px;
  border-bottom: 1px solid var(--ipd-line);
}

.element-row:last-child {
  border-bottom: 0;
}

.element-row.is-veto-fail {
  background: #fff5f5;
}

.element-head {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.element-title {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}

.element-veto-tag {
  padding: 2px 6px;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  color: white;
  background: #b42318;
  border-radius: 3px;
}

.element-must-tag {
  padding: 2px 6px;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  color: var(--ipd-blue);
  background: #edf2ff;
  border-radius: 3px;
}

.element-committed {
  font-size: 11px;
  color: var(--ipd-green);
}

.element-desc {
  margin: 4px 0 2px;
  font-size: 12px;
  color: #56647c;
}

.element-std {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--ipd-muted);
}

.element-radios {
  display: flex;
  gap: 8px;
  margin: 6px 0;
}

.element-radio {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  background: white;
  border: 1px solid #cfd6e1;
  border-radius: 4px;
}

.element-radio.active {
  color: var(--ipd-blue);
  background: #edf2ff;
  border-color: var(--ipd-blue);
}

.element-cond {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 0;
}

.element-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  font-size: 12px;
  border: 1px solid #cfd6e1;
  border-radius: 4px;
}

.element-actions {
  margin-top: 4px;
}

.submit-outputs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.submit-outputs .element-input {
  width: 220px;
}

.gate-elements-foot {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 12px 16px;
  background: white;
  border-top: 1px solid var(--ipd-line);
  border-radius: 0 0 8px 8px;
}

/* AI-P2-1 预审面板（复用 gate-elements-card 容器，仅补列表/代码块两处排版） */
.gate-precheck-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.gate-precheck-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: baseline;
  padding: 8px 16px;
  font-size: 12px;
  border-bottom: 1px solid var(--ipd-line);
}

.gate-precheck-list li strong {
  font-size: 11px;
}

.gate-precheck-list li[data-status='COVERED'] strong {
  color: var(--ipd-green);
}

.gate-precheck-list li[data-status='PARTIAL'] strong {
  color: #9a6509;
}

.gate-precheck-list li[data-status='MISSING'] strong {
  color: #b42318;
}

.gate-precheck-list li small {
  color: var(--ipd-muted);
}

.gate-precheck-ai {
  padding: 12px 16px;
  margin: 0;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
