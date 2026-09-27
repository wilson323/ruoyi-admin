<script lang="ts" setup>
/**
 * 域内 AI 建议入口（R227-C1 AI-FUSION Layer 2 通用组件，方案 §5.1 AiAssist 家族）。
 *
 * 每个核心页面（workbench / project-detail / project-create / demand-create /
 * gate-review）挂载本组件获得场景化「AI 帮忙」入口：
 * - 按 scene 调 POST /ai/suggest，后端拉业务上下文拼 prompt（前端不拼数据）；
 * - 输出 markdown 仅展示（pre-wrap 纯文本，与全局副驾同口径，不引 markdown 库）；
 * - 「采纳」只 emit 给宿主页面由用户决策填入（方案 §5.1 强约束：AI 不写业务表）；
 * - needsPrompt 场景（project.create / demand.create）要求先输入原始素材；
 * - BR-AI-04：不做内容过滤，常驻风险提示；degraded（模型未启用）展示引导文案。
 * - P1-07 卡片分发层（三态）：响应带合法 card（type 命中 CARD_REGISTRY 且 version 匹配）
 *   → 渲染对应卡片组件（data prop + confirm emit 组件契约）；无 card → 既有纯文本渲染；
 *   card 非法/渲染异常 → 可见降级提示 + 文本回退——**文本路径永不删**（卡片层是增强不是依赖）。
 *   7 场景口径：4 结构化场景走卡片分发，3 轻场景（workbench.next-step / workbench.risk-warning /
 *   project.summary.refresh）保持纯文本不进卡（带 card 也忽略、不降级，与基线渲染完全一致）。
 * - P1-08 提交链（C08 收口）：卡片 confirm = 恰一次既有 /api/v1 真人端点调用（gate.conclusion
 *   → 既有签署端点）或预填复制降级；金额/评分/系数/删除/移交类值不进提交载荷（方案 §5.1）。
 * - R232 P1-08 红线修复：decision 从真实票推导（reviews[].decision ∈ APPROVE|REJECT|null 待签|
 *   ABSTAIN 弃权，源 gate_reviews.decision）——failCount 是要素结果计数（gate_element_results），
 *   与票面不一致是常态，禁作判定源；提交前过「签署确认弹层」真人终审（decision 可改、opinion
 *   可编辑预填可清空，C08「AI 只建议、人终审」）。
 */
import type { Component } from 'vue';

import { onErrorCaptured, ref, shallowRef } from 'vue';

import { PhSparkle as Sparkles } from '@phosphor-icons/vue';
import { Alert, Button, Input, Modal, Radio, Tooltip } from 'ant-design-vue';

import { aiSuggest, type AiSuggestScene, type AiSuggestView } from '../../../api/ipd/ai-suggest';
import { signGate, type GateDecision } from '../../../api/ipd/gate-review';
import { getCardType, listCardTypes } from './ai-cards/card-registry';
import type { AiCardData, AiCardType, GateConclusionCardData } from './ai-cards/types';
import { ipdErrorText } from './ipd-error-text';

/**
 * 组件 props（顶层具名 interface + defineProps<Props>()）。
 * 注：内联 `withDefaults(defineProps<{...}>(), {...})` 在本仓 vue/compiler-sfc
 * 组合（注释 × null 联合 × defaults 对象）下会触发 AST 重写解析错，故用具名类型。
 */
interface Props {
  /** 场景键（与后端 SCENES 白名单对齐） */
  scene: AiSuggestScene;
  /** gate 场景 = gateId（字符串 ID，非评审行 id） */
  entityId?: null | string;
  /** 项目相关场景必填；workbench 可空 = 全局维度 */
  projectId?: null | string;
  /** 按钮文案（默认按场景语义「AI 建议」） */
  label?: string;
  /** 创建类场景：需先输入原始素材才允许发起 */
  needsPrompt?: boolean;
  /** 宿主页面已监听 adopt 并会消费 markdown 时才展示「采纳到表单」（方案 §5.1：仅已声明 schema 场景允许） */
  adoptable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  entityId: null,
  needsPrompt: false,
  projectId: null,
  label: 'AI 建议',
  adoptable: false,
});

/** 采纳事件：宿主页面接收 markdown 自行决定填入哪个字段（用户点击触发，非自动）。 */
const emit = defineEmits<{ adopt: [payload: { markdown: string; scene: string }] }>();

const CURRENT_PROJECT_KEY = 'ipd:current-project';

