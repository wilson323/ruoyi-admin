<script setup lang="ts">
/** 咨询流的可视化投影。只消费本轮真实 SSE 状态，不推断研究步骤或工具执行。 */
import { computed } from 'vue';

type ConsultationStatus = 'complete' | 'error' | 'idle' | 'running';

const props = defineProps<{
  error?: string;
  hasDelta: boolean;
  intent?: null | string;
  question: string;
  sources: string[];
  status: ConsultationStatus;
  tokenCompletion?: null | number;
}>();

const statusLabel = computed(() => ({
  idle: '等待提问',
  running: '响应中',
  complete: '已结束',
  error: '响应失败',
})[props.status]);

const responseText = computed(() => {
  if (props.status === 'error') return '本轮咨询未完成';
  if (props.status === 'complete') return '本轮回答已结束';
  return props.hasDelta ? '正在接收回答内容…' : '等待首段回答…';
});

const contextSources = computed(() => [...new Set(props.sources.map((source) => source.trim()).filter(Boolean))]);
const executionLabel = computed(() => {
  if (props.status !== 'complete') return '';
  if (typeof props.tokenCompletion === 'number' && props.tokenCompletion > 0) {
    return `已调用大模型 · ${props.tokenCompletion} 生成 token`;
  }
  if (props.intent === 'TASKS' || props.intent === 'ADVANCE') {
    return '业务数据与规则回复 · 未调用模型';
  }
  return '未观察到模型生成 token';
});
</script>

<template>
  <section
    :aria-busy="status === 'running'"
    class="consultation-path"
    data-testid="ipd-ai-consultation-path"
    aria-label="咨询路径"
  >
    <header class="path-header">
      <div class="path-heading">
        <span class="path-eyebrow">LIVE CONSULTATION</span>
        <h3>咨询路径</h3>
        <p>随本轮响应更新</p>
      </div>
      <span :data-status="status" class="path-status" data-testid="ipd-ai-consultation-status">
        {{ statusLabel }}
      </span>
    </header>

    <div v-if="status === 'idle'" class="path-empty" data-testid="ipd-ai-consultation-idle">
      <strong>输入问题，开始咨询</strong>
      <p>这里将显示本轮问题、响应状态和服务端返回的上下文来源。</p>
    </div>
    <div v-else class="path-flow">
      <article class="path-node" data-testid="ipd-ai-consultation-question">
        <span aria-hidden="true" class="node-marker"></span>
        <div class="node-content">
          <h4>本轮问题</h4>
          <p class="question-text" :title="question">{{ question || '问题内容未提供' }}</p>
        </div>
      </article>

      <article class="path-node" data-testid="ipd-ai-consultation-response">
        <span :class="['node-marker', { 'is-active': status === 'running' }]" aria-hidden="true"></span>
        <div class="node-content">
          <h4>实时响应</h4>
          <p class="response-text" role="status" aria-live="polite">{{ responseText }}</p>
          <span v-if="intent" class="intent-label">返回意图 · {{ intent }}</span>
          <p v-if="executionLabel" class="execution-label" data-testid="ipd-ai-execution-kind">{{ executionLabel }}</p>
          <p v-if="status === 'error' && error" class="response-error" role="alert">{{ error }}</p>
        </div>
      </article>

      <article v-if="contextSources.length" class="path-node" data-testid="ipd-ai-consultation-sources">
        <span aria-hidden="true" class="node-marker"></span>
        <div class="node-content">
          <h4>上下文来源（非引用）</h4>
          <ul class="source-list">
            <li v-for="source in contextSources" :key="source">{{ source }}</li>
          </ul>
        </div>
      </article>
    </div>

    <p class="path-boundary">深度研究步骤事件尚未接入；当前仅展示咨询响应状态。</p>
  </section>
</template>

<style scoped>
.consultation-path {
  display: grid;
  gap: 18px;
  min-width: 0;
  padding: clamp(16px, 3vw, 28px);
  border: 1px solid var(--ipd-line);
  border-radius: 16px;
  background: var(--ipd-surface);
  color: var(--ipd-text);
  box-shadow: 0 8px 28px color-mix(in srgb, var(--ipd-navy) 6%, transparent);
}
.path-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.path-heading { min-width: 0; }
.path-eyebrow { color: var(--ipd-blue); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; }
.path-heading h3 { margin: 5px 0 2px; font-size: 19px; line-height: 1.35; }
.path-heading p { margin: 0; color: var(--ipd-muted); font-size: 12px; }
.path-status { flex: 0 0 auto; padding: 5px 9px; border: 1px solid var(--ipd-line); border-radius: 999px; background: var(--ipd-bg); color: var(--ipd-muted); font-size: 11px; font-weight: 650; }
.path-status[data-status='running'] { border-color: var(--ipd-blue); background: var(--ipd-blue-soft); color: var(--ipd-blue); }
.path-status[data-status='complete'] { color: var(--ipd-text); }
.path-status[data-status='error'] { color: var(--ipd-text); }
.path-empty { padding: 22px; border: 1px dashed var(--ipd-line); border-radius: 12px; background: var(--ipd-bg); }
.path-empty strong { font-size: 14px; }
.path-empty p { max-width: 36em; margin: 5px 0 0; color: var(--ipd-muted); font-size: 12px; line-height: 1.6; }
.path-flow { display: grid; gap: 0; }
.path-node { position: relative; display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 13px; min-width: 0; }
.path-node:not(:last-child)::after { position: absolute; top: 27px; bottom: -1px; left: 6px; width: 1px; background: var(--ipd-line); content: ''; }
.node-marker { width: 13px; height: 13px; margin-top: 14px; border: 2px solid var(--ipd-blue); border-radius: 50%; background: var(--ipd-surface); }
.node-marker.is-active { background: var(--ipd-blue-soft); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ipd-blue) 12%, transparent); }
.node-content { min-width: 0; margin-bottom: 13px; padding: 11px 14px; border: 1px solid var(--ipd-line); border-radius: 10px; background: var(--ipd-bg); }
.node-content h4 { margin: 0 0 5px; color: var(--ipd-muted); font-size: 11px; font-weight: 650; }
.node-content p { margin: 0; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.question-text { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.response-text { color: var(--ipd-text); }
.intent-label { display: inline-block; margin-top: 8px; padding: 3px 7px; border-radius: 6px; background: var(--ipd-blue-soft); color: var(--ipd-blue); font-size: 10px; }
.node-content .execution-label { margin-top: 7px; color: var(--ipd-muted); font-size: 11px; }
.node-content .response-error { margin-top: 7px; color: var(--ipd-text); }
.source-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.source-list li { max-width: 100%; padding: 4px 8px; overflow-wrap: anywhere; border: 1px solid var(--ipd-line); border-radius: 6px; background: var(--ipd-surface); color: var(--ipd-muted); font-size: 11px; }
.path-boundary { margin: 0; padding-top: 11px; border-top: 1px solid var(--ipd-line); color: var(--ipd-muted); font-size: 11px; line-height: 1.5; }
@media (max-width: 768px) {
  .path-header { flex-wrap: wrap; }
  .path-status { margin-left: auto; }
  .node-content { padding: 10px; }
}
</style>
