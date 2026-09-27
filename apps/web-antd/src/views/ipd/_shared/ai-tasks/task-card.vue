<script lang="ts" setup>
/**
 * R221 任务卡（R232 P2-04）——ai_agent_tasks 状态呈现卡片。
 *
 * <p>定位：这是 R221 执行任务的**状态投影**（PENDING→RUNNING→SUCCEEDED/FAILED/DEAD
 * + result_summary），不是 AI 建议卡——因此**不进 ai.suggest.cardCatalog / CARD_REGISTRY**
 *（schema 对账哨兵锁 registry=4，任务卡注册进表即污染 AI 建议卡单源）。渲染形态复用
 * ai-cards 惯例：BR-AI-04 头部 Alert、_shared/ipd-theme.css 色板、C08 按钮零直写。
 *
 * <p>硬约束：
 * - 状态呈现到 result_summary 粒度，**prompt/fillPayload 原文永不展示**（审计规约 L0-5；
 *   后端 AiAgentTaskView 组件面即无这些列，本组件亦不引任何 prompt 面）；
 * - 防注入展示纪律：全部 {{ }} 插值，禁 v-html；
 * - C08 零直写：「直达审批卡」只 emit 给宿主（宿主 router.push 到既有审核页），
 *   组件内无任何请求/写库路径。
 */
import { Alert, Button, Tag } from 'ant-design-vue';

import type { AiAgentTaskView } from '../../../../api/ipd/stage-action';

/** 组件 props（顶层具名 interface + defineProps<Props>()，见 gate-precheck-card.vue 注记）。 */
interface Props {
  /** ai_agent_tasks 只读投影（GET /api/v1/ai-agent-tasks；无 prompt 原文）。 */
  task: AiAgentTaskView;
}

const props = defineProps<Props>();

/** 直达事件：宿主 handler 负责路由跳转（C08：组件内零写入/零请求）。 */
const emit = defineEmits<{
  openReview: [payload: AiAgentTaskView];
}>();

/** ai_agent_tasks 五态呈现（AiAgentTask.java L31-35 状态机）。 */
const STATUS_META: Record<string, { color: string; text: string }> = {
  DEAD: { color: 'default', text: '死信·需人工处理' },
  FAILED: { color: 'error', text: '执行失败' },
  PENDING: { color: 'warning', text: '排队中' },
  RUNNING: { color: 'processing', text: '执行中' },
  SUCCEEDED: { color: 'success', text: '已完成' },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { color: 'processing', text: status || '—' };
}

/** result_summary 粒度展示（null 安全占位）；prompt 原文不在数据面，无从渲染。 */
function summaryText(summary: null | string | undefined): string {
  return summary == null || summary === '' ? '—' : summary;
}

function onOpenReview() {
  emit('openReview', props.task);
}
</script>

<template>
  <section class="ipd-ai-card" data-testid="ai-task-card">
    <h3 class="card-title">
      任务 {{ task.actionCode ?? task.id }}
      <Tag :color="statusMeta(task.status).color" data-testid="ai-task-status">
        {{ statusMeta(task.status).text }}
      </Tag>
    </h3>
    <Alert
      message="AI 生成内容由大模型产出，未经审核、不做内容过滤，仅供参考（BR-AI-04）。"
      show-icon
      type="warning"
      data-testid="ai-card-alert"
    />
    <div class="card-summary">
      <div class="cell">
        <span class="label">触发方式</span>
        <span class="value">{{ task.triggerType ?? '—' }}</span>
      </div>
      <div class="cell">
        <span class="label">执行模式</span>
        <span class="value">{{ task.execMode ?? '—' }}</span>
      </div>
      <div class="cell">
        <span class="label">任务 ID</span>
        <span class="value">{{ task.id }}</span>
      </div>
      <div class="cell">
        <span class="label">重试次数</span>
        <span class="value">{{ task.attempt ?? 0 }}</span>
      </div>
    </div>
    <div class="card-result">
      <span class="label">结果摘要（result_summary）</span>
      <!-- 防注入：仅插值渲染，禁 v-html；prompt 原文不在数据面 -->
      <p class="result-text" data-testid="ai-task-result">{{ summaryText(task.resultSummary) }}</p>
      <p v-if="task.errorMsg" class="result-error" data-testid="ai-task-error">{{ task.errorMsg }}</p>
    </div>
    <div v-if="task.aiDocId" class="card-foot">
      <Button data-testid="ai-task-open-review" type="primary" @click="onOpenReview">
        直达审批卡（草稿 {{ task.aiDocId }}）
      </Button>
      <small class="foot-hint">直达宿主既有审核页，人工审核走既有 /api/v1 端点，本卡不直写业务数据（C08）。</small>
    </div>
    <div v-else class="card-foot">
      <small class="foot-hint">本任务未生成草稿（无 aiDocId），无需人审。</small>
    </div>
  </section>
</template>

<style scoped>
/* 色板沿用 _shared/ipd-theme.css 的 --ipd-* token（与 ai-cards 渲染形态一致） */
.ipd-ai-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--ipd-line, #e2e8f0);
  border-radius: 10px;
  background: var(--ipd-surface, #fff);
}
.card-title {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: var(--ipd-text, #26303f);
}
.card-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}
.card-summary .label {
  margin-right: 6px;
  font-size: 12px;
  color: var(--ipd-muted, #6b7488);
}
.card-summary .value {
  font-size: 13px;
  color: var(--ipd-text, #26303f);
}
.card-result .label {
  font-size: 12px;
  color: var(--ipd-muted, #6b7488);
}
.result-text {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ipd-text, #26303f);
  white-space: pre-wrap;
  word-break: break-word;
}
.result-error {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ipd-danger, #d4380d);
  white-space: pre-wrap;
  word-break: break-word;
}
.card-foot {
  display: flex;
  gap: 8px;
  align-items: center;
}
.foot-hint {
  color: var(--ipd-muted, #6b7488);
}
</style>
