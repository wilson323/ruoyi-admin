<script setup lang="ts">
/**
 * 页28 组织架构（卡 P0-10.28；后端 P2-1 /api/v1/product-groups）。
 *
 * 后端真值：GET / 仅返回产品组裸字段（id / groupName / leaderPersonId / parentId / description）；
 *   无「成员列表 / 跨组可见范围 / 同步时间」端点——按规格只读展示，已交付字段直接渲染，
 *   缺数据的字段以「待补充」呈现（G-06）。规格要求不显示「新增 / 改组长」按钮（第三方托管），
 *   本页面纯只读：即便有写接口也不暴露。
 *
 * 五态：加载 / 列表 / 空态 / 拒绝与断网；不展示任何模拟数据（G-06）。
 */
import type { IpdProductGroup } from '../../../../api/ipd/product-group';

import { computed, onMounted, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { listProductGroups } from '../../../../api/ipd/product-group';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { PENDING_TEXT } from '../../_shared/format';
import { useIpdAuthStore } from '../../../../store/ipd-auth';

type Phase = 'error' | 'loading' | 'ready';

const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
const isAdmin = computed(() => personType.value === 'SUPER_ADMIN');

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
const offline = ref(false);
const errorMsg = ref('');
const rows = ref<IpdProductGroup[]>([]);
const keywordInput = ref('');

const visibleRows = computed(() => {
  const keyword = keywordInput.value.trim().toLowerCase();
  if (!keyword) return rows.value;
  return rows.value.filter((row) => {
    const haystack = [row.groupName, row.description ?? '', row.leaderPersonId ?? '']
      .join('|').toLowerCase();
    return haystack.includes(keyword);
  });
});

async function load() {
  phase.value = 'loading';
  offline.value = false;
  errorMsg.value = '';
  try {
    rows.value = await listProductGroups();
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    offline.value = isTransportError(cause);
    errorMsg.value = rejectText(cause);
  }
}

onMounted(() => {
  if (isAdmin.value) void load();
});

const columns = [
  { dataIndex: 'groupName', key: 'groupName', title: '产品组名称' },
  { dataIndex: 'leaderPersonId', key: 'leaderPersonId', title: '组长', width: 200 },
  { dataIndex: 'description', key: 'description', title: '描述', width: 280 },
  { dataIndex: 'parentId', key: 'parentId', title: '上级组', width: 120 },
];

function reload() {
  void load();
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="第三方托管 · 禁止本地修改"
      description="组织数据由第三方人员 API 同步，禁止本地新增、修改组长或调整产品组关系；如需变更请联系人事同步流程。个人等级 L1-L5 由人事 API 单向提供，超级管理员亦不可改。"
      show-icon
      type="warning"
    />

    <Card v-if="!isAdmin">
      <Alert
        message="组织架构为超级管理员专属页面"
        description="该入口仅 super_admin 可访问。如需查看人员同步状态，请联系超级管理员。"
        show-icon
        type="info"
        role="alert"
      />
    </Card>

    <template v-else>
      <Card>
        <Space class="w-full" direction="vertical" :size="4">
          <Space wrap>
            <Input
              v-model:value="keywordInput"
              :maxlength="64"
              allow-clear
              class="min-w-[240px]"
              placeholder="本地搜索：产品组名称 / 描述 / 组长 ID"
            />
            <Button @click="reload">刷新</Button>
          </Space>
          <div class="text-muted-foreground text-xs">
            同步时间 / 成员数 / 主组标识 / 协同组标识 / 跨组项目可见范围
            <Tooltip title="后端 ProductGroupController 仅返回产品组基本字段，暂无成员列表 / 同步状态端点（规格 vs 代码差异已登记）">
              <span class="ml-1 cursor-help underline decoration-dotted">（为何为空）</span>
            </Tooltip>
          </div>
        </Space>
      </Card>

      <Card v-if="phase === 'loading'" class="text-center">
        <Spin tip="正在加载产品组列表" />
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
            <Button danger size="small" @click="reload">重新加载</Button>
          </template>
        </Alert>

        <Card v-else-if="rows.length === 0" class="text-center">
          <Empty description="系统中暂无产品组记录。请先通过第三方人事 API 完成首次同步。" />
        </Card>

        <Card v-else>
          <template #title>
            <span>产品组列表</span>
            <span class="text-muted-foreground ml-2 text-sm">共 {{ rows.length }} 个产品组（来源：第三方同步）</span>
          </template>
          <Table
            :columns="columns"
            :data-source="visibleRows"
            :pagination="false"
            row-key="id"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'groupName'">
                <span class="font-medium">{{ record.groupName || '待补充' }}</span>
                <span v-if="!record.description" class="text-muted-foreground ml-2 text-xs">#{{ record.id }}</span>
              </template>
              <template v-else-if="column.key === 'leaderPersonId'">
                <Tag color="default">第三方同步</Tag>
                <span v-if="record.leaderPersonId" class="text-muted-foreground ml-2 text-xs">
                  #{{ record.leaderPersonId }}
                </span>
                <span v-else class="text-muted-foreground ml-2 text-xs">{{ PENDING_TEXT }}</span>
              </template>
              <template v-else-if="column.key === 'description'">
                <span>{{ record.description || PENDING_TEXT }}</span>
              </template>
              <template v-else-if="column.key === 'parentId'">
                <span v-if="record.parentId" class="tabular-nums">#{{ record.parentId }}</span>
                <span v-else class="text-muted-foreground">—</span>
              </template>
            </template>
          </Table>
        </Card>
      </template>
    </template>
  </div>
</template>