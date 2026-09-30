<script lang="ts" setup>
/**
 * 回复操作：复制，以及转发。
 *
 * 转发优先走系统分享（navigator.share）。环境不支持或分享失败时，
 * 改为复制正文并提示可粘贴转发。用户取消分享不记为失败。
 * 点赞不在这里伪造：持久运行的点赞仍走反馈条（RUN_MESSAGE = runId）。
 */
import { ref } from 'vue';

/** 组件 props。 */
interface Props {
  text: string;
}

const props = defineProps<Props>();
const statusText = ref('');

/**
 * 把正文写入剪贴板。
 *
 * @returns 是否写入成功
 */
async function writeClipboard(): Promise<boolean> {
  const value = props.text;
  if (!value.trim()) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/** 复制当前正文。 */
async function onCopy(): Promise<void> {
  statusText.value = (await writeClipboard()) ? '已复制' : '复制失败';
}

/** 转发当前正文；不能系统分享时退化为复制。 */
async function onForward(): Promise<void> {
  const value = props.text.trim();
  if (!value) return;
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text: value, title: '项目智能体' });
      statusText.value = '已打开转发';
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        statusText.value = '';
        return;
      }
    }
  }
  statusText.value = (await writeClipboard()) ? '已复制，可粘贴转发' : '转发失败';
}
</script>

<template>
  <div v-if="text.trim()" class="ipd-msg-actions" data-testid="message-actions">
    <button type="button" data-testid="message-copy" @click="onCopy">复制</button>
    <button type="button" data-testid="message-forward" @click="onForward">转发</button>
    <span v-if="statusText" class="action-status" role="status">{{ statusText }}</span>
  </div>
</template>

<style scoped>
.ipd-msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 6px;
}
.ipd-msg-actions button {
  padding: 0 2px;
  font: inherit;
  font-size: 12px;
  color: var(--ipd-muted);
  cursor: pointer;
  background: transparent;
  border: 0;
}
.ipd-msg-actions button:hover {
  color: var(--ipd-blue);
}
.ipd-msg-actions button:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.action-status {
  font-size: 12px;
  color: var(--ipd-muted);
}
</style>
