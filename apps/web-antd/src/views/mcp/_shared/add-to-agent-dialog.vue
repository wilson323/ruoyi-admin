<script setup lang="ts">
/**
 * 「加入智能体」选择框（Track E 补口）：勾选一个或多个智能体 → 把 MCP 工具
 * 并入其 mcpToolIds（agentInfo 读全量 → 合并 → agentUpdate 写回）。
 *
 * <p>复用既有 api（agentList/agentInfo/agentUpdate），零新增端点（约束 #20）；
 * 空态与失败态均为诚实文案，不伪造数据（约束 #7）。
 */
import { computed, ref, watch } from 'vue';

import { Checkbox, Input, Modal, message } from 'ant-design-vue';

import { agentList } from '#/api/agent/agent';

import { addToolToAgents, normalizeToolId } from './add-to-agent';

const props = defineProps<{
  open: boolean;
  toolId: null | number | string;
  toolName?: string;
}>();

const emit = defineEmits<{ 'update:open': [boolean] }>();

const agents = ref<Array<{ agentName: string; id: number | string }>>([]);
const checkedIds = ref<Array<number | string>>([]);
const keyword = ref('');
const loading = ref(false);
const loadError = ref(false);
const submitting = ref(false);
const resultSummary = ref('');

const filteredAgents = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return agents.value;
  return agents.value.filter((a) => a.agentName.toLowerCase().includes(k));
});

const confirmDisabled = computed(
  () =>
    loading.value ||
    loadError.value ||
    submitting.value ||
    checkedIds.value.length === 0,
);

const title = computed(() =>
  props.toolName ? `把「${props.toolName}」加入智能体` : '加入智能体',
);

/** agentList 分页拉全（最多 20 页护栏）；失败走诚实文案，不显示缓存假数据。 */
async function loadAgents() {
  loading.value = true;
  loadError.value = false;
  resultSummary.value = '';
  try {
    const collected: Awaited<ReturnType<typeof agentList>>['rows'] = [];
    let total = Number.POSITIVE_INFINITY;
    for (let pageNum = 1; pageNum <= 20; pageNum += 1) {
      const result = await agentList({ pageNum, pageSize: 100 });
      collected.push(...result.rows);
      total = result.total;
      if (collected.length >= total) break;
    }
    agents.value = collected.map((a) => ({
      agentName: a.agentName,
      id: a.id,
    }));
    checkedIds.value = [];
  } catch {
    loadError.value = true;
    agents.value = [];
    checkedIds.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (next) => {
    if (next) void loadAgents();
  },
  { immediate: true },
);

function toggleChecked(agentId: number | string, checked: boolean) {
  if (checked) {
    if (!checkedIds.value.includes(agentId)) checkedIds.value.push(agentId);
  } else {
    checkedIds.value = checkedIds.value.filter((id) => id !== agentId);
  }
}

/** antd Checkbox 的 change 事件载荷（结构化最小面，避免深层类型导入）。 */
interface CheckboxLikeEvent {
  target: { checked: boolean };
}

function onAgentCheckChange(agentId: number | string, e: CheckboxLikeEvent) {
  toggleChecked(agentId, e.target.checked);
}

function close() {
  emit('update:open', false);
}

async function handleConfirm() {
  const toolId = normalizeToolId(props.toolId ?? '');
  if (toolId === null || checkedIds.value.length === 0) return;
  submitting.value = true;
  try {
    const picked = agents.value.filter((a) => checkedIds.value.includes(a.id));
    const outcomes = await addToolToAgents(toolId, picked);
    const added = outcomes.filter((o) => o.result === 'added').length;
    const already = outcomes.filter((o) => o.result === 'already').length;
    const failed = outcomes.filter((o) => o.result === 'failed').length;
    resultSummary.value = `已加入 ${added} 个 · 已在其中 ${already} 个${
      failed > 0 ? ` · 失败 ${failed} 个` : ''
    }`;
    if (failed > 0) {
      message.warning(resultSummary.value);
    } else {
      message.success(resultSummary.value);
      close();
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Modal
    :confirm-loading="submitting"
    :ok-button-props="{ disabled: confirmDisabled }"
    :open="open"
    :title="title"
    cancel-text="取消"
    ok-text="加入"
    @cancel="close"
    @ok="handleConfirm"
  >
    <div class="ipd-add-agent">
      <Input
        v-model:value="keyword"
        allow-clear
        placeholder="搜索智能体名称"
      />
      <div v-if="loading" class="ipd-add-agent__tip">加载中…</div>
      <div
        v-else-if="loadError"
        class="ipd-add-agent__tip ipd-add-agent__tip--error"
      >
        智能体列表加载失败：请检查权限后重试（不显示缓存数据）。
      </div>
      <div v-else-if="filteredAgents.length === 0" class="ipd-add-agent__tip">
        {{
          agents.length === 0
            ? '还没有智能体：请先在「智能体管理」新建一个，再回来加入。'
            : '没有匹配的智能体。'
        }}
      </div>
      <div v-else class="ipd-add-agent__list">
        <Checkbox
          v-for="agent in filteredAgents"
          :key="agent.id"
          :checked="checkedIds.includes(agent.id)"
          @change="(e) => onAgentCheckChange(agent.id, e)"
        >
          {{ agent.agentName }}
        </Checkbox>
      </div>
      <div v-if="resultSummary" class="ipd-add-agent__tip">
        {{ resultSummary }}
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.ipd-add-agent {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ipd-add-agent__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow: auto;
}

.ipd-add-agent__tip {
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 20px;
}

.ipd-add-agent__tip--error {
  color: var(--ipd-red, #d4380d);
}
</style>
