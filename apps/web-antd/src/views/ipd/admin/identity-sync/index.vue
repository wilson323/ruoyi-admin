<script setup lang="ts">
/**
 * 页44 人员同步（卡 P0-10.44；超管专用）。
 *
 * 后端真值（P2-2.3 原型 /identity-sync）：
 * - 无 identity-source Controller，无人员目录同步端点；
 * - 在职人员目录（GET /pm-directory → directory[]）已交付；本视图以「人员目录只读 + 同步状态指示」
 *   双形态承载——目录读端点真实现（PM/MARKET_PM/RD_PM/GROUP_LEADER 全员可见），同步源类型、来源
 *   实例、最近同步时间三个维度如实登记真缺口，不造数据。
 *
 * 五态：成功（目录表）/ 空态（无人员）/ 拒绝与断网 / 加载；不展示任何模拟数据。
 */
import { computed, onMounted, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Empty,
  Input,
  Table,
  Tag,
} from 'ant-design-vue';

import { type PmDirectoryEntry, getPmDirectory } from '../../../../api/ipd/handover';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { formatDateTime, PENDING_TEXT } from '../../_shared/format';

defineOptions({ name: 'IpdIdentitySync', meta: { ipdCard: 'P0-10.44' } });

const auth = useIpdAuthStore();
const isSuperAdmin = computed(() => auth.identity?.person.personType === 'SUPER_ADMIN');

const keyword = ref('');
const loading = ref(false);
const errorMsg = ref('');
const isNetwork = ref(false);
const entries = ref<PmDirectoryEntry[]>([]);

function rejectText(cause: unknown): string {
  if (cause instanceof IpdRequestError) {
    if (cause.kind === 'transport') return '无法连接服务，请检查网络后重试';
    if (cause.kind === 'cancelled') return '操作已取消，请重试';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}

const PERSON_TYPE_LABEL: Record<string, string> = {
  SUPER_ADMIN: '超级管理员',
  GROUP_LEADER: '产品组长',
  MARKET_PM: '市场 PM',
  RD_PM: '研发 PM',
};

function personTypeLabel(type: null | string): string {
  if (!type) return PENDING_TEXT;
  return PERSON_TYPE_LABEL[type] ?? type;
}

const filteredEntries = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return entries.value;
  return entries.value.filter((row) => {
    const fields = [row.name, row.employeeNo, row.groupName, row.personType, row.level].filter(Boolean);
    return fields.some((field) => String(field).toLowerCase().includes(kw));
  });
});

const columns = [
  { title: '姓名', dataIndex: 'name', key: 'name', width: 140 },
  { title: '工号', dataIndex: 'employeeNo', key: 'employeeNo', width: 140 },
  { title: '角色', key: 'personType', width: 140 },
  { title: '级别', dataIndex: 'level', key: 'level', width: 100 },
  { title: '所属产品组', dataIndex: 'groupName', key: 'groupName', width: 180 },
  { title: '组编号', dataIndex: 'groupId', key: 'groupId', width: 140 },
];

async function load(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  isNetwork.value = false;
  try {
    const result = await getPmDirectory();
    entries.value = result.directory ?? [];
  } catch (cause) {
    entries.value = [];
    errorMsg.value = rejectText(cause);
    isNetwork.value = cause instanceof IpdRequestError && cause.kind === 'transport';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const lastSyncAt = ref<string | null>(null);
const lastSyncMeta = computed(() => {
  if (!entries.value.length) return PENDING_TEXT;
  return formatDateTime(lastSyncAt.value);
});

function recordSyncAt(): void {
  lastSyncAt.value = new Date().toISOString();
}

onMounted(() => {
  // 首次进入记录一次本地时间戳；后端「最近同步时间」端点未交付。
  lastSyncAt.value = new Date().toISOString();
});
</script>

<template>
  <div class="ipd-identity-sync p-4">
    <Alert
      class="mb-4"
      :message="`人员同步（超管专区）：后端无 identity-source Controller，本页承载 PM Directory 只读视图（GET /pm-directory）+ 同步源类型/来源实例/最近同步时间三个维度真缺口登记。`"
      show-icon
      type="info"
    />

    <Card title="同步源设置" class="mb-4">
      <Descriptions :column="2" bordered size="small">
        <DescriptionsItem label="同步源类型">
          <Tag color="warning">真缺口</Tag>
          <span class="ml-2 text-xs text-gray-500">原型 LDAP/SSO/SCIM/手动四类型后端未交付</span>
        </DescriptionsItem>
        <DescriptionsItem label="来源实例">
          <span class="text-xs text-gray-500">{{ PENDING_TEXT }}</span>
        </DescriptionsItem>
        <DescriptionsItem label="最近同步时间">
          <span class="text-xs text-gray-500">{{ lastSyncMeta }}</span>
          <span class="ml-2 text-xs text-gray-400">（本地时间戳；后端同步时间端点未交付）</span>
        </DescriptionsItem>
        <DescriptionsItem label="操作权限">
          <Tag v-if="isSuperAdmin" color="success">超级管理员</Tag>
          <Tag v-else color="default">只读</Tag>
        </DescriptionsItem>
      </Descriptions>

      <div class="mt-3 flex flex-wrap gap-2">
        <Button :disabled="true" type="primary">触发同步</Button>
        <Button :disabled="true">同步历史</Button>
        <Button :disabled="true">映射配置</Button>
        <Button type="default" :loading="loading" @click="load">刷新人员目录</Button>
      </div>
      <div class="mt-2 text-xs text-gray-500">
        三个同步按钮在 identity-source Controller 交付前禁用，避免假数据写入。
      </div>
    </Card>

    <Card title="在职人员目录（GET /pm-directory）" class="mb-4">
      <div class="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">关键词筛选</div>
          <Input
            v-model:value="keyword"
            placeholder="姓名 / 工号 / 组 / 角色 / 级别"
            style="width: 280px"
            allow-clear
          />
        </div>
        <Button type="primary" @click="recordSyncAt">记录本地时间戳</Button>
      </div>

      <Table
        :loading="loading"
        :columns="columns"
        :data-source="filteredEntries"
        :row-key="(record: Record<string, any>) => String(record.id ?? '')"
        :pagination="{ pageSize: 20, showTotal: (total: number) => `共 ${total} 条`, showSizeChanger: false }"
        size="small"
        bordered
      >
        <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
          <template v-if="column.key === 'personType'">
            <Tag :color="record.personType === 'SUPER_ADMIN' ? 'red' : record.personType === 'GROUP_LEADER' ? 'gold' : 'blue'">
              {{ personTypeLabel(record.personType ?? null) }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'level'">
            <span>{{ record.level ?? PENDING_TEXT }}</span>
          </template>
        </template>
      </Table>

      <Empty v-if="!loading && !errorMsg.value && filteredEntries.length === 0" description="暂无符合条件的人员目录" />

      <Alert
        v-if="errorMsg"
        class="mt-3"
        :message="isNetwork ? '网络异常' : '加载失败'"
        :description="errorMsg"
        :type="isNetwork ? 'warning' : 'error'"
        show-icon
      >
        <template #description>
          <div class="flex flex-col items-start gap-2">
            <span>{{ errorMsg }}</span>
            <Button size="small" @click="load">重新加载</Button>
          </div>
        </template>
      </Alert>
    </Card>
  </div>
</template>