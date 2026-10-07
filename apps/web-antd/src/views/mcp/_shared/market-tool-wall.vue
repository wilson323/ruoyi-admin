<script setup lang="ts">
/**
 * 市场工具墙（Track E2）：卡片网格 + 单个/批量「加载到本地」+ 分页 + 刷新市场。
 *
 * <p>数据源全部为既有 api（mcpMarketToolList/mcpMarketLoadTool/
 * mcpMarketBatchLoadTools/mcpMarketRefresh），零新增端点（约束 #20）。
 * 元数据呈现：metadataView 在场 → Schema 树；缺席 → 「元数据未透出」诚实空态。
 */
import type { McpMarketTool } from '#/api/mcp/market/model';

import { onMounted, ref, watch } from 'vue';

import { message } from 'ant-design-vue';

import {
  mcpMarketBatchLoadTools,
  mcpMarketLoadTool,
  mcpMarketRefresh,
  mcpMarketToolList,
} from '#/api/mcp/market';

import AddToAgentDialog from './add-to-agent-dialog.vue';
import MetadataTree from './metadata-tree.vue';
import { parseMetadataView } from './market-metadata';

const props = defineProps<{ marketId: number }>();

const PAGE_SIZE = 12;

const tools = ref<McpMarketTool[]>([]);
const page = ref(1);
const total = ref(0);
const loading = ref(false);
const loadError = ref(false);
const checkedIds = ref<number[]>([]);
const actionPending = ref(false);
const agentDialogOpen = ref(false);
const agentDialogTool = ref<null | { id: number; name: string }>(null);

async function loadPage(nextPage: number) {
  loading.value = true;
  loadError.value = false;
  try {
    const result = await mcpMarketToolList(props.marketId, {
      page: nextPage,
      size: PAGE_SIZE,
    });
    tools.value = result.data ?? [];
    total.value = result.total;
    page.value = nextPage;
    checkedIds.value = [];
  } catch {
    loadError.value = true;
    tools.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadPage(1);
});

watch(
  () => props.marketId,
  (nextId, prevId) => {
    if (nextId !== prevId) void loadPage(1);
  },
);

function toggleChecked(toolId: number, checked: boolean) {
  if (checked) {
    if (!checkedIds.value.includes(toolId)) checkedIds.value.push(toolId);
  } else {
    checkedIds.value = checkedIds.value.filter((id) => id !== toolId);
  }
}

async function handleLoadOne(tool: McpMarketTool) {
  actionPending.value = true;
  try {
    await mcpMarketLoadTool(tool.id);
    await loadPage(page.value);
  } finally {
    actionPending.value = false;
  }
}

async function handleBatchLoad() {
  if (checkedIds.value.length === 0) return;
  actionPending.value = true;
  try {
    await mcpMarketBatchLoadTools(checkedIds.value);
    await loadPage(page.value);
  } finally {
    actionPending.value = false;
  }
}

async function handleRefresh() {
  actionPending.value = true;
  try {
    await mcpMarketRefresh(props.marketId);
    await loadPage(1);
  } finally {
    actionPending.value = false;
  }
}

/**
 * 「加入智能体」：未加载工具先自动加载到本地，取 localToolId 后打开选择框。
 * 绑定值始终使用 localToolId（mcp_tool_info.id），不用市场行 id（M1 审计「易踩坑 #5」）。
 */
async function handleAddToAgent(tool: McpMarketTool) {
  actionPending.value = true;
  try {
    let localId =
      tool.isLoaded && tool.localToolId ? tool.localToolId : null;
    if (!localId) {
      await mcpMarketLoadTool(tool.id);
      await loadPage(page.value);
      localId =
        tools.value.find((item) => item.id === tool.id)?.localToolId ?? null;
    }
    if (!localId) {
      message.warning('加载后未取得本地工具编号，请刷新后重试');
      return;
    }
    agentDialogTool.value = { id: localId, name: tool.toolName };
    agentDialogOpen.value = true;
  } catch {
    message.error('加载工具失败，请稍后重试');
  } finally {
    actionPending.value = false;
  }
}
</script>

