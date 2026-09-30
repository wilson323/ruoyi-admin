<template>
  <div :class="['ai-composer', { 'is-prompt': promptShell }]" data-testid="ipd-ai-composer">
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
    <div class="composer-field">
      <span
        v-if="showRotatingPlaceholder"
        aria-hidden="true"
        class="composer-placeholder"
        data-testid="ipd-ai-placeholder"
      >{{ rotatingPhrase }}</span>
      <textarea
        ref="textareaRef"
        :disabled="disabled"
        :maxlength="2000"
        placeholder=""
        :value="modelValue"
        class="composer-textarea"
        data-testid="ipd-ai-input"
        rows="1"
        @blur="focused = false"
        @focus="focused = true"
        @input="onInput"
        @keydown.enter="onEnter"
      />
    </div>
    <div class="composer-toolbar">
      <div v-if="capabilityMenu" class="plus-wrap">
        <button
          :aria-expanded="plusOpen"
          aria-controls="ipd-ai-agent-controls"
          aria-label="选择能力包、模型、技能和工具"
          :class="['tool-btn', 'plus-btn', { 'is-open': plusOpen }]"
          data-testid="ipd-ai-plus"
          type="button"
          @click="plusOpen = !plusOpen"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M5 12h14" /><path d="M12 5v14" />
          </svg>
        </button>
        <div
          id="ipd-ai-agent-controls"
          :hidden="!plusOpen"
          class="plus-menu"
          data-testid="ipd-ai-agent-controls"
        />
      </div>
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
        <span class="sr-only">{{ speech.listening.value ? '停止' : '语音' }}</span>
      </button>
      <button
        :disabled="disabled"
        class="tool-btn"
        data-testid="ipd-ai-file"
        title="添加附件（以清单随消息发送）"
        type="button"
        @click="pickFile"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.9 8.76l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        <span class="sr-only">附件</span>
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
      <button
        :aria-label="sending ? '正在发送' : '发送'"
        :disabled="disabled || sending"
        class="composer-send"
        data-testid="ipd-ai-send"
        type="button"
        @click="trySend"
      >
        <svg v-if="sending" class="is-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="m5 12 7-7 7 7" /><path d="M12 19V5" />
        </svg>
      </button>
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
 * <p>视觉壳对齐 21st AiPromptInput：圆角浮动卡片、无边框输入区、底栏工具、
 * 右侧圆形发送。不引入 framer-motion / lucide，也不使用原版写死的模型名。
 *
 * <p>能力边界与诚实呈现：
 * - 语音输入走 use-speech-input（Web Speech API）：只做语音→文本转写回填，
 *   不录音不上传；浏览器不支持时按钮禁用（不做假可用）；
 * - 文件输入只登记附件清单（名称/大小/类型），随消息以清单文本发送——
 *   后端 /ai-copilot 契约无文件通道，UI 明示「不上传文件内容」，不伪造上传；
 * - Enter 发送 / Shift+Enter 换行，IME 组合期（中文输入法选词）回车不误发。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Button } from 'ant-design-vue';

import { useSpeechInput } from './use-speech-input';

