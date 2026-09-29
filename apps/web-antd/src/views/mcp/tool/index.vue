<script setup lang="ts">
import type { VbenFormProps } from '@vben/common-ui';

import type { VxeGridProps } from '#/adapter/vxe-table';
import type { McpTool } from '#/api/mcp/tool/model';

import type { ReverseDep } from '../_shared/tool-reverse-deps';

import { computed, onMounted, ref } from 'vue';

import { useAccess } from '@vben/access';
import { Page, useVbenDrawer } from '@vben/common-ui';
import { getVxePopupContainer } from '@vben/utils';

import {
  Card,
  Button,
  Descriptions,
  DescriptionsItem,
  Input,
  List,
  ListItem,
  ListItemMeta,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid, vxeCheckboxChecked } from '#/adapter/vxe-table';
import {
  mcpToolChangeStatus,
  mcpToolExport,
  mcpToolList,
  mcpToolRemove,
} from '#/api/mcp/tool';
import { agentList } from '#/api/agent/agent';
import { TableSwitch } from '#/components/table';
import { commonDownloadExcel } from '#/utils/file/download';

import CatalogCards from '../../_shared/catalog-cards.vue';
import { useCatalogCards } from '../../_shared/use-catalog-cards';
import ToolTestPanel from '../_shared/tool-test-panel.vue';
import {
  buildToolReverseDeps,
  reverseDepsOf,
} from '../_shared/tool-reverse-deps';
import { columns, querySchema } from './data';
import toolDrawer from './tool-drawer.vue';

const formOptions: VbenFormProps = {
  commonConfig: {
    labelWidth: 80,
    componentProps: {
      allowClear: true,
    },
  },
  schema: querySchema(),
  wrapperClass: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
};

const gridOptions: VxeGridProps = {
  checkboxConfig: {
    highlight: true,
    reserve: true,
  },
  columns,
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues = {}) => {
        return await mcpToolList({
          pageNum: page.currentPage,
          pageSize: page.pageSize,
          ...formValues,
        });
      },
    },
  },
  rowConfig: {
    keyField: 'id',
  },
  id: 'mcp-tool-index',
  showOverflow: false,
};

const [BasicTable, tableApi] = useVbenVxeGrid({
  formOptions,
  gridOptions,
});

const [ToolDrawer, drawerApi] = useVbenDrawer({
  connectedComponent: toolDrawer,
});

const { hasAccessByCodes } = useAccess();
const viewMode = ref<'card' | 'table'>('card');
const keyword = ref('');
const typeFilter = ref<string>();
const statusFilter = ref<string>();
const cards = useCatalogCards((pageNum, pageSize) =>
  mcpToolList({
    pageNum,
    pageSize,
    name: keyword.value.trim(),
    type: typeFilter.value,
    status: statusFilter.value,
  }),
);

async function refreshVisible() {
  if (viewMode.value === 'card') await cards.refresh();
  else await tableApi.query();
}

async function handleCardStatus(row: McpTool, checked: boolean) {
  await mcpToolChangeStatus({
    ...row,
    status: checked ? 'ENABLED' : 'DISABLED',
  });
  await cards.refresh();
}

/** E1 三栏：当前选中工具（详情列 + 连接测试面板 + 反向依赖列共用）。 */
const activeTool = ref<McpTool | null>(null);
const testPanelRef = ref<InstanceType<typeof ToolTestPanel> | null>(null);
const reverseDepMap = ref(new Map<number, ReverseDep[]>());
const depsLoadError = ref(false);
const agentsScanned = ref(0);
const depsTruncated = ref(false);

const activeToolDeps = computed(() =>
  activeTool.value
    ? reverseDepsOf(reverseDepMap.value, activeTool.value.id)
    : [],
);

function selectTool(row: McpTool) {
  activeTool.value = row;
}

/**
 * 反向依赖数据装载：agentList 分页拉全（后端 PageResult 一次一页），
 * 最多 20 页护栏；失败/截断走诚实文案，不伪造数据（约束 #7）。
 */
