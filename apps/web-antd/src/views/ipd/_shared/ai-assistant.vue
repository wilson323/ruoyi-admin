<script lang="ts" setup>
/**
 * 全局 AI 副驾（R215 AI 融合批次3 = AI-FUSION-B3）。
 *
 * 挂载于 layouts/ipd.vue：所有 IPD 页面共享同一入口（浮钮 + 右抽屉）。
 * 走后端 AiCopilotService 三档上下文（项目/个人/RAG，AI-STRAT-1 Phase 2）——
 * 前端只传 message + 当前项目 id，上下文由后端注入（不教 AI 编数据）。
 *
 * 交互契约：
 * - 默认 SSE 真流式（meta/delta/done/error 四帧），token 逐段渲染；
 * - 多轮 history 只回传最近 8 轮（后端上限，超出前端裁剪）；
 * - BR-AI-04：不做内容过滤，UI 常驻风险提示；
 * - 关闭抽屉即 AbortController 断流（60s SSE 超时前主动止）。
 */
import { computed, nextTick, ref } from 'vue';

import { PhSparkle as Sparkles } from '@phosphor-icons/vue';
import { Alert, Button, Drawer, Input, message as antMessage } from 'ant-design-vue';

import {
  streamCopilot,
} from '../../../api/ipd/ai-copilot';

/** 会话消息（role 与后端 CopilotTurn 对齐；assistant 附流式状态与来源摘要）。 */
interface ChatMessage {
  content: string;
  intent: null | string;
  role: 'assistant' | 'user';
  sources: null | string[];
  streaming: boolean;
}

/** 后端多轮上限 8 轮；SSE 端点契约现状不收 history（AiCopilotController.stream 构造
 *  AiCopilotReq 时 history 固定空列表），多轮上下文待后端扩展后由前端补传（B3 注记）。 */
// const MAX_HISTORY_TURNS = 8;

/** 与 layouts/ipd.vue 同 key：AI 上下文自动跟随全局当前项目。 */
const CURRENT_PROJECT_KEY = 'ipd:current-project';

const open = ref(false);
const inputText = ref('');
const sending = ref(false);
const messages = ref<ChatMessage[]>([]);
const listRef = ref<HTMLElement>();

const currentProjectId = computed(
  () => window.localStorage.getItem(CURRENT_PROJECT_KEY) ?? '',
);

/** 历史裁剪（后端 SSE 契约支持后启用）：最近 8 轮成对回传，取最近。
function historyTurns(): CopilotTurn[] {
  const settled = messages.value
    .filter((m) => !m.streaming && m.content)
    .map((m) => ({ content: m.content, role: m.role }));
  return settled.slice(-MAX_HISTORY_TURNS);
}
*/

async function scrollToListBottom() {
  await nextTick();
  listRef.value?.scrollTo({ behavior: 'smooth', top: listRef.value.scrollHeight });
}

let abort: AbortController | null = null;

async function send() {
  const text = inputText.value.trim();
  if (!text || sending.value) return;
  inputText.value = '';
  sending.value = true;
  messages.value.push(
    { content: text, intent: null, role: 'user', sources: null, streaming: false },
    { content: '', intent: null, role: 'assistant', sources: null, streaming: true },
  );
  await scrollToListBottom();
  abort = new AbortController();
  const assistant = messages.value.at(-1)!;
  try {
    await streamCopilot(
      { message: text, projectId: currentProjectId.value || undefined },
      {
        onDelta: (token) => {
          assistant.content += token;
          scrollToListBottom();
        },
        onDone: () => {
          assistant.streaming = false;
          if (!assistant.content) {
            assistant.content = '（模型未返回内容，请换个问法或稍后重试）';
          }
        },
        onError: (err) => {
          assistant.streaming = false;
          if (!assistant.content) {
            assistant.content = `[${err.code}] ${err.message}`;
          } else {
            assistant.content += `\n\n[流式中断 ${err.code}] ${err.message}`;
          }
        },
        onMeta: (meta) => {
          assistant.intent = meta.intent;
          assistant.sources = meta.sources;
        },
      },
      abort.signal,
    );
  } finally {
    assistant.streaming = false;
    sending.value = false;
    abort = null;
    await scrollToListBottom();
  }
}

function toggleOpen() {
  open.value = !open.value;
  if (!open.value) abort?.abort();
}

