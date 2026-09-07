<script setup lang="ts">
/**
 * 页16 产品管理-产品目录（卡 P0-10.16；后端 P1-1.2 /api/v1/products）。
 *
 * 后端真值：
 * - GET /products 返回裸 List 全量（忽略分页参数），前端自管分页；
 * - listingStatus 字段在后端为 status（ON_SALE/IN_RD/INACTIVE/ACTIVE）；
 * - 关键词 keyword 仅作用于 productCode/productName/modelCode 模糊匹配。
 *
 * 五态：引导/加载/列表/空态/拒绝与断网；不展示任何模拟数据（G-06）。
 */
import type { Product, ProductGroup, ProductStatus } from '../../../../api/ipd/product';

import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  message as antMessage,
} from 'ant-design-vue';

import {
  batchImportProducts,
  changeProductStatus,
  listProductGroups,
  listProducts,
} from '../../../../api/ipd/product';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';

type Phase = 'error' | 'loading' | 'ready';

const router = useRouter();

const statusMeta: Record<string, { color: string; text: string }> = {
  ACTIVE: { color: 'default', text: '在售（历史）' },
  IN_RD: { color: 'processing', text: '在研' },
  INACTIVE: { color: 'default', text: '已停用' },
  ON_SALE: { color: 'success', text: '在售' },
};
function statusText(status: string): string {
  return statusMeta[status]?.text ?? '待补充';
}
function statusColor(status: string): string {
  return statusMeta[status]?.color ?? 'default';
}

const sourceMeta: Record<string, { color: string; text: string }> = {
  ADMIN_IMPORT: { color: 'blue', text: '超管导入' },
  GUEST_OTHER: { color: 'default', text: '游客占位' },
  PM_NEW: { color: 'cyan', text: 'PM 新增' },
};
function sourceText(source: string): string {
  return sourceMeta[source]?.text ?? '待补充';
}
function sourceColor(source: string): string {
  return sourceMeta[source]?.color ?? 'default';
}

function rejectText(cause: unknown): string {
  if (cause instanceof IpdRequestError) {
    if (cause.kind === 'transport') return '无法连接服务，请检查网络后重试';
    if (cause.kind === 'cancelled') return '操作已取消，请重试';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}
const isTransportError = (cause: unknown): boolean =>
  cause instanceof IpdRequestError && cause.kind === 'transport';

const phase = ref<Phase>('loading');

/** v-else 分支里 phase 会被模板控制流收窄，函数参数不收窄，保持完整比较语义。 */
function isLoading(value: Phase): boolean {
  return value === 'loading';
}

/** Table bodyCell 的 record 不做类型收窄：统一在此收敛断言。 */
function asProduct(record: Record<string, any>): Product {
  return record as Product;
}
const offline = ref(false);
const errorMsg = ref('');

const keyword = ref('');
const statusFilter = ref<string>('');
const groupFilter = ref<string>('');
const allRows = ref<Product[]>([]);
const groups = ref<ProductGroup[]>([]);

const currentPage = ref(1);
const pageSize = ref(20);

const filtered = computed(() => {
  const key = keyword.value.trim().toLowerCase();
  return allRows.value.filter((row) => {
    if (statusFilter.value && row.status !== statusFilter.value) return false;
    if (groupFilter.value && row.groupId !== groupFilter.value) return false;
    if (!key) return true;
    return (
      row.productCode.toLowerCase().includes(key) ||
      row.productName.toLowerCase().includes(key) ||
      (row.modelCode ?? '').toLowerCase().includes(key)
    );
  });
});
const paged = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filtered.value.slice(start, start + pageSize.value);
});
const groupNameMap = computed(() => {
  const map: Record<string, string> = {};
  for (const g of groups.value) map[g.id] = g.groupName;
  return map;
});

const groupOptions = computed(() => [
  { label: '全部产品组', value: '' },
  ...groups.value.map((g) => ({ label: g.groupName, value: g.id })),
]);
const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '在售', value: 'ON_SALE' },
  { label: '在研', value: 'IN_RD' },
  { label: '已停用', value: 'INACTIVE' },
  { label: '在售（历史 ACTIVE）', value: 'ACTIVE' },
];