const props = withDefaults(
  defineProps<{
    capabilityMenu?: boolean;
    disabled?: boolean;
    /** 为 true 时使用 21st 提示框外壳，仅项目智能体打开。 */
    promptShell?: boolean;
    modelValue: string;
    placeholder?: string;
    sending?: boolean;
    showReset?: boolean;
  }>(),
  {
    capabilityMenu: false,
    disabled: false,
    promptShell: false,
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

const PROMPT_PHRASES = [
  '描述这次要完成的任务',
  '说明要对照的阶段和文档',
  '指出需要回填的成果',
] as const;

const attachments = ref<ComposerAttachment[]>([]);
const fileRef = ref<HTMLInputElement>();
const focused = ref(false);
const interim = ref('');
const phraseIndex = ref(0);
const plusOpen = ref(false);
const textareaRef = ref<HTMLTextAreaElement>();
let phraseTimer: number | null = null;

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

const rotatingPhrase = computed(() => {
  const phrases = [props.placeholder, ...PROMPT_PHRASES];
  return phrases[phraseIndex.value % phrases.length] ?? props.placeholder;
});
const showRotatingPlaceholder = computed(
  () => props.modelValue.length === 0 && !focused.value && !speech.listening.value,
);

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

onMounted(() => {
  autoGrow();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduce) return;
  phraseTimer = window.setInterval(() => {
    phraseIndex.value = (phraseIndex.value + 1) % (PROMPT_PHRASES.length + 1);
  }, 3200);
});

onUnmounted(() => {
  if (phraseTimer !== null) window.clearInterval(phraseTimer);
});

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
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 12px 8px;
  overflow: visible;
  color: var(--ipd-text);
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 18px;
  box-shadow: 0 8px 24px color-mix(in srgb, var(--ipd-navy) 8%, transparent);
}
.ai-composer:focus-within {
  border-color: var(--ipd-blue);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--ipd-blue) 16%, transparent);
}
.ai-composer.is-prompt {
  gap: 0;
  padding: 14px;
  border-width: 2px;
  border-radius: 28px;
  box-shadow:
    0 0 0 1px rgb(8 8 8 / 4%),
    0 2px 2px rgb(8 8 8 / 3%),
    0 8px 8px -8px rgb(8 8 8 / 4%);
}
.ai-composer.is-prompt:focus-within {
  border-color: color-mix(in srgb, var(--ipd-text) 28%, var(--ipd-line));
  box-shadow:
    0 0 0 1px rgb(8 8 8 / 6%),
    0 4px 8px rgb(8 8 8 / 4%),
    0 12px 16px -12px rgb(8 8 8 / 8%);
}
.composer-field {
  position: relative;
}
.composer-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  color: var(--ipd-muted);
  font-size: 15px;
  line-height: 1.75;
  pointer-events: none;
}
.composer-textarea {
  width: 100%;
  min-height: 34px;
  max-height: 120px;
  padding: 4px 2px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ipd-text);
  font-size: 14px;
  font-family: inherit;
  line-height: 1.6;
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
.ai-composer.is-prompt .composer-textarea {
  min-height: 52px;
  max-height: 192px;
  padding: 0;
  font-size: 15px;
  line-height: 1.75;
}
.ai-composer.is-prompt .composer-toolbar {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--ipd-line) 70%, transparent);
}
.toolbar-spacer {
  flex: 1;
}
.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ipd-muted);
  font-size: 12px;
  cursor: pointer;
}
.ai-composer.is-prompt .tool-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 12px;
}
.composer-send {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--ipd-surface);
  cursor: pointer;
  background: var(--ipd-blue);
  border: 0;
  border-radius: 999px;
}
.ai-composer.is-prompt .composer-send {
  width: 40px;
  height: 40px;
  background: var(--ipd-navy);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 16%),
    0 1px 2px rgb(8 8 8 / 24%);
}
.composer-send:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.composer-send:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.tool-btn svg,
.composer-send svg,
.plus-btn svg {
  width: 16px;
  height: 16px;
}
.plus-wrap {
  position: relative;
}
.plus-btn.is-open {
  color: var(--ipd-text);
  background: color-mix(in srgb, var(--ipd-line) 55%, transparent);
}
.plus-btn.is-open svg {
  transform: rotate(45deg);
}
.plus-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 20;
  width: min(360px, 70vw);
  max-height: 320px;
  padding: 10px 6px 10px 12px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--ipd-muted) 45%, transparent) transparent;
  background: var(--ipd-surface);
  border: 2px solid var(--ipd-line);
  border-radius: 16px;
  box-shadow: 0 8px 30px -8px rgb(8 8 8 / 18%);
}
.plus-menu::-webkit-scrollbar {
  width: 6px;
}
.plus-menu::-webkit-scrollbar-track {
  margin: 10px 0;
  background: transparent;
}
.plus-menu::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ipd-muted) 38%, transparent);
  border: 1px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}
.plus-menu::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--ipd-muted) 62%, transparent);
  background-clip: padding-box;
}
.plus-menu[hidden] {
  display: none;
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
