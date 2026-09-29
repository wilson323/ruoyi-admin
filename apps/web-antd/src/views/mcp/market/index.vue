<script setup lang="ts">
import type { VbenFormProps } from '@vben/common-ui';

import type { VxeGridProps } from '#/adapter/vxe-table';
import type { McpMarket } from '#/api/mcp/market/model';

import { ref } from 'vue';

import { useAccess } from '@vben/access';
import { Page, useVbenDrawer } from '@vben/common-ui';
import { getVxePopupContainer } from '@vben/utils';

import {
  Button,
  Card,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
} from 'ant-design-vue';

import { useVbenVxeGrid, vxeCheckboxChecked } from '#/adapter/vxe-table';
import {
  mcpMarketChangeStatus,
  mcpMarketExport,
  mcpMarketList,
  mcpMarketRefresh,
  mcpMarketRemove,
} from '#/api/mcp/market';
import { TableSwitch } from '#/components/table';
import { commonDownloadExcel } from '#/utils/file/download';

import CatalogCards from '../../_shared/catalog-cards.vue';
import { useCatalogCards } from '../../_shared/use-catalog-cards';
import { columns, querySchema } from './data';
import marketDrawer from './market-drawer.vue';
import marketWallDrawer from '../_shared/market-wall-drawer.vue';

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
        return await mcpMarketList({
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
  id: 'mcp-market-index',
  showOverflow: false,
};

const [BasicTable, tableApi] = useVbenVxeGrid({
  formOptions,
  gridOptions,
});

const [MarketDrawer, drawerApi] = useVbenDrawer({
  connectedComponent: marketDrawer,
});

const [MarketWallDrawer, wallDrawerApi] = useVbenDrawer({
  connectedComponent: marketWallDrawer,
});

const viewMode = ref<'card' | 'table'>('card');
const keyword = ref('');
const statusFilter = ref<string>();
const cards = useCatalogCards((pageNum, pageSize) =>
  mcpMarketList({
    pageNum,
    pageSize,
    name: keyword.value.trim(),
    status: statusFilter.value,
  }),
);

async function refreshVisible() {
  if (viewMode.value === 'card') await cards.refresh();
  else await tableApi.query();
}

async function handleCardStatus(row: McpMarket, checked: boolean) {
  await mcpMarketChangeStatus({
    ...row,
    status: checked ? 'ENABLED' : 'DISABLED',
  });
  await cards.refresh();
}

function handleOpenWall(row: McpMarket) {
  wallDrawerApi.setData({ marketId: row.id });
  wallDrawerApi.open();
}

function handleAdd() {
  drawerApi.setData({});
  drawerApi.open();
}

async function handleEdit(record: McpMarket) {
  drawerApi.setData({ id: record.id });
  drawerApi.open();
}

async function handleDelete(row: McpMarket) {
  await mcpMarketRemove([row.id]);
  await refreshVisible();
}

function handleMultiDelete() {
  const rows = tableApi.grid.getCheckboxRecords();
  const ids = rows.map((row: McpMarket) => row.id);
  Modal.confirm({
    title: '提示',
    okType: 'danger',
    content: `确认删除选中的${ids.length}条记录吗？`,
    onOk: async () => {
      await mcpMarketRemove(ids);
      await refreshVisible();
    },
  });
}

async function handleRefresh(row: McpMarket) {
  try {
    const result = await mcpMarketRefresh(row.id);
    message.success(
      `刷新成功，新增 ${result.addedCount} 个工具，更新 ${result.updatedCount} 个工具`,
    );
    await refreshVisible();
  } catch {
    message.error('刷新失败');
  }
}

function handleDownloadExcel() {
  commonDownloadExcel(
    mcpMarketExport,
    'MCP市场数据',
    viewMode.value === 'card'
      ? { name: keyword.value.trim(), status: statusFilter.value }
      : tableApi.formApi.form.values,
  );
}

const { hasAccessByCodes } = useAccess();
</script>

<template>
  <Page :auto-content-height="true">
    <div class="mb-3 flex justify-end">
      <Button @click="viewMode = viewMode === 'card' ? 'table' : 'card'">
        {{ viewMode === 'card' ? '切换表格' : '切换卡片' }}
      </Button>
    </div>
    <CatalogCards
      v-if="viewMode === 'card'"
      title="MCP市场列表"
      :loading="cards.loading.value"
      :error="cards.error.value"
      :total="cards.total.value"
      :page="cards.page.value"
      :page-size="cards.pageSize.value"
      @page-change="cards.changePage"
    >
      <template #actions>
        <Button
          v-access:code="['mcp:market:export']"
          @click="handleDownloadExcel"
          >导出</Button
        >
        <Button
          type="primary"
          v-access:code="['mcp:market:add']"
          @click="handleAdd"
          >新增</Button
        >
      </template>
      <template #filters>
        <Input
          v-model:value="keyword"
          allow-clear
          placeholder="搜索市场名称"
          style="max-width: 280px"
          @press-enter="cards.search"
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
          <span class="break-all">{{ row.url }}</span>
          <Switch
            :checked="row.status === 'ENABLED'"
            :disabled="!hasAccessByCodes(['mcp:market:edit'])"
            checked-children="启用"
            un-checked-children="禁用"
            @change="(checked) => handleCardStatus(row, Boolean(checked))"
          />
        </div>
        <div class="ipd-catalog-card__actions">
          <Button
            size="small"
            v-access:code="['mcp:market:query']"
            @click="handleOpenWall(row)"
            >工具墙</Button
          >
          <Button
            size="small"
            v-access:code="['mcp:market:refresh']"
            @click="handleRefresh(row)"
            >刷新</Button
          >
          <Button
            size="small"
            v-access:code="['mcp:market:edit']"
            @click="handleEdit(row)"
            >编辑</Button
          >
          <Popconfirm title="确认删除？" @confirm="handleDelete(row)">
            <Button size="small" danger v-access:code="['mcp:market:remove']"
              >删除</Button
            >
          </Popconfirm>
        </div>
      </Card>
    </CatalogCards>
    <BasicTable v-else table-title="MCP市场列表">
      <template #toolbar-tools>
        <Space>
          <a-button
            v-access:code="['mcp:market:export']"
            @click="handleDownloadExcel"
          >
            {{ $t('pages.common.export') }}
          </a-button>
          <a-button
            :disabled="!vxeCheckboxChecked(tableApi)"
            danger
            type="primary"
            v-access:code="['mcp:market:remove']"
            @click="handleMultiDelete"
          >
            {{ $t('pages.common.delete') }}
          </a-button>
          <a-button
            type="primary"
            v-access:code="['mcp:market:add']"
            @click="handleAdd"
          >
            {{ $t('pages.common.add') }}
          </a-button>
        </Space>
      </template>
      <template #status="{ row }">
        <TableSwitch
          v-model:value="row.status"
          :api="() => mcpMarketChangeStatus(row)"
          :disabled="!hasAccessByCodes(['mcp:market:edit'])"
          checked-value="ENABLED"
          unchecked-value="DISABLED"
          @reload="tableApi.query()"
        />
      </template>
      <template #action="{ row }">
        <Space>
          <ghost-button
            v-access:code="['mcp:market:query']"
            @click.stop="handleOpenWall(row)"
          >
            工具墙
          </ghost-button>
          <ghost-button
            v-access:code="['mcp:market:refresh']"
            @click.stop="handleRefresh(row)"
          >
            刷新
          </ghost-button>
          <ghost-button
            v-access:code="['mcp:market:edit']"
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
              v-access:code="['mcp:market:remove']"
              @click.stop=""
            >
              {{ $t('pages.common.delete') }}
            </ghost-button>
          </Popconfirm>
        </Space>
      </template>
    </BasicTable>
    <MarketDrawer @reload="refreshVisible" />
    <MarketWallDrawer />
  </Page>
</template>
