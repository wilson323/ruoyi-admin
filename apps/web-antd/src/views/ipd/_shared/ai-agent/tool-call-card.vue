<script lang="ts" setup>
/**
 * 工具调用卡。结构对齐 21st AiToolCall：扳手图标、状态胶囊、可折叠正文、
 * Input / Output / Error 三块。色值按原组件的 Tailwind 色，不引入 lucide / radix。
 */
import { ref, watch } from 'vue';

import type { ToolCallVisualState } from './tool-call-rows';

interface Props {
  error?: string;
  input?: string;
  name: string;
  output?: string;
  state: ToolCallVisualState;
}

const props = withDefaults(defineProps<Props>(), {
  error: '',
  input: '',
  output: '',
});

const open = ref(false);

watch(
  () => props.state,
  (state) => {
    if (state === 'completed' || state === 'error') open.value = true;
  },
  { immediate: true },
);

function stateLabel(state: ToolCallVisualState): string {
  switch (state) {
    case 'pending':
      return '未返回结果';
    case 'running':
      return '执行中';
    case 'completed':
      return '已完成';
    case 'error':
      return '失败';
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}
</script>

<template>
  <section class="ai-tool-call" :data-state="state" data-slot="ai-tool-call" data-testid="ai-tool-call">
    <button
      type="button"
      class="tool-head"
      data-slot="ai-tool-call-header"
      :aria-expanded="open"
      data-testid="ai-tool-call-toggle"
      @click="open = !open"
    >
      <span class="tool-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </span>
      <span class="tool-main">
        <span class="tool-name">{{ name || '未命名工具' }}</span>
        <span class="tool-state" data-testid="ai-tool-call-state">
          <svg v-if="state === 'pending'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          <svg v-else-if="state === 'running'" class="is-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          <svg v-else-if="state === 'completed'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          {{ stateLabel(state) }}
        </span>
      </span>
      <svg class="tool-chevron" :data-open="open ? 'true' : 'false'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
    <div v-if="open" class="tool-body" data-slot="ai-tool-call-content" data-testid="ai-tool-call-body">
      <div v-if="input" data-slot="ai-tool-call-input" data-testid="ai-tool-call-input">
        <span class="tool-label">Input</span>
        <pre class="tool-pre">{{ input }}</pre>
      </div>
      <div v-if="output" data-slot="ai-tool-call-output" data-testid="ai-tool-call-output">
        <span class="tool-label">Output</span>
        <div class="tool-pre">{{ output }}</div>
      </div>
      <div v-if="error" data-slot="ai-tool-call-error" data-testid="ai-tool-call-error">
        <span class="tool-label is-error">Error</span>
        <div class="tool-error">{{ error }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai-tool-call {
  flex: 1 1 100%;
  overflow: hidden;
  color: var(--ipd-text);
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
}
.tool-head {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 500;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
}
.tool-head:hover { background: color-mix(in srgb, var(--ipd-line) 35%, transparent); }
.tool-head:focus-visible {
  outline: 2px solid var(--ipd-blue);
  outline-offset: -2px;
}
.tool-icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--ipd-muted);
  background: color-mix(in srgb, var(--ipd-line) 55%, var(--ipd-surface));
  border-radius: 6px;
}
.tool-icon svg,
.tool-state svg,
.tool-chevron { width: 16px; height: 16px; }
.tool-state svg { width: 14px; height: 14px; }
.tool-main {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.tool-name {
  font-family: ui-monospace, monospace;
  font-size: 14px;
  word-break: break-all;
}
.tool-state {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 999px;
}
.ai-tool-call[data-state='pending'] .tool-state {
  color: var(--ipd-muted);
  background: color-mix(in srgb, var(--ipd-line) 55%, var(--ipd-surface));
}
.ai-tool-call[data-state='running'] .tool-state {
  color: #1d4ed8;
  background: #dbeafe;
}
.ai-tool-call[data-state='completed'] .tool-state {
  color: #15803d;
  background: #dcfce7;
}
.ai-tool-call[data-state='error'] .tool-state {
  color: #b91c1c;
  background: #fee2e2;
}
:global(html.dark) .ai-tool-call[data-state='running'] .tool-state {
  color: #93c5fd;
  background: #172554;
}
:global(html.dark) .ai-tool-call[data-state='completed'] .tool-state {
  color: #86efac;
  background: #052e16;
}
:global(html.dark) .ai-tool-call[data-state='error'] .tool-state {
  color: #fca5a5;
  background: #450a0a;
}
.tool-chevron {
  flex: none;
  color: var(--ipd-muted);
  transition: transform 0.2s ease;
}
.tool-chevron[data-open='true'] { transform: rotate(180deg); }
.tool-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  border-top: 1px solid var(--ipd-line);
}
.tool-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ipd-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.tool-label.is-error { color: #dc2626; }
.tool-pre {
  padding: 12px;
  margin: 0;
  overflow-x: auto;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ipd-text);
  word-break: break-word;
  white-space: pre-wrap;
  background: color-mix(in srgb, var(--ipd-line) 40%, var(--ipd-surface));
  border-radius: 6px;
}
.tool-error {
  padding: 12px;
  font-size: 14px;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
}
:global(html.dark) .tool-error {
  color: #fca5a5;
  background: rgb(69 10 10 / 30%);
  border-color: #7f1d1d;
}
.is-spin { animation: tool-spin 0.8s linear infinite; }
@keyframes tool-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .is-spin { animation: none; }
}
</style>