async function loadReverseDeps() {
  depsLoadError.value = false;
  depsTruncated.value = false;
  try {
    const collected: Awaited<ReturnType<typeof agentList>>['rows'] = [];
    let total = Number.POSITIVE_INFINITY;
    for (let pageNum = 1; pageNum <= 20; pageNum += 1) {
      const result = await agentList({ pageNum, pageSize: 100 });
      collected.push(...result.rows);
      total = result.total;
      if (collected.length >= total) break;
    }
    agentsScanned.value = collected.length;
    depsTruncated.value = collected.length < total;
    reverseDepMap.value = buildToolReverseDeps(collected);
  } catch {
    depsLoadError.value = true;
    reverseDepMap.value = new Map();
    agentsScanned.value = 0;
  }
}

onMounted(() => {
  void loadReverseDeps();
});

function handleAdd() {
  drawerApi.setData({});
  drawerApi.open();
}

async function handleEdit(record: McpTool) {
  drawerApi.setData({ id: record.id });
  drawerApi.open();
}

async function handleDelete(row: McpTool) {
  await mcpToolRemove([row.id]);
  if (activeTool.value?.id === row.id) activeTool.value = null;
  await refreshVisible();
  await loadReverseDeps();
}

function handleMultiDelete() {
  const rows = tableApi.grid.getCheckboxRecords();
  const ids = rows.map((row: McpTool) => row.id);
  Modal.confirm({
    title: '提示',
    okType: 'danger',
    content: `确认删除选中的${ids.length}条记录吗？`,
    onOk: async () => {
      await mcpToolRemove(ids);
      if (activeTool.value && ids.includes(activeTool.value.id)) {
        activeTool.value = null;
      }
      await refreshVisible();
      await loadReverseDeps();
    },
  });
}

/** E1：测试入口 = 选中行 + 面板执行（原一行 toast 痛点④废除）。 */
async function handleTest(row: McpTool) {
  selectTool(row);
  await testPanelRef.value?.run();
}

async function handleReload() {
  await refreshVisible();
  await loadReverseDeps();
}

function handleDownloadExcel() {
  commonDownloadExcel(
    mcpToolExport,
    'MCP工具数据',
    viewMode.value === 'card'
      ? {
          name: keyword.value.trim(),
          type: typeFilter.value,
          status: statusFilter.value,
        }
      : tableApi.formApi.form.values,
  );
}
</script>