/**
 * P1-08 挂账②已正式化：card 四键信封字段收进 api/ipd/ai-suggest.ts 的 AiSuggestView
 * （P1-07 的本地交叉类型已删）；运行期信封形态仍由 resolveCardView 兜底校验。
 */

/** 分发层渲染视图：命中注册表的 (component, data) 对（组件契约 = data prop + confirm emit）。 */
interface CardView {
  component: Component;
  data: AiCardData;
  type: AiCardType;
}

const loading = ref(false);
const result = ref<AiSuggestView | null>(null);
const errorMsg = ref('');
const promptText = ref('');
/** 分发层（P1-07）：cardView 非空 = 渲染卡片；cardDegraded 非空 = 可见降级原因（文本回退）。 */
const cardView = shallowRef<CardView | null>(null);
const cardDegraded = ref('');
/** 卡片 confirm 提交链状态（P1-08）：提示文案 / 语气 / 进行中防重复点击。 */
const cardNotice = ref('');
const cardNoticeTone = ref<'error' | 'info' | 'success' | 'warning'>('info');
const cardConfirmBusy = ref(false);
/** Gate 签署确认弹层（R232 修复②+🟡#2）：真人终审草稿（AI 预填，真人可改可清空，C08）。 */
const signModalOpen = ref(false);
const signDraftDecision = ref<GateDecision>('APPROVE');
const signDraftOpinion = ref('');

