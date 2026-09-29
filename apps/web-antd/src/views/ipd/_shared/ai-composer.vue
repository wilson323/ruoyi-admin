<template>
  <div class="ai-composer" data-testid="ipd-ai-composer">
    <div v-if="attachments.length" class="composer-files" data-testid="ipd-ai-attachments">
      <span v-for="(file, index) in attachments" :key="`${file.name}-${index}`" class="file-chip">
        {{ file.name }} <small>{{ formatAttachmentSize(file.size) }}</small>
        <button
          aria-label="移除附件"
          class="file-chip-remove"
          data-testid="ipd-ai-attachment-remove"
          type="button"
          @click="removeAttachment(index)"
        >
          ×
        </button>
      </span>
      <p class="file-note">附件以清单随消息发送（后端文件通道未开放，不上传文件内容）</p>
    </div>
    <textarea
      ref="textareaRef"
      :disabled="disabled"
      :maxlength="2000"
      :placeholder="placeholder"
      :value="modelValue"
      class="composer-textarea"
      data-testid="ipd-ai-input"
      rows="1"
      @input="onInput"
      @keydown.enter="onEnter"
    />
    <div class="composer-toolbar">
      <button
        :aria-label="voiceAriaLabel"
        :aria-pressed="speech.listening.value"
        :class="['tool-btn', { 'is-recording': speech.listening.value }]"
        :disabled="disabled || !speech.supported"
        :title="speech.supported ? (speech.listening.value ? '停止语音输入' : '语音输入（转写回填输入框）') : '当前浏览器不支持语音输入'"
        data-testid="ipd-ai-voice"
        type="button"
        @click="toggleVoice"
      >
        {{ speech.listening.value ? '停止' : '语音' }}
      </button>
      <button
        :disabled="disabled"
        class="tool-btn"
        data-testid="ipd-ai-file"
        title="添加附件（以清单随消息发送）"
        type="button"
        @click="pickFile"
      >
        附件
      </button>
      <span
        aria-live="polite"
        class="voice-hint"
        data-testid="ipd-ai-voice-hint"
        role="status"
      >
        {{ voiceHint }}
      </span>
      <span class="toolbar-spacer" />
      <Button
        :disabled="disabled"
        :loading="sending"
        data-testid="ipd-ai-send"
        type="primary"
        @click="trySend"
      >
        发送
      </Button>
      <Button
        v-if="showReset"
        :disabled="disabled"
        data-testid="ipd-ai-new"
        title="开启新会话"
        @click="emit('reset')"
      >
        新会话
      </Button>
    </div>
    <input
      ref="fileRef"
      class="file-input"
      data-testid="ipd-ai-file-input"
      multiple
      type="file"
      @change="onFileChange"
    />
  </div>
</template>

<script lang="ts">
/** 附件描述（受控清单：只随消息发名称/大小/类型清单，不上传文件内容）。 */
export interface ComposerAttachment {
  name: string;
  size: number;
  type: string;
}

/** 附件大小可读化（B/KB/MB）；导出供消息清单与 chip 共用（DRY）。 */
export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<script setup lang="ts">
/**
 * AI 副驾输入框（语音 + 文件 + 发送）· 2026-09-29。
 *
 * <p>交互范式参考 21st.dev 书签组件（AI Prompt Input 浮动工具条 / Assistant Tabs
 * 语音态 / Prompt Bar），按本仓规约移植：Vue SFC + Ant Design Vue 按钮 + 原生
 * textarea，色板只用 --ipd-* token，零新增依赖。
 *
 * <p>与 21st 原版 AiPromptInput（demo 23958）逐点对齐后保留的行为：
 * - 输入框 JS 自动增高（minRows/maxRows 夹取 + 超高转 overflowY: auto），
 *   对齐原版 mirror-div 自适应方案，不依赖 field-sizing（Safari/Firefox 不支持）；
 * - Enter 发送 / Shift+Enter 换行 / IME 组合期不误发（与原版 onKeyDown 同判据）；
 * - 语音按钮 aria-pressed + 动态 aria-label，提示区 role=status aria-live=polite
 *   （对齐原版 MicButton / VoiceModeBadge 的可访问性面）；
 * - 录音态脉冲动画包在 prefers-reduced-motion: no-preference 内（对齐原版
 *   usePrefersReducedMotion 降级）。
 * <p>刻意不移植：rotating placeholder、模型选择器、framer-motion/lucide 依赖
 * （原型无此需求 + design.json avoid 清单禁新依赖，避免过度设计）。
 *
 * <p>能力边界与诚实呈现：
 * - 语音输入走 use-speech-input（Web Speech API）：只做语音→文本转写回填，
 *   不录音不上传；浏览器不支持时按钮禁用（不做假可用）；
 * - 文件输入只登记附件清单（名称/大小/类型），随消息以清单文本发送——
 *   后端 /ai-copilot 契约无文件通道，UI 明示「不上传文件内容」，不伪造上传；
 * - Enter 发送 / Shift+Enter 换行，IME 组合期（中文输入法选词）回车不误发。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { Button } from 'ant-design-vue';

import { useSpeechInput } from './use-speech-input';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    modelValue: string;
    placeholder?: string;
    sending?: boolean;
    showReset?: boolean;
  }>(),
  {
    disabled: false,
    placeholder: '输入问题，回车发送（Shift+回车换行，≤2000 字）',
    sending: false,
    showReset: true,
  },
);

const emit = defineEmits<{
  (e: 'reset'): void;
  (e: 'send', payload: { attachments: ComposerAttachment[]; text: string }): void;
  (e: 'update:modelValue', value: string): void;
}>();

const attachments = ref<ComposerAttachment[]>([]);
const fileRef = ref<HTMLInputElement>();
const interim = ref('');
const textareaRef = ref<HTMLTextAreaElement>();

/** 输入框自动增高的上下界（与 .composer-textarea 的 min/max-height 同源）。 */
const MIN_HEIGHT = 34;
const MAX_HEIGHT = 120;