<template>
  <Page :auto-content-height="true">
    <div class="ipd-tool-bench">
      <div class="ipd-tool-bench__list">
        <div class="mb-3 flex justify-end">
          <Button @click="viewMode = viewMode === 'card' ? 'table' : 'card'">
            {{ viewMode === 'card' ? '切换表格' : '切换卡片' }}
          </Button>
        </div>
        <CatalogCards
          v-if="viewMode === 'card'"
          title="MCP工具列表"
          :loading="cards.loading.value"
          :error="cards.error.value"
          :total="cards.total.value"
          :page="cards.page.value"
          :page-size="cards.pageSize.value"
          @page-change="cards.changePage"
        >
          <template #actions>
            <Button
              v-access:code="['mcp:tool:export']"
              @click="handleDownloadExcel"
              >导出</Button
            >
            <Button
              type="primary"
              v-access:code="['mcp:tool:add']"
              @click="handleAdd"
              >新增</Button
            >
          </template>
          <template #filters>
            <Input
              v-model:value="keyword"
              allow-clear
              placeholder="搜索工具名称"
              style="max-width: 280px"
              @press-enter="cards.search"
            />
            <Select
              v-model:value="typeFilter"
              allow-clear
              placeholder="工具类型"
              style="width: 140px"
              :options="[
                { label: '本地工具', value: 'LOCAL' },
                { label: '远程工具', value: 'REMOTE' },
                { label: '内置工具', value: 'BUILTIN' },
              ]"
            />
            <Select
              v-model:value="statusFilter"
              allow-clear
              placeholder="状态"
              style="width: 130px"
              :options="[
                { label: '启用', value: 'ENABLED' },
                { label: '禁用', value: 'DISABLED' },
              ]"
            />
            <Button @click="cards.search">搜索</Button>
          </template>
          <Card
            v-for="row in cards.rows.value"
            :key="row.id"
            class="ipd-catalog-card"
            size="small"
          >
            <div class="ipd-catalog-card__title">{{ row.name }}</div>
            <div class="ipd-catalog-card__description">
              {{ row.description || '暂无描述' }}
            </div>
            <div class="ipd-catalog-card__meta">
              <Tag>{{ row.type === 'BUILTIN' ? '内置工具' : row.type }}</Tag>
              <Switch
                :checked="row.status === 'ENABLED'"
                :disabled="
                  row.type === 'BUILTIN' || !hasAccessByCodes(['mcp:tool:edit'])
                "
                checked-children="启用"
                un-checked-children="禁用"
                @change="(checked) => handleCardStatus(row, Boolean(checked))"
              />
            </div>
            <div class="ipd-catalog-card__actions">
              <Button size="small" @click="selectTool(row)">详情</Button>
              <Button
                size="small"
                v-access:code="['mcp:tool:test']"
                @click="handleTest(row)"
                >测试</Button
              >
              <Button
                size="small"
                v-access:code="['mcp:tool:edit']"
                @click="handleEdit(row)"
                >编辑</Button
              >
              <Popconfirm title="确认删除？" @confirm="handleDelete(row)">
                <Button size="small" danger v-access:code="['mcp:tool:remove']"
                  >删除</Button
                >
              </Popconfirm>
            </div>
          </Card>
        </CatalogCards>
        <BasicTable v-else table-title="MCP工具列表">
          <template #toolbar-tools>
            <Space>
              <a-button
                v-access:code="['mcp:tool:export']"
                @click="handleDownloadExcel"
              >
                {{ $t('pages.common.export') }}
              </a-button>
              <a-button
                :disabled="!vxeCheckboxChecked(tableApi)"
                danger
                type="primary"
                v-access:code="['mcp:tool:remove']"
                @click="handleMultiDelete"
              >
                {{ $t('pages.common.delete') }}
              </a-button>
              <a-button
                type="primary"
                v-access:code="['mcp:tool:add']"
                @click="handleAdd"
              >
                {{ $t('pages.common.add') }}
              </a-button>
            </Space>
          </template>
          <template #name="{ row }">
            <a
              class="ipd-tool-link"
              :class="{ 'is-active': activeTool?.id === row.id }"
              data-testid="ipd-tool-select"
              @click.stop="selectTool(row)"
            >
              {{ row.name }}
            </a>
          </template>
          <template #status="{ row }">
            <TableSwitch
              v-model:value="row.status"
              :api="() => mcpToolChangeStatus(row)"
              :disabled="
                row.type === 'BUILTIN' || !hasAccessByCodes(['mcp:tool:edit'])
              "
              :checked-value="'ENABLED'"
              :unchecked-value="'DISABLED'"
              @reload="tableApi.query()"
            />
          </template>
          <template #action="{ row }">
            <Space>
              <ghost-button
                v-access:code="['mcp:tool:test']"
                @click.stop="handleTest(row)"
              >
                测试
              </ghost-button>
              <ghost-button
                v-access:code="['mcp:tool:edit']"
                @click.stop="handleEdit(row)"
              >
                {{ $t('pages.common.edit') }}
              </ghost-button>
              <Popconfirm
                :get-popup-container="getVxePopupContainer"
                placement="left"
                title="确认删除？"
                @confirm="handleDelete(row)"
              >
                <ghost-button
                  danger
                  v-access:code="['mcp:tool:remove']"
                  @click.stop=""
                >
                  {{ $t('pages.common.delete') }}
                </ghost-button>
              </Popconfirm>
            </Space>
          </template>
        </BasicTable>
      </div>

      <div class="ipd-tool-bench__detail">
        <Card
          :bordered="false"
          class="ipd-tool-bench__card"
          size="small"
          title="工具详情"
        >
          <template v-if="activeTool">
            <Descriptions :column="1" size="small">
              <DescriptionsItem label="名称">
                {{ activeTool.name }}
              </DescriptionsItem>
              <DescriptionsItem label="类型">
                {{ activeTool.type }}
              </DescriptionsItem>
              <DescriptionsItem label="状态">
                {{ activeTool.status }}
              </DescriptionsItem>
              <DescriptionsItem label="描述">
                {{ activeTool.description }}
              </DescriptionsItem>
              <DescriptionsItem label="创建时间">
                {{ activeTool.createTime }}
              </DescriptionsItem>
            </Descriptions>
          </template>
          <div v-else class="ipd-tool-bench__empty">
            未选中工具：点击左侧工具名称查看详情并执行连接测试。
          </div>
        </Card>
        <ToolTestPanel
          ref="testPanelRef"
          :tool-id="activeTool ? activeTool.id : null"
        />
      </div>

      <div class="ipd-tool-bench__deps">
        <Card
          :bordered="false"
          class="ipd-tool-bench__card"
          size="small"
          title="反向依赖（Agent 绑定）"
        >
          <div v-if="depsLoadError" class="ipd-tool-bench__empty">
            Agent 绑定数据加载失败：反向依赖暂不可用（不显示推测数据）。
          </div>
          <template v-else-if="activeTool">
            <div class="ipd-tool-bench__meta">
              扫描 Agent {{ agentsScanned }} 个
              <span v-if="depsTruncated"
                >（达到 2000 个扫描上限，结果可能不完整）</span
              >
            </div>
            <List
              v-if="activeToolDeps.length > 0"
              :data-source="activeToolDeps"
              size="small"
            >
              <template #renderItem="{ item }">
                <ListItem>
                  <ListItemMeta
                    :description="`Agent ID ${item.agentId}`"
                    :title="item.agentName"
                  />
                </ListItem>
              </template>
            </List>
            <div v-else class="ipd-tool-bench__empty">
              {{
                depsTruncated
                  ? '已扫描范围内未发现绑定；仍可能存在未扫描 Agent。'
                  : '暂无 Agent 绑定该工具（基于 AgentVO.mcpToolIds 实时计算）。'
              }}
            </div>
          </template>
          <div v-else class="ipd-tool-bench__empty">
            未选中工具：选择工具后显示绑定该工具的 Agent。
          </div>
        </Card>
      </div>
    </div>
    <ToolDrawer @reload="handleReload" />
  </Page>
