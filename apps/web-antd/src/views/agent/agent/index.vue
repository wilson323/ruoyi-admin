<script setup lang="ts">
import type { VbenFormProps } from '@vben/common-ui';

import type { VxeGridProps } from '#/adapter/vxe-table';
import type { AgentVO } from '#/api/agent/agent/model';

import { ref } from 'vue';

import { Page, useVbenDrawer } from '@vben/common-ui';
import { getVxePopupContainer } from '@vben/utils';

import {
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid, vxeCheckboxChecked } from '#/adapter/vxe-table';
import { agentExport, agentList, agentRemove } from '#/api/agent/agent';
import { commonDownloadExcel } from '#/utils/file/download';

import CatalogCards from '../../_shared/catalog-cards.vue';
import { useCatalogCards } from '../../_shared/use-catalog-cards';
import agentDrawer from './agent-drawer.vue';
import { columns, querySchema } from './data';

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
        return await agentList({
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
  id: 'agent-agent-index',
  showOverflow: false,
};

const [BasicTable, tableApi] = useVbenVxeGrid({
  formOptions,
  gridOptions,
});

const [AgentDrawer, drawerApi] = useVbenDrawer({
  connectedComponent: agentDrawer,
});

const viewMode = ref<'card' | 'table'>('card');
const keyword = ref('');
const statusFilter = ref<string>();
const cards = useCatalogCards((pageNum, pageSize) =>
  agentList({
    pageNum,
    pageSize,
    agentName: keyword.value.trim(),
    status: statusFilter.value,
  }),
);

async function refreshVisible() {
  if (viewMode.value === 'card') await cards.refresh();
  else await tableApi.query();
}

function handleAdd() {
  drawerApi.setData({});
  drawerApi.open();
}

async function handleEdit(record: AgentVO) {
  drawerApi.setData({ id: record.id });
  drawerApi.open();
}

async function handleDelete(row: AgentVO) {
  await agentRemove([row.id]);
  await refreshVisible();
}

function handleMultiDelete() {
  const rows = tableApi.grid.getCheckboxRecords();
  const ids = rows.map((row: AgentVO) => row.id);
  Modal.confirm({
    title: '提示',
    okType: 'danger',
    content: `确认删除选中的${ids.length}条记录吗？`,
    onOk: async () => {
      await agentRemove(ids);
      await refreshVisible();
    },
  });
}

function handleDownloadExcel() {
  commonDownloadExcel(
    agentExport,
    '智能体数据',
    viewMode.value === 'card'
      ? { agentName: keyword.value.trim(), status: statusFilter.value }
      : tableApi.formApi.form.values,
  );
}
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
      title="智能体列表"
      :loading="cards.loading.value"
      :error="cards.error.value"
      :total="cards.total.value"
      :page="cards.page.value"
      :page-size="cards.pageSize.value"
      @page-change="cards.changePage"
    >
      <template #actions>
        <Button
          v-access:code="['agent:agent:export']"
          @click="handleDownloadExcel"
          >导出</Button
        >
        <Button
          type="primary"
          v-access:code="['agent:agent:add']"
          @click="handleAdd"
          >新增</Button
        >
      </template>
      <template #filters>
        <Input
          v-model:value="keyword"
          allow-clear
          placeholder="搜索智能体名称"
          style="max-width: 280px"
          @press-enter="cards.search"
        />
        <Select
          v-model:value="statusFilter"
          allow-clear
          placeholder="状态"
          style="width: 130px"
          :options="[
            { label: '正常', value: '0' },
            { label: '停用', value: '1' },
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
        <div class="ipd-catalog-card__title">{{ row.agentName }}</div>
        <div class="ipd-catalog-card__description">
          {{ row.agentDescribe || '暂无描述' }}
        </div>
        <div class="ipd-catalog-card__meta">
          <Tag :color="row.status === '1' ? 'default' : 'success'">{{
            row.status === '1' ? '停用' : '正常'
          }}</Tag>
          <span>模型：{{ row.modelName || '未绑定' }}</span>
          <span v-if="row.mcpToolIds || row.skillNames || row.knowledgeIds">
            工具 {{ row.mcpToolIds?.length ?? '未提供' }} · Skill
            {{ row.skillNames?.length ?? '未提供' }} · 知识库
            {{ row.knowledgeIds?.length ?? '未提供' }}
          </span>
          <span v-else>绑定详情请进入编辑查看</span>
        </div>
        <div class="ipd-catalog-card__actions">
          <Button
            size="small"
            v-access:code="['agent:agent:edit']"
            @click="handleEdit(row)"
            >编辑</Button
          >
          <Popconfirm title="确认删除？" @confirm="handleDelete(row)">
            <Button size="small" danger v-access:code="['agent:agent:remove']"
              >删除</Button
            >
          </Popconfirm>
        </div>
      </Card>
    </CatalogCards>
    <BasicTable v-else table-title="智能体列表">
      <template #toolbar-tools>
        <Space>
          <a-button
            v-access:code="['agent:agent:export']"
            @click="handleDownloadExcel"
          >
            {{ $t('pages.common.export') }}
          </a-button>
          <a-button
            :disabled="!vxeCheckboxChecked(tableApi)"
            danger
            type="primary"
            v-access:code="['agent:agent:remove']"
            @click="handleMultiDelete"
          >
            {{ $t('pages.common.delete') }}
          </a-button>
          <a-button
            type="primary"
            v-access:code="['agent:agent:add']"
            @click="handleAdd"
          >
            {{ $t('pages.common.add') }}
          </a-button>
        </Space>
      </template>
      <template #action="{ row }">
        <Space>
          <ghost-button
            v-access:code="['agent:agent:edit']"
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
              v-access:code="['agent:agent:remove']"
              @click.stop=""
            >
              {{ $t('pages.common.delete') }}
            </ghost-button>
          </Popconfirm>
        </Space>
      </template>
    </BasicTable>
    <AgentDrawer @reload="refreshVisible" />
  </Page>
</template>
