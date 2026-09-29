<script setup lang="ts">
/**
 * MCP 连接测试面板（Track E1，修痛点④）。
 *
 * <p>三态 Tag + 耗时 + 结构化结果键值行 + 空态诚实文案。测试按钮在未选中工具时
 * 禁用（guard-on-status UI 面）。取色全部 `var(--ipd-*)`（约束 #21），圆角
 * 6px 控件 / 8px 卡片 / 4px Tag；零新增运行时依赖（约束 #3）。
 */
import { computed } from 'vue';

import { mcpToolTest } from '#/api/mcp/tool';

import { formatDuration } from './tool-test';
import { useToolTest } from './use-tool-test';

const props = defineProps<{ toolId: null | number }>();

const { run, running, state } = useToolTest((toolId) => mcpToolTest(toolId));

const phaseLabel = computed(() => {
  if (running.value) return '测试中';
  if (state.value.testedAt === null) return '待测试';
  return state.value.success ? '通过' : '失败';
});

const phaseClass = computed(() => {
  if (running.value) return 'ipd-tt-tag ipd-tt-tag--running';
  if (state.value.testedAt === null) return 'ipd-tt-tag ipd-tt-tag--idle';
  return state.value.success
    ? 'ipd-tt-tag ipd-tt-tag--ok'
    : 'ipd-tt-tag ipd-tt-tag--err';
});

const resultClass = computed(() =>
  state.value.success
    ? 'ipd-tt-result ipd-tt-result--ok'
    : 'ipd-tt-result ipd-tt-result--err',
);

async function handleRun() {
  if (props.toolId === null || running.value) return;
  await run(props.toolId);
}

defineExpose({
  run: async () => {
    await handleRun();
  },
});
</script>

<template>
  <div class="ipd-tt-panel">
    <div class="ipd-tt-head">
      <span class="ipd-tt-title">连接测试</span>
      <span :class="phaseClass" data-testid="ipd-tt-phase">{{ phaseLabel }}</span>
      <span class="ipd-tt-meta">耗时 {{ formatDuration(state.durationMs) }}</span>
      <a-button
        :disabled="toolId === null || running"
        :loading="running"
        data-testid="ipd-tt-run"
        size="small"
        type="primary"
        @click="handleRun"
      >
        测试连接
      </a-button>
    </div>

    <div v-if="toolId === null" class="ipd-tt-empty">
      未选中工具：请在左侧列表选择工具后执行连接测试。
    </div>

    <template v-else>
      <div
        v-if="state.testedAt !== null"
        :class="resultClass"
        data-testid="ipd-tt-result"
      >
        <div class="ipd-tt-result-msg">{{ state.message }}</div>
        <div class="ipd-tt-meta">测试时间 {{ state.testedAt }}</div>
      </div>

      <div v-if="state.testedAt === null && !running" class="ipd-tt-empty">
        尚未测试：点击「测试连接」验证该工具的连通性与工具列表拉取。
      </div>

      <div v-if="running" class="ipd-tt-empty">测试执行中，请稍候…</div>

      <ul
        v-if="state.payloadRows.length > 0"
        class="ipd-tt-rows"
        data-testid="ipd-tt-rows"
      >
        <li v-for="row in state.payloadRows" :key="row.key" class="ipd-tt-row">
          <span class="ipd-tt-row-key">{{ row.key }}</span>
          <span class="ipd-tt-row-value">{{ row.value }}</span>
        </li>
      </ul>
      <div
        v-else-if="state.testedAt !== null && state.success"
        class="ipd-tt-empty"
      >
        测试通过但未返回结构化结果（data 为空）。
      </div>
    </template>
  </div>
</template>

<style scoped>
.ipd-tt-panel {
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}

.ipd-tt-head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ipd-tt-title {
  color: var(--ipd-text);
  font-size: 14px;
  font-weight: 600;
}

.ipd-tt-tag {
  border-radius: 4px;
  font-size: 12px;
  line-height: 18px;
  padding: 0 8px;
}

.ipd-tt-tag--idle {
  background: var(--ipd-bg);
  border: 1px solid var(--ipd-line);
  color: var(--ipd-muted);
}

.ipd-tt-tag--running {
  background: var(--ipd-amber);
  border: 1px solid var(--ipd-amber);
  color: var(--ipd-surface);
}

.ipd-tt-tag--ok {
  background: var(--ipd-green);
  border: 1px solid var(--ipd-green);
  color: var(--ipd-surface);
}

.ipd-tt-tag--err {
  background: var(--ipd-red);
  border: 1px solid var(--ipd-red);
  color: var(--ipd-surface);
}

.ipd-tt-meta {
  color: var(--ipd-muted);
  font-size: 12px;
}

.ipd-tt-empty {
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 20px;
}

.ipd-tt-result {
  border-left: 3px solid var(--ipd-line);
  border-radius: 6px;
  padding: 8px 10px;
}

.ipd-tt-result--ok {
  background: var(--ipd-blue-soft);
  border-left-color: var(--ipd-green);
}

.ipd-tt-result--err {
  background: var(--ipd-bg);
  border-left-color: var(--ipd-red);
}

.ipd-tt-result-msg {
  color: var(--ipd-text);
  font-size: 13px;
  line-height: 20px;
  word-break: break-all;
}

.ipd-tt-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 0;
}

.ipd-tt-row {
  border-bottom: 1px dashed var(--ipd-line);
  display: flex;
  font-size: 12px;
  gap: 8px;
  padding: 4px 0;
}

.ipd-tt-row-key {
  color: var(--ipd-muted);
  flex: 0 0 120px;
  word-break: break-all;
}

.ipd-tt-row-value {
  color: var(--ipd-text);
  flex: 1;
  word-break: break-all;
}
</style>
