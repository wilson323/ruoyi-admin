<script setup lang="ts">
import type { VbenFormProps } from '@vben/common-ui';

import type { VxeGridProps } from '#/adapter/vxe-table';
import type { InfoForm } from '#/api/knowledge/info/model';

import { ref } from 'vue';

import { Page } from '@vben/common-ui';
import { getVxePopupContainer } from '@vben/utils';

import {
  Button,
  Card,
  Input,
  Modal,
  Popconfirm,
  Space,
  Tag,
} from 'ant-design-vue';

import { useVbenModal } from '@vben/common-ui';
import { useVbenVxeGrid, vxeCheckboxChecked } from '#/adapter/vxe-table';
import { infoExport, infoList, infoRemove } from '#/api/knowledge/info';
import { commonDownloadExcel } from '#/utils/file/download';

import CatalogCards from '../../_shared/catalog-cards.vue';
import { useCatalogCards } from '../../_shared/use-catalog-cards';
import KnowledgeAddModal from './components/KnowledgeAddModal.vue';
import { columns, querySchema } from './data';
import { useRouter } from 'vue-router';

const formOptions: VbenFormProps = {
  commonConfig: {
    labelWidth: 80,
    componentProps: {
      allowClear: true,
    },
  },
  schema: querySchema(),
  wrapperClass: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  // 处理区间选择器 RangePicker 时间格式映射
  // 将一个时间区间字段映射为两个独立的开始/结束时间字段，用于搜索和导出
  // 示例: 将 createTime 字段映射为 params[beginTime] 和 params[endTime]
  // fieldMappingTime: [
  //   [
  //     'createTime', // 表单中的字段名
  //     ['params[beginTime]', 'params[endTime]'], // 映射后的字段名
  //     ['YYYY-MM-DD 00:00:00', 'YYYY-MM-DD 23:59:59'], // 时间格式
  //   ],
  // ],
};

const gridOptions: VxeGridProps = {
  checkboxConfig: {
    // 高亮
    highlight: true,
    // 翻页时保留选中状态
    reserve: true,
    // 点击行选中
    // trigger: 'row',
  },
  // 需要使用i18n注意这里要改成getter形式 否则切换语言不会刷新
  // columns: columns(),
  columns,
  height: 'auto',
  keepSource: true,
  pagerConfig: {},
  proxyConfig: {
    ajax: {
      query: async ({ page }, formValues = {}) => {
        return await infoList({
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
  // 表格全局唯一标识，用于保存列配置
  id: 'system-info-index',
};

const [BasicTable, tableApi] = useVbenVxeGrid({
  formOptions,
  gridOptions,
});

const router = useRouter();

const [AddModal, modalApi] = useVbenModal({
  connectedComponent: KnowledgeAddModal,
});

const viewMode = ref<'card' | 'table'>('card');
const keyword = ref('');
const cards = useCatalogCards((pageNum, pageSize) =>
  infoList({ pageNum, pageSize, name: keyword.value.trim() }),
);

async function refreshVisible() {
  if (viewMode.value === 'card') await cards.refresh();
  else await tableApi.query();
}

function handleAdd() {
  modalApi.open();
}

function handleDetail(row: { id: string | number }) {
  router.push(`/knowledge/info/detail/${row.id}`);
}

async function handleDelete(row: { id: string | number }) {
  await infoRemove(row.id);
  await refreshVisible();
}

function handleMultiDelete() {
  const rows = tableApi.grid.getCheckboxRecords();
  const ids = rows.map((row: Required<InfoForm>) => row.id);
  Modal.confirm({
    title: '提示',
    okType: 'danger',
    content: `确认删除选中的${ids.length}条记录吗？`,
    onOk: async () => {
      await infoRemove(ids);
      await refreshVisible();
    },
  });
}

function handleDownloadExcel() {
  commonDownloadExcel(
    infoExport,
    '知识库数据',
    viewMode.value === 'card'
      ? { name: keyword.value.trim() }
      : tableApi.formApi.form.values,
    {
      fieldMappingTime: formOptions.fieldMappingTime,
    },
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
      title="知识库列表"
      :loading="cards.loading.value"
      :error="cards.error.value"
      :total="cards.total.value"
      :page="cards.page.value"
      :page-size="cards.pageSize.value"
      @page-change="cards.changePage"
    >
      <template #actions>
        <Button
          v-access:code="['system:info:export']"
          @click="handleDownloadExcel"
          >导出</Button
        >
        <Button
          type="primary"
          v-access:code="['system:info:add']"
          @click="handleAdd"
          >新增</Button
        >
      </template>
      <template #filters>
        <Input
          v-model:value="keyword"
          allow-clear
          placeholder="搜索知识库名称"
          style="max-width: 280px"
          @press-enter="cards.search"
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
          <Tag :color="row.share === 1 ? 'blue' : 'default'">{{
            row.share === 1 ? '公开' : '私有'
          }}</Tag>
          <span>向量库：{{ row.vectorModel || '未配置' }}</span>
          <span>向量模型：{{ row.embeddingModel || '未配置' }}</span>
        </div>
        <div class="ipd-catalog-card__actions">
          <Button size="small" @click="handleDetail(row)">详情</Button>
          <Popconfirm title="确认删除？" @confirm="handleDelete(row)">
            <Button size="small" danger v-access:code="['system:info:remove']"
              >删除</Button
            >
          </Popconfirm>
        </div>
      </Card>
    </CatalogCards>
    <BasicTable v-else table-title="知识库列表">
      <template #toolbar-tools>
        <Space>
          <a-button
            v-access:code="['system:info:export']"
            @click="handleDownloadExcel"
          >
            {{ $t('pages.common.export') }}
          </a-button>
          <a-button
            :disabled="!vxeCheckboxChecked(tableApi)"
            danger
            type="primary"
            v-access:code="['system:info:remove']"
            @click="handleMultiDelete"
          >
            {{ $t('pages.common.delete') }}
          </a-button>
          <a-button
            type="primary"
            v-access:code="['system:info:add']"
            @click="handleAdd"
          >
            {{ $t('pages.common.add') }}
          </a-button>
        </Space>
      </template>
      <template #action="{ row }">
        <Space>
          <ghost-button @click.stop="handleDetail(row)"> 详情 </ghost-button>
          <Popconfirm
            :get-popup-container="getVxePopupContainer"
            placement="left"
            title="确认删除？"
            @confirm="handleDelete(row)"
          >
            <ghost-button
              danger
              v-access:code="['system:info:remove']"
              @click.stop=""
            >
              {{ $t('pages.common.delete') }}
            </ghost-button>
          </Popconfirm>
        </Space>
      </template>
    </BasicTable>
    <AddModal @reload="refreshVisible" />
  </Page>
</template>