</template>

<style scoped>
.ipd-tool-bench {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) 340px 300px;
  height: 100%;
  overflow: hidden;
}

.ipd-tool-bench__list {
  min-width: 0;
  overflow: auto;
}

.ipd-tool-bench__detail,
.ipd-tool-bench__deps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}

.ipd-tool-bench__card {
  background: var(--ipd-surface);
  border: 1px solid var(--ipd-line);
  border-radius: 8px;
  flex: 0 0 auto;
}

.ipd-tool-bench__empty,
.ipd-tool-bench__meta {
  color: var(--ipd-muted);
  font-size: 12px;
  line-height: 20px;
}

.ipd-tool-link {
  border-radius: 4px;
  color: var(--ipd-blue);
  cursor: pointer;
  padding: 0 4px;
}

.ipd-tool-link:hover {
  background: var(--ipd-blue-soft);
  color: var(--ipd-blue-dark);
}

.ipd-tool-link.is-active {
  background: var(--ipd-blue-soft);
  color: var(--ipd-blue-dark);
  font-weight: 600;
}

@media (max-width: 2100px) {
  .ipd-tool-bench {
    grid-template-columns: minmax(0, 1fr) 340px;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .ipd-tool-bench__list {
    grid-row: 1 / 3;
  }

  .ipd-tool-bench__deps {
    grid-column: 2;
  }
}

@media (max-width: 1700px) {
  .ipd-tool-bench {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto auto;
    overflow: auto;
  }

  .ipd-tool-bench__list {
    grid-row: auto;
  }

  .ipd-tool-bench__deps {
    grid-column: auto;
  }
}
</style>