<template>
  <div class="ipd-wall">
    <div class="ipd-wall__bar">
      <a-button
        :disabled="checkedIds.length === 0 || actionPending"
        :loading="actionPending"
        data-testid="ipd-wall-batch"
        size="small"
        type="primary"
        @click="handleBatchLoad"
      >
        批量加载（{{ checkedIds.length }}）
      </a-button>
      <a-button
        :disabled="actionPending"
        data-testid="ipd-wall-refresh"
        size="small"
        @click="handleRefresh"
      >
        刷新市场
      </a-button>
      <span class="ipd-wall__meta">共 {{ total }} 个工具</span>
    </div>

    <div v-if="loadError" class="ipd-wall__empty">
      市场工具加载失败：请检查市场地址后重试（不显示缓存假数据）。
    </div>
    <a-spin v-else :spinning="loading">
      <div class="ipd-wall__grid">
        <div v-for="tool in tools" :key="tool.id" class="ipd-wall__card">
          <div class="ipd-wall__card-head">
            <a-checkbox
              :checked="checkedIds.includes(tool.id)"
              @change="(e: Event) => toggleChecked(tool.id, (e.target as HTMLInputElement).checked)"
            />
            <span class="ipd-wall__name">{{ tool.toolName }}</span>
            <a-tag v-if="tool.toolVersion" class="ipd-wall__tag" color="blue">
              {{ tool.toolVersion }}
            </a-tag>
            <a-tag
              :class="
                tool.isLoaded
                  ? 'ipd-wall__tag ipd-wall__tag--loaded'
                  : 'ipd-wall__tag'
              "
            >
              {{ tool.isLoaded ? '已加载' : '未加载' }}
            </a-tag>
          </div>
          <div class="ipd-wall__desc">{{ tool.toolDescription || '（无描述）' }}</div>

          <template v-if="parseMetadataView(tool.metadataView).available">
            <div class="ipd-wall__sub">工具元数据</div>
            <MetadataTree :nodes="parseMetadataView(tool.metadataView).nodes" />
          </template>
          <div v-else class="ipd-wall__empty-inline">
            暂无可展示的工具元数据。
          </div>

          <div class="ipd-wall__actions">
            <a-button
              :disabled="tool.isLoaded || actionPending"
              size="small"
              type="link"
              @click="handleLoadOne(tool)"
            >
              加载到本地
            </a-button>
            <a-button
              v-access:code="['agent:agent:edit']"
              :disabled="actionPending"
              size="small"
              type="link"
              @click="handleAddToAgent(tool)"
            >
              加入智能体
            </a-button>
            <a-button
              v-if="tool.isLoaded && tool.localToolId"
              disabled
              size="small"
              type="link"
            >
              本地工具 ID {{ tool.localToolId }}
            </a-button>
          </div>
        </div>
      </div>
      <div v-if="!loadError && tools.length === 0" class="ipd-wall__empty">
        该市场暂无工具：可先点击「刷新市场」拉取上游清单。
      </div>
    </a-spin>

    <a-pagination
      v-if="total > PAGE_SIZE"
      :current="page"
      :page-size="PAGE_SIZE"
      :total="total"
      class="ipd-wall__pager"
      size="small"
      @change="(p: number) => loadPage(p)"
    />

    <AddToAgentDialog
      v-model:open="agentDialogOpen"
      :tool-id="agentDialogTool?.id ?? null"
      :tool-name="agentDialogTool?.name"
    />
  </div>
</template>

<style scoped>
.ipd-wall {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ipd-wall__bar {
  align-items: center;
  display: flex;
  gap: 8px;
}

.ipd-wall__meta {
  color: var(--ipd-muted);
  font-size: 12px;
}

.ipd-wall__grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}

.ipd-wall__card {
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}

.ipd-wall__card-head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ipd-wall__name {
  color: var(--ipd-text);
  font-size: 14px;
  font-weight: 600;
  word-break: break-all;
}

.ipd-wall__tag {
  border-radius: 4px;
}

.ipd-wall__tag--loaded {
  background: var(--ipd-green);
  border-color: var(--ipd-green);
  color: var(--ipd-surface);
}

.ipd-wall__desc {
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 20px;
  min-height: 40px;
  word-break: break-all;
}

.ipd-wall__sub {
  color: var(--ipd-text);
  font-size: 12px;
  font-weight: 600;
}

.ipd-wall__empty,
.ipd-wall__empty-inline {
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 20px;
}

.ipd-wall__actions {
  display: flex;
  gap: 4px;
  margin-top: auto;
}

.ipd-wall__pager {
  align-self: flex-end;
}
</style>