/** 可出卡场景集（= 注册表 scene 集的唯一事实源推导；其外 3 轻场景保持纯文本不进卡）。 */
const CARD_SCENES: ReadonlySet<string> = new Set(
  listCardTypes().map((entry) => entry.scene),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 卡片信封合法性校验（P1-07 三态之「card 非法」）。
 *
 * @param raw - 响应 card 字段原文（不信任类型标注，运行期全量校验）
 * @returns 命中返回渲染视图；未命中返回降级原因文案（调用方可见提示 + 文本回退）
 */
function resolveCardView(raw: unknown): CardView | string {
  if (
    !isRecord(raw) ||
    typeof raw.type !== 'string' ||
    typeof raw.version !== 'number' ||
    !isRecord(raw.data) ||
    !isRecord(raw.sourceRefs)
  ) {
    return '卡片信封非法（需 type/version/data/sourceRefs 四键），已回退文本建议';
  }
  const entry = getCardType(raw.type, raw.version);
  if (!entry) {
    return `未知卡片（type=${raw.type} version=${raw.version}）未命中注册表，已回退文本建议`;
  }
  if (!entry.component) {
    return `卡片组件未注册（type=${raw.type}），已回退文本建议`;
  }
  // CardDynString 收窄由各卡 dynText 承担（ai-cards 所有权），分发层按契约透传 data 不做窄化。
  return {
    component: entry.component,
    data: raw.data as unknown as AiCardData,
    type: entry.type,
  };
}

/**
 * 三态之「渲染异常」：卡片组件渲染抛错 → 可见降级 + 文本回退（文本路径永不删）。
 * 只拦截卡片渲染期间的错误，其余子组件错误照常上抛，不扩大捕获面。
 */
onErrorCaptured((error: unknown) => {
  if (!cardView.value) return true;
  cardView.value = null;
  const detail = error instanceof Error ? error.message : String(error);
  cardDegraded.value = `卡片渲染异常（${detail}），已回退文本建议`;
  return false;
});

/** projectId 未显式传时跟随全局当前项目（与 layouts 全局选择器同 key，同副驾口径）。 */
function effectiveProjectId(): string | undefined {
  if (props.projectId) return props.projectId;
  return window.localStorage.getItem(CURRENT_PROJECT_KEY) || undefined;
}

async function run() {
  if (props.needsPrompt && !promptText.value.trim()) {
    errorMsg.value = '请先输入原始素材（项目想法 / 需求原文）';
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  result.value = null;
  cardView.value = null;
  cardDegraded.value = '';
  cardNotice.value = '';
  cardNoticeTone.value = 'info';
  try {
    const view: AiSuggestView = await aiSuggest(props.scene, {
      entityId: props.entityId || undefined,
      projectId: effectiveProjectId(),
      userPrompt: props.needsPrompt ? promptText.value.trim() : undefined,
    });
    result.value = view;
    // 三态分发（P1-07）：轻场景不进卡（带 card 也忽略，保持纯文本）；
    // 结构化场景：合法 card → 卡片渲染；非法 card → 可见降级 + 文本回退。
    if (view.card !== undefined && view.card !== null && CARD_SCENES.has(props.scene)) {
      const resolved = resolveCardView(view.card);
      if (typeof resolved === 'string') {
        cardDegraded.value = resolved;
      } else {
        cardView.value = resolved;
      }
    }
  } catch (error) {
    errorMsg.value = ipdErrorText(error);
  } finally {
    loading.value = false;
  }
}

async function copyResult() {
  if (!result.value?.markdown) return;
  await navigator.clipboard.writeText(result.value.markdown);
}

function adopt() {
  if (!result.value?.markdown) return;
  emit('adopt', { markdown: result.value.markdown, scene: result.value.scene });
}

/**
 * 卡片「确认采纳」提交链（P1-08 C08 收口）。
 *
 * 映射铁律：每卡恰好一次既有 /api/v1 真人端点调用 或 一次预填复制，绝不直写业务表；
 * 金额/评分/系数/删除/移交类值只进「建议值」展示区，绝不进提交载荷（方案 §5.1）。
 * 所有 confirm 反馈统一带「P1-08」标记（既有 hook 用例回归锚点）。
 * gate.conclusion 走签署确认弹层（R232 修复②）：confirm 不直达提交，真人终审后才落签。
 */
/** 无「一次既有写端点」合法映射卡的预填指引（复制建议 → 真人填既有表单后手动提交）。 */
const PREFILL_HINTS: Partial<Record<AiCardType, string>> = {
  'demand.draft': '既有「需求受理」入口（由真人创建/受理需求后落表）',
  'gate.precheck': '既有「评审要素判定」表单（本页逐项人工确认后提交）',
  'project.charter': '既有「立项创建」表单（人工填写后提交立项）',
};

async function onCardConfirm(payload: AiCardData) {
  if (cardConfirmBusy.value || signModalOpen.value) return;
  // mode!=='suggest' 防御保留（沿用 action-detail/index.vue 既有口径：非 suggest 一律防御性忽略）。
  const raw = payload as unknown as Record<string, unknown>;
  if (raw.mode !== undefined && raw.mode !== 'suggest') {
    cardNoticeTone.value = 'warning';
    cardNotice.value = `已防御性忽略非 suggest 模式卡片载荷（P1-08 防御保留，mode=${String(raw.mode)}）`;
    return;
  }
  const cardType = cardView.value?.type;
  if (!cardType) return;
  if (cardType === 'gate.conclusion') {
    // R232 修复②：confirm 不直达提交，先弹签署确认弹层（真人复核终审）。
    openGateSignConfirm(payload as GateConclusionCardData);
    return;
  }
  cardConfirmBusy.value = true;
  try {
    await prefillSuggestion(cardType);
  } finally {
    cardConfirmBusy.value = false;
  }
}

/**
 * decision 按真实票推导（R232 修复①：原 `failCount > 0 → REJECT` 取错数据源）。
 *
 * 数据源 = data.reviews[].decision（gate_reviews.decision 域值 APPROVE|REJECT|null 待签|
 * ABSTAIN 弃权）；failCount 是要素结果计数（gate_element_results.result=FAIL），票面/要素
 * 不一致是常态，禁作判定源。规则：任一 REJECT 票（字符串、大小写不敏感）⇒ 'REJECT'；
 * null/ABSTAIN/绑定对象等非 REJECT 票跳过不影响推导，无 REJECT 票 ⇒ 'APPROVE'。
 */
function deriveGateDecision(data: GateConclusionCardData): GateDecision {
  const reviews: unknown = Array.isArray(data.reviews) ? data.reviews : [];
  for (const review of reviews as unknown[]) {
    const decision = isRecord(review) ? review.decision : undefined;
    if (typeof decision === 'string' && decision.trim().toUpperCase() === 'REJECT') {
      return 'REJECT';
    }
  }
  return 'APPROVE';
}

/**
 * gate.conclusion confirm → 签署确认弹层（R232 修复② + 🟡#2 合并收口）：真人复核终审。
 * 弹层展示将提交的 decision（可改：APPROVE/REJECT 二选）与 opinion（可编辑文本框，默认预填
 * AI 结论草稿、可清空），文案明示「以下内容将作为你的签署意见提交，可修改」；真人确认后才调
 * signGate（C08：AI 只建议、人终审）。「票面以提交时为准」为 TOCTOU 一行防御（出卡→签署间
 * 票面变化的全量重取挂账，不在本组件做）。
 */
function openGateSignConfirm(data: GateConclusionCardData) {
  const gateId = props.entityId?.trim();
  if (!gateId) {
    cardNoticeTone.value = 'error';
    cardNotice.value = '签署提交失败（P1-08 提交链路）：缺 gateId（entityId 未传），未发起请求；请在既有 Gate 评审面板人工签署';
    return;
  }
  signDraftDecision.value = deriveGateDecision(data);
  signDraftOpinion.value = result.value?.markdown?.trim() || '';
  signModalOpen.value = true;
}

/** 弹层确认：以真人复核后的 decision/opinion 恰一次调用既有签署端点（防重复点击守卫）。 */
async function onSignModalOk() {
  if (cardConfirmBusy.value) return;
  const gateId = props.entityId?.trim();
  if (!gateId) {
    signModalOpen.value = false;
    cardNoticeTone.value = 'error';
    cardNotice.value = '签署提交失败（P1-08 提交链路）：缺 gateId（entityId 未传），未发起请求；请在既有 Gate 评审面板人工签署';
    return;
  }
  cardConfirmBusy.value = true;
  try {
    await submitGateSign(gateId, signDraftDecision.value, signDraftOpinion.value.trim() || undefined);
  } finally {
    signModalOpen.value = false;
    cardConfirmBusy.value = false;
  }
}

/** 弹层取消：零提交（人未终审不落签）。 */
function onSignModalCancel() {
  if (cardConfirmBusy.value) return;
  signModalOpen.value = false;
}

/**
 * gate.conclusion → 既有签署端点恰一次（GateReviewService.sign 对应 POST /gates/{gateId}/sign）。
 * decision 为真人复核后的终审值（默认预填 deriveGateDecision 真实票推导结果，弹层内可改）；
 * opinion 为真人签署意见（默认预填 AI 结论草稿，可改可清空），审计 GATE_SIGN 由端点自带落痕。
 */
async function submitGateSign(gateId: string, decision: GateDecision, opinion: string | undefined) {
  cardNoticeTone.value = 'info';
  cardNotice.value = '正在提交 Gate 签署（P1-08 提交链路，走既有签署端点）…';
  try {
    await signGate(gateId, decision, opinion);
    cardNoticeTone.value = 'success';
    cardNotice.value = `签署已提交（P1-08 提交链路）：判定=${decision}，审计由既有签署端点落痕`;
  } catch (cause) {
    cardNoticeTone.value = 'error';
    cardNotice.value = `签署提交失败（P1-08 提交链路）：${ipdErrorText(cause, { fallback: '既有签署端点调用失败' })}；请在既有 Gate 评审面板人工签署`;
  }
}

/** 预填降级卡（gate.precheck/project.charter/demand.draft）：复制建议文本，零请求零直写（C08）。 */
async function prefillSuggestion(cardType: AiCardType) {
  const hint = PREFILL_HINTS[cardType] ?? '既有业务表单';
  const text = result.value?.markdown ?? '';
  cardNoticeTone.value = 'info';
  cardNotice.value = '正在复制建议文本（P1-08 预填链路）…';
  const clipboard: Pick<Clipboard, 'writeText'> | undefined = navigator.clipboard;
  if (!text || !clipboard?.writeText) {
    cardNoticeTone.value = 'error';
    cardNotice.value = `复制建议失败（P1-08 预填链路）：剪贴板不可用或建议为空；请手动复制建议文本到${hint}，AI 建议值不直达生效（C08）`;
    return;
  }
  try {
    await clipboard.writeText(text);
    cardNoticeTone.value = 'success';
    cardNotice.value = `建议文本已复制（P1-08 预填链路）：请粘贴到${hint}，目检后由真人提交，AI 建议值不直达生效（C08）`;
  } catch (cause) {
    cardNoticeTone.value = 'error';
    cardNotice.value = `复制建议失败（P1-08 预填链路）：${ipdErrorText(cause, { fallback: '剪贴板写入被拒绝' })}；请手动复制建议文本到${hint}`;
  }
}
</script>

<template>
  <div class="ipd-ai-suggest" data-testid="ipd-ai-suggest">
    <div class="suggest-bar">
      <Button size="small" :loading="loading" data-testid="ai-suggest-run" @click="run">
        <template #icon>
          <Sparkles aria-hidden="true" />
        </template>
        {{ props.label }}
      </Button>
      <Tooltip title="AI 生成内容仅供参考，采纳前请人工核对（BR-AI-04）">
        <span class="risk-hint">AI 生成 · 需人工确认</span>
      </Tooltip>
    </div>
    <Input.TextArea
      v-if="props.needsPrompt"
      v-model:value="promptText"
      id="ipd-ai-suggest-prompt"
      name="ai_suggest_prompt"
      aria-label="AI 建议原始素材输入"
      :maxlength="2000"
      :auto-size="{ maxRows: 4, minRows: 2 }"
      placeholder="先写下原始素材（项目想法 / 需求原文，≤2000 字），再点上方按钮"
      data-testid="ai-suggest-prompt"
    />
    <Alert v-if="errorMsg" type="error" :message="errorMsg" show-icon data-testid="ai-suggest-error" />
    <div v-if="result" class="suggest-result" data-testid="ai-suggest-result">
      <Alert
        v-if="result.degraded"
        type="warning"
        :message="result.markdown"
        data-testid="ai-suggest-degraded"
      />
      <template v-else>
        <Alert
          v-if="cardDegraded"
          type="warning"
          :message="cardDegraded"
          data-testid="ai-suggest-card-degraded"
        />
        <div
          v-if="cardView"
          class="card-host"
          :class="{ 'card-host-busy': cardConfirmBusy }"
          :aria-busy="cardConfirmBusy"
        >
          <component :is="cardView.component" :data="cardView.data" @confirm="onCardConfirm" />
        </div>
        <pre v-else class="suggest-md">{{ result.markdown }}</pre>
        <Alert
          v-if="cardNotice"
          :type="cardNoticeTone"
          :message="cardNotice"
          data-testid="ai-suggest-card-notice"
        />
        <div class="suggest-actions">
          <Button size="small" data-testid="ai-suggest-copy" @click="copyResult">复制</Button>
          <Button
            v-if="props.adoptable"
            size="small"
            type="primary"
            data-testid="ai-suggest-adopt"
            @click="adopt"
          >
            采纳到表单
          </Button>
          <small class="meta">{{ result.aiModel }} · {{ result.latencyMs }}ms</small>
        </div>
      </template>
    </div>
    <!-- Gate 签署确认弹层（R232 修复② + 🟡#2）：真人复核终审，decision 可改、opinion 可编辑（C08）。 -->
    <Modal
      v-model:open="signModalOpen"
      title="Gate 签署复核（AI 只建议 · 人终审）"
      ok-text="确认签署"
      cancel-text="取消"
      :closable="false"
      :confirm-loading="cardConfirmBusy"
      :mask-closable="false"
      @cancel="onSignModalCancel"
      @ok="onSignModalOk"
    >
      <p class="sign-hint">以下内容将作为你的签署意见提交，可修改。</p>
      <p class="sign-hint">票面以提交时为准（若出卡后又有新投票，以本次提交时刻的判定为准）。</p>
      <div class="sign-field">
        <span class="sign-label">签署判定</span>
        <Radio.Group
          v-model:value="signDraftDecision"
          name="ai_suggest_sign_decision"
          aria-label="签署判定（可修改）"
          :disabled="cardConfirmBusy"
          data-testid="ai-suggest-sign-decision"
        >
          <Radio value="APPROVE">APPROVE（通过）</Radio>
          <Radio value="REJECT">REJECT（不通过）</Radio>
        </Radio.Group>
      </div>
      <div class="sign-field">
        <span class="sign-label">签署意见</span>
        <Input.TextArea
          v-model:value="signDraftOpinion"
          id="ipd-ai-suggest-sign-opinion"
          name="ai_suggest_sign_opinion"
          aria-label="签署意见（可修改）"
          :disabled="cardConfirmBusy"
          :maxlength="2000"
          :auto-size="{ maxRows: 6, minRows: 3 }"
          placeholder="默认预填 AI 结论草稿，可修改或清空"
          data-testid="ai-suggest-sign-opinion"
        />
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.ipd-ai-suggest {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.suggest-bar {
  display: flex;
  gap: 8px;
  align-items: center;
}

.risk-hint {
  font-size: 12px;
  color: var(--ipd-text-muted, #999);
}

.suggest-md {
  max-height: 320px;
  padding: 12px;
  overflow: auto;
  font-family: inherit;
  white-space: pre-wrap;
  background: var(--ipd-bg-subtle, #fafafa);
  border: 1px solid var(--ipd-border, #eee);
  border-radius: 8px;
}

.card-host-busy {
  pointer-events: none;
  opacity: 0.6;
}

.suggest-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.suggest-actions .meta {
  margin-left: auto;
  color: var(--ipd-text-muted, #999);
}

.sign-hint {
  margin: 0 0 8px;
  color: var(--ipd-text-muted, #999);
}

.sign-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.sign-label {
  font-weight: 600;
}
</style>