const speech = useSpeechInput({
  onFinalText: (text) => {
    appendToInput(text);
    interim.value = '';
  },
  onInterimText: (text) => {
    interim.value = text;
  },
});

const voiceHint = computed(() => {
  if (speech.listening.value) {
    return interim.value ? `识别中：${interim.value}` : '录音中…（再次点击停止）';
  }
  return speech.error.value || (speech.supported ? '' : '当前浏览器不支持语音输入');
});

const voiceAriaLabel = computed(() => {
  if (!speech.supported) return '当前浏览器不支持语音输入';
  return speech.listening.value ? '停止语音输入' : '开始语音输入';
});

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
  autoGrow();
}

/** JS 自动增高：先归零再按 scrollHeight 夹取，超出上界才出滚动条。 */
function autoGrow() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`;
  el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
}

onMounted(autoGrow);
watch(
  () => props.modelValue,
  () => void nextTick(autoGrow),
);

function appendToInput(text: string) {
  const base = props.modelValue;
  const sep = base && !base.endsWith('\n') && !base.endsWith(' ') ? ' ' : '';
  emit('update:modelValue', base + sep + text);
}

function toggleVoice() {
  if (speech.listening.value) {
    speech.stop();
    return;
  }
  interim.value = '';
  speech.start();
}

function pickFile() {
  fileRef.value?.click();
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  for (const file of Array.from(input.files ?? [])) {
    attachments.value.push({ name: file.name, size: file.size, type: file.type });
  }
  input.value = '';
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1);
}

function onEnter(event: KeyboardEvent) {
  // Shift+Enter 换行（默认行为，不发送）；IME 组合期（中文输入法选词）回车不误发。
  if (event.shiftKey) return;
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  trySend();
}

function trySend() {
  if (props.disabled || props.sending) return;
  const text = props.modelValue.trim();
  if (!text && attachments.value.length === 0) return;
  if (speech.listening.value) speech.stop();
  emit('send', { attachments: [...attachments.value], text });
  attachments.value = [];
  interim.value = '';
}
</script>

<style scoped>
/* 色板：只用全局 --ipd-* token（Global Constraint #21），禁 hex */
.ai-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  background: var(--ipd-surface);
}
.ai-composer:focus-within {
  border-color: var(--ipd-blue);
  box-shadow: 0 0 0 var(--ipd-focus-ring-width) color-mix(in srgb, var(--ipd-blue) 18%, transparent);
}
.composer-textarea {
  width: 100%;
  min-height: 34px;
  max-height: 120px;
  padding: 7px 8px;
  border: 1px solid var(--ipd-line);
  border-radius: 6px;
  background: var(--ipd-bg);
  color: var(--ipd-text);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.7;
  /* 高度由 autoGrow() 接管（对齐 21st AiPromptInput 自适应方案），禁手动拉伸避免双轨 */
  resize: none;
  overflow-y: hidden;
}
.composer-textarea:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.composer-textarea:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.composer-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolbar-spacer {
  flex: 1;
}
.tool-btn {
  padding: 4px 12px;
  border: 1px solid var(--ipd-line);
  border-radius: 6px;
  background: var(--ipd-surface);
  color: var(--ipd-text);
  font-size: 12px;
  cursor: pointer;
}
.tool-btn:hover:not(:disabled) {
  background: var(--ipd-blue-soft);
}
.tool-btn:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.tool-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.tool-btn.is-recording {
  border-color: var(--ipd-red);
  background: color-mix(in srgb, var(--ipd-red) 12%, transparent);
  color: var(--ipd-red);
}
/* 录音态脉冲：仅在用户未要求减少动效时启用（对齐 21st usePrefersReducedMotion 降级） */
@keyframes composer-recording-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--ipd-red) 32%, transparent);
  }
  100% {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--ipd-red) 0%, transparent);
  }
}
@media (prefers-reduced-motion: no-preference) {
  .tool-btn.is-recording {
    animation: composer-recording-pulse 1.4s ease-out infinite;
  }
}
.voice-hint {
  min-width: 0;
  overflow: hidden;
  color: var(--ipd-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.file-chip {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 2px 8px;
  border: 1px solid var(--ipd-line);
  border-radius: 4px;
  background: var(--ipd-bg);
  color: var(--ipd-text);
  font-size: 11px;
}
.file-chip small {
  color: var(--ipd-muted);
}
.file-chip-remove {
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--ipd-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.file-chip-remove:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.file-note {
  flex-basis: 100%;
  margin: 0;
  color: var(--ipd-muted);
  font-size: 11px;
}
.file-input {
  display: none;
}
</style>
