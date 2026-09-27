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
 */
import type { Component } from 'vue';

import { onErrorCaptured, ref, shallowRef } from 'vue';

import { PhSparkle as Sparkles } from '@phosphor-icons/vue';
import { Alert, Button, Input, Tooltip } from 'ant-design-vue';

import { aiSuggest, type AiSuggestScene, type AiSuggestView } from '../../../api/ipd/ai-suggest';
import { getCardType, listCardTypes } from './ai-cards/card-registry';
import type { AiCardData, AiCardEnvelope } from './ai-cards/types';
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
 * 响应体本地收窄（P1-07）：P1-02 契约在 AiSuggestView 之上增 card 字段（四键信封）。
 * api/ 目录非本节点所有权，故在此以交叉类型声明，不改 api 层；
 * 运行期信封形态由 resolveCardView 兜底校验（后端越约不信任类型标注）。
 */
type AiSuggestViewWithCard = AiSuggestView & { card?: AiCardEnvelope | null };

/** 分发层渲染视图：命中注册表的 (component, data) 对（组件契约 = data prop + confirm emit）。 */
interface CardView {
  component: Component;
  data: AiCardData;
}

const loading = ref(false);
const result = ref<AiSuggestViewWithCard | null>(null);
const errorMsg = ref('');
const promptText = ref('');
/** 分发层（P1-07）：cardView 非空 = 渲染卡片；cardDegraded 非空 = 可见降级原因（文本回退）。 */
const cardView = shallowRef<CardView | null>(null);
const cardDegraded = ref('');
/** 卡片 confirm 钩子提示（P1-07 只接住，提交链路由 P1-08 接线）。 */
const cardNotice = ref('');

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
  return { component: entry.component, data: raw.data as unknown as AiCardData };
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
  try {
    const view: AiSuggestViewWithCard = await aiSuggest(props.scene, {
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
 * 卡片「确认采纳」钩子（P1-07：只接住留 hook，本节点零提交逻辑）。
 *
 * TODO(P1-08)：payload 映射既有 /api/v1 真人端点 + 审计三件套（C08 零直写，届时在此接线）。
 */
function onCardConfirm(_payload: AiCardData) {
  cardNotice.value = '已收到卡片确认；提交链路由 P1-08 接线（当前节点零提交逻辑）';
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
        <component
          :is="cardView.component"
          v-if="cardView"
          :data="cardView.data"
          @confirm="onCardConfirm"
        />
        <pre v-else class="suggest-md">{{ result.markdown }}</pre>
        <Alert
          v-if="cardNotice"
          type="info"
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

.suggest-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.suggest-actions .meta {
  margin-left: auto;
  color: var(--ipd-text-muted, #999);
}
</style>