const columns = [
  { dataIndex: 'productCode', key: 'productCode', title: '产品编码', width: 140 },
  { dataIndex: 'productName', key: 'productName', title: '产品名称', width: 200 },
  { dataIndex: 'modelCode', key: 'modelCode', title: '在售型号编码', width: 160 },
  { dataIndex: 'groupName', key: 'groupName', title: '归属产品组', width: 140 },
  { dataIndex: 'source', key: 'source', title: '来源', width: 110 },
  { dataIndex: 'status', key: 'status', title: '上架状态', width: 110 },
  { dataIndex: 'projectId', key: 'projectId', title: '绑定项目', width: 140 },
  { key: 'actions', title: '操作', width: 260 },
];

const rowBusy = ref('');

async function load() {
  phase.value = 'loading';
  offline.value = false;
  errorMsg.value = '';
  try {
    const [rows, groupRows] = await Promise.all([listProducts(), listProductGroups()]);
    allRows.value = rows;
    groups.value = groupRows;
    phase.value = 'ready';
    currentPage.value = 1;
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

onMounted(load);

function onFilterChange() {
  currentPage.value = 1;
}

function goCreate() {
  router.push('/ipd/products/create');
}

function goEdit(record: Product) {
  router.push(`/ipd/products/${encodeURIComponent(record.id)}/edit`);
}

async function toggleStatus(record: Product) {
  if (rowBusy.value) return;
  const next: ProductStatus = record.status === 'INACTIVE' ? 'IN_RD' : 'INACTIVE';
  const action = next === 'INACTIVE' ? '停用' : '启用';
  rowBusy.value = `status:${record.id}`;
  try {
    await changeProductStatus(record.id, next);
    antMessage.success(`产品 ${record.productName} 已${action}`);
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    rowBusy.value = '';
  }
}

/** 演示：在售型号批量导入示例——直接以代码示意 ADMIN_IMPORT 行为；
 *  真实业务场景中由超管从 Excel 上传，本入口仅给出"在售数量为 0 时一键回填"的应急通道。 */
const sampleImportOpen = ref(false);
const sampleText = ref('');
async function runSampleImport() {
  if (rowBusy.value) return;
  const lines = sampleText.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    antMessage.warning('请粘贴「编码,名称,型号」三列文本，每行一条');
    return;
  }
  const items = lines.map((line) => {
    const [code, name, model] = line.split(',').map((s) => s.trim());
    return { productCode: code, productName: name, modelCode: model, groupId: null };
  });
  rowBusy.value = 'import';
  try {
    await batchImportProducts(items);
    antMessage.success(`已批量导入 ${items.length} 条在售型号`);
    sampleImportOpen.value = false;
    sampleText.value = '';
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    rowBusy.value = '';
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="产品档案独立于项目长期存在；新增、编辑、批量导入仅超级管理员可操作。删除须走删除审核（页面无直删入口）。"
      show-icon
      type="info"
    />

    <Card>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Space wrap>
          <Input
            v-model:value="keyword"
            :maxlength="64"
            allow-clear
            class="w-[220px]"
            placeholder="按编码 / 名称 / 型号搜索"
            @press-enter="onFilterChange"
          />
          <Select
            v-model:value="statusFilter"
            :options="statusOptions"
            class="min-w-[160px]"
            @change="onFilterChange"
          />
          <Select
            v-model:value="groupFilter"
            :options="groupOptions"
            class="min-w-[160px]"
            @change="onFilterChange"
          />
          <Button @click="onFilterChange">查询</Button>
        </Space>
        <Space wrap>
          <Button @click="sampleImportOpen = true">批量导入在售型号</Button>
          <Button type="primary" v-access:code="IPD_PERMISSION_CODES.PRODUCT_CREATE" @click="goCreate">新增产品</Button>
        </Space>
      </div>
    </Card>

    <Card v-if="phase === 'loading'" class="text-center">
      <Spin tip="正在加载产品目录" />
    </Card>

    <template v-else>
      <Alert
        v-if="phase === 'error'"
        :message="errorMsg"
        show-icon
        type="error"
        role="alert"
      >
        <template v-if="offline" #action>
          <Button danger size="small" @click="load">重新加载</Button>
        </template>
      </Alert>

      <Card v-else>
        <template #title>
          产品目录
          <span class="text-muted-foreground ml-2 text-sm">
            共 {{ allRows.length }} 个产品，筛选后 {{ filtered.length }} 个
          </span>
        </template>
        <Empty
          v-if="filtered.length === 0"
          description="暂无产品记录。可点击右上角「新增产品」或「批量导入在售型号」开始维护产品档案。"
        />
        <Table
          v-else
          :columns="columns"
          :data-source="paged"
          :loading="isLoading(phase)"
          :pagination="false"
          row-key="id"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'productCode'">
              <span class="font-medium">{{ record.productCode || '待补充' }}</span>
            </template>
            <template v-else-if="column.key === 'productName'">
              {{ record.productName || '待补充' }}
            </template>
            <template v-else-if="column.key === 'modelCode'">
              {{ record.modelCode ?? '待补充' }}
            </template>
            <template v-else-if="column.key === 'groupName'">
              {{ record.groupId ? (groupNameMap[record.groupId] ?? '待补充') : '待补充' }}
            </template>
            <template v-else-if="column.key === 'source'">
              <Tag :color="sourceColor(record.source)">{{ sourceText(record.source) }}</Tag>
            </template>
            <template v-else-if="column.key === 'status'">
              <Tag :color="statusColor(record.status)">{{ statusText(record.status) }}</Tag>
            </template>
            <template v-else-if="column.key === 'projectId'">
              <span v-if="record.projectId" class="tabular-nums">#{{ record.projectId }}</span>
              <span v-else class="text-muted-foreground">未绑定</span>
            </template>
            <template v-else-if="column.key === 'actions'">
              <Space :size="4" wrap>
                <Button size="small" @click="goEdit(asProduct(record))">编辑</Button>
                <Button
                  v-if="record.status === 'INACTIVE'"
                  :loading="rowBusy === `status:${record.id}`"
                  size="small"
                  @click="toggleStatus(asProduct(record))"
                >
                  启用
                </Button>
                <Button
                  v-else-if="record.status !== 'INACTIVE'"
                  :loading="rowBusy === `status:${record.id}`"
                  danger
                  size="small"
                  @click="toggleStatus(asProduct(record))"
                >
                  停用
                </Button>
              </Space>
            </template>
          </template>
        </Table>
        <div v-if="filtered.length > 0" class="mt-3 flex justify-end">
          <Pagination
            v-model:current="currentPage"
            v-model:page-size="pageSize"
            :page-size-options="['10', '20', '50']"
            :show-size-changer="true"
            :show-total="(total: number) => `共 ${total} 条`"
            :total="filtered.length"
          />
        </div>
      </Card>
    </template>

    <Modal
      v-model:open="sampleImportOpen"
      :confirm-loading="rowBusy === 'import'"
      :mask-closable="false"
      cancel-text="取消"
      ok-text="确认导入"
      title="批量导入在售型号"
      width="560px"
      @ok="runSampleImport"
    >
      <Alert
        class="mb-3"
        message="仅超级管理员可用；粘贴三列（编码,名称,型号）每行一条，系统按 source=ADMIN_IMPORT 落库。删除行不会被同步清除已有产品（缺失行不删除）。"
        show-icon
        type="warning"
      />
      <Input.TextArea
        v-model:value="sampleText"
        :auto-size="{ minRows: 8, maxRows: 16 }"
        :maxlength="5000"
        placeholder="PD-1001,智能门锁 X1,X1-V2&#10;PD-1002,智能门锁 X1 Pro,X1Pro-V1"
      />
    </Modal>
  </div>
</template>