function clearConversation() {
  abort?.abort();
  messages.value = [];
  antMessage.info('已开启新会话');
}

defineExpose({ clearConversation, send });
</script>

<template>
  <button
    aria-label="AI 副驾"
    class="ipd-ai-fab"
    data-testid="ipd-ai-fab"
    type="button"
    @click="toggleOpen"
  >
    <Sparkles :size="20" />
    <span>AI 副驾</span>
  </button>
  <Drawer
    :open="open"
    :width="440"
    data-testid="ipd-ai-drawer"
    title="AI 副驾"
    @close="toggleOpen"
  >
    <div class="ipd-ai-panel">
      <Alert
        message="AI 生成内容由大模型产出，未经审核、不做内容过滤，仅供参考（BR-AI-04）。"
        show-icon
        type="warning"
      />
      <div v-if="currentProjectId" class="ctx-chip" data-testid="ipd-ai-ctx">
        已注入当前项目上下文（#{{ currentProjectId }}）：问「我的待办」「项目风险」试试
      </div>
      <div ref="listRef" class="msg-list" data-testid="ipd-ai-messages">
        <div v-if="messages.length === 0" class="empty-hint">
          你好，我是 IPD AI 副驾。可以问项目待办、推进建议，或任何 IPD 流程问题。
        </div>
        <div
          v-for="(m, i) in messages"
          :key="i"
          :class="['msg', m.role]"
          :data-testid="`ipd-ai-msg-${m.role}`"
        >
          <div class="bubble">
            {{ m.content }}<span v-if="m.streaming" class="cursor">▍</span>
          </div>
          <div v-if="m.role === 'assistant' && m.sources?.length" class="sources">
            来源：{{ m.sources.join('；') }}
          </div>
        </div>
      </div>
      <div class="input-row">
        <Input
          v-model:value="inputText"
          :maxlength="2000"
          :disabled="sending"
          placeholder="输入问题，回车发送（≤2000 字）"
          data-testid="ipd-ai-input"
          @keyup.enter="send"
        />
        <Button
          :loading="sending"
          data-testid="ipd-ai-send"
          type="primary"
          @click="send"
        >
          发送
        </Button>
        <Button data-testid="ipd-ai-new" title="开启新会话" @click="clearConversation">
          新会话
        </Button>
      </div>
    </div>
  </Drawer>
</template>

<style scoped>
/* 色板沿用 _shared/ipd-theme.css 的 --ipd-* token（暗色自动翻转） */
.ipd-ai-fab {
  position: fixed;
  right: 28px;
  bottom: 32px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  border: 0;
  border-radius: 999px;
  background: var(--ipd-blue, #2f6fed);
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(47, 111, 237, 0.35);
}
.ipd-ai-fab:focus-visible {
  outline: 2px solid var(--ipd-focus-ring-color, #2f6fed);
  outline-offset: 2px;
}
.ipd-ai-fab:hover {
  filter: brightness(1.08);
}
.ipd-ai-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
}
.ctx-chip {
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--ipd-surface, #f5f7fa);
  border: 1px solid var(--ipd-line, #e2e8f0);
  color: var(--ipd-muted, #6b7488);
  font-size: 12px;
}
.msg-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 2px;
}
.empty-hint {
  color: var(--ipd-muted, #6b7488);
  font-size: 13px;
  line-height: 1.8;
  padding: 12px 4px;
}
.msg.user {
  align-self: flex-end;
}
.msg.assistant {
  align-self: flex-start;
  max-width: 100%;
}
.msg .bubble {
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.user .bubble {
  background: var(--ipd-blue, #2f6fed);
  color: #fff;
  border-bottom-right-radius: 2px;
}
.msg.assistant .bubble {
  background: var(--ipd-surface, #f5f7fa);
  border: 1px solid var(--ipd-line, #e2e8f0);
  color: var(--ipd-text, #26303f);
  border-bottom-left-radius: 2px;
}
.msg .sources {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ipd-muted, #8b94a4);
}
.cursor {
  animation: ipd-ai-blink 1s step-end infinite;
}
@keyframes ipd-ai-blink {
  50% {
    opacity: 0;
  }
}
.input-row {
  display: flex;
  gap: 8px;
}
.input-row .ant-input {
  flex: 1;
}
</style>
