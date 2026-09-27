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
 */
import { ref } from 'vue';

import { PhSparkle as Sparkles } from '@phosphor-icons/vue';
import { Alert, Button, Input, Tooltip } from 'ant-design-vue';

import { aiSuggest, type AiSuggestScene, type AiSuggestView } from '../../../api/ipd/ai-suggest';
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

const loading = ref(false);
const result = ref<AiSuggestView | null>(null);
const errorMsg = ref('');
const promptText = ref('');

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
  try {
    result.value = await aiSuggest(props.scene, {
      entityId: props.entityId || undefined,
      projectId: effectiveProjectId(),
      userPrompt: props.needsPrompt ? promptText.value.trim() : undefined,
    });
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
        <pre class="suggest-md">{{ result.markdown }}</pre>
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
