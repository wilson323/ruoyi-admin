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
  Modal,
  Table,
  Tag,
  Textarea,
} from 'ant-design-vue';

import { type PmDirectoryEntry, getPmDirectory } from '../../../../api/ipd/handover';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { type PendingHandoverPerson, listPendingHandovers } from '../../../../api/ipd/hr-sync';
import { rehirePerson, resignPerson, unbindWecom } from '../../../../api/ipd/person';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';
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
  // R215 WP3.1 批次2（ORPHAN-A11）：离职冻结 / 企微解绑（附录 D6；超管）
  { title: '治理操作', key: 'personActions', width: 200 },
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

// ---------- R215 GAP-F3：离职冻结·待移交清单（复职入口数据源） ----------
// 纠偏记录：准备包 F3 写「DISABLED 行展示复职」，但后端 rehire 明确拒绝 DISABLED
// （PersonService.java:320-323「账户已禁用，需先解禁后再复职」），且在职目录 GET
// /pm-directory 仅返回 ACTIVE 人员（PmDirectoryController.java:44）——DISABLED 行在本页
// 既不可见也非法。以后端真值为准：复职入口挂 GET /hr-sync/pending-handovers
// （FROZEN_PENDING_HANDOVER = resign 后合法复职窗口，hr-sync.ts 既有封装复用，不另造 api）。
const frozenRows = ref<PendingHandoverPerson[]>([]);
const frozenColumns = [
  { title: '姓名', dataIndex: 'name', key: 'name', width: 140 },
  { title: '工号', dataIndex: 'employeeNo', key: 'employeeNo', width: 140 },
  { title: '冻结时间', dataIndex: 'frozenSince', key: 'frozenSince', width: 200 },
  { title: '待移交项目', dataIndex: 'activeProjects', key: 'activeProjects', width: 110 },
  { title: '冻结天数', dataIndex: 'ageDays', key: 'ageDays', width: 100 },
  { title: '复职操作', key: 'rehireAction', width: 120 },
];

async function loadFrozen(): Promise<void> {
  if (!isSuperAdmin.value) { frozenRows.value = []; return; }
  try {
    frozenRows.value = await listPendingHandovers();
  } catch {
    // 静默降级：hr-sync 端点权限外/故障不阻塞人员目录主体功能
    frozenRows.value = [];
  }
}
onMounted(loadFrozen);

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

// ---------- R215 WP3.1 批次2（ORPHAN-A11）：离职冻结 / 企微解绑 ----------

/** 弹窗动作类型；resign 权限=HR 或本人，unbind/rehire 权限=HR（超管/组长），本页超管专区均可。 */
type PersonAction = 'rehire' | 'resign' | 'unbind';

const ACTION_META: Record<PersonAction, { api: (id: string, reason: string) => Promise<unknown>; danger: boolean; optional?: boolean; okText: string; tip: string; title: string }> = {
  // R215 GAP-F3：复职（AC-USER-09）。后端 eligibility=employment RESIGNED ∧ account≠DISABLED
  // （PersonService.java:316-323，DISABLED 需先解禁会被 50002 拒）；note 选填，空串经
  // rehirePerson 归一为不传（body {}），禁 '' 入库审计。
  rehire: {
    api: (id: string, reason: string) => rehirePerson(id, reason || undefined),
    danger: false,
    okText: '确认复职',
    optional: true,
    tip: '恢复 employment/account 至 ACTIVE（AC-USER-09；仅 HR=超管/组长可操作，跨组被拒；备注选填，写入审计日志）',
    title: '复职',
  },
  resign: {
    api: resignPerson,
    danger: true,
    okText: '确认离职冻结',
    tip: '将冻结账号并触发待移交项目清单（全部移交完成后终态 DISABLED；附录 D6 企微联动解绑）',
    title: '离职冻结',
  },
  unbind: {
    api: unbindWecom,
    danger: false,
    okText: '确认企微解绑',
    tip: '解除企微绑定并联动账号 DISABLED（AC-USER-10：无企微无法扫码登录；不可逆，解除后无法再走企微登录）',
    title: '企微解绑',
  },
};

const actionOpen = ref(false);
const actionKind = ref<PersonAction>('resign');
/** 操作对象：在职目录行（PmDirectoryEntry）或冻结清单行（映射为 {id,name}）——弹窗只需 id+name。 */
const actionTarget = ref<{ id: string; name: null | string } | null>(null);
const actionReason = ref('');
const actionLoading = ref(false);
const actionResult = ref('');

function openPersonAction(kind: PersonAction, entry: { id: string; name: null | string }): void {
  actionKind.value = kind;
  actionTarget.value = entry;
  actionReason.value = '';
  actionResult.value = '';
  actionOpen.value = true;
}

async function confirmPersonAction(): Promise<void> {
  const target = actionTarget.value;
  const reason = actionReason.value.trim();
  // rehire 的 note 选填（RehireRequest 无 @NotBlank）；resign/unbind 的 reason 必填（@NotBlank）
  if (!target || (!reason && !ACTION_META[actionKind.value].optional)) return;
  actionLoading.value = true;
  try {
    const result = await ACTION_META[actionKind.value].api(String(target.id), reason);
    // resign 返回 ResignView（含待移交数/副作用标记）；unbind 返回 PersonView
    if (actionKind.value === 'resign' && result && typeof result === 'object') {
      const r = result as { message?: null | string; notificationsSent?: number; pendingProjects?: number };
      actionResult.value = r.message ?? `已触发：待移交项目 ${r.pendingProjects ?? 0} 个，通知 ${r.notificationsSent ?? 0} 条`;
    } else if (actionKind.value === 'rehire') {
      actionResult.value = '已复职（employment/account → ACTIVE）';
      await loadFrozen();
      await load();
    } else {
      actionResult.value = '操作成功';
    }
    actionOpen.value = false;
    // 目录已变（resign 后 employmentStatus 变化），静默刷新
    await load();
  } catch (cause) {
    actionResult.value = rejectText(cause);
  } finally {
    actionLoading.value = false;
  }
}
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
        <Button type="default" v-access:code="IPD_PERMISSION_CODES.HANDOVER_CANCEL" :loading="loading" @click="load">刷新人员目录</Button>
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
        <Button type="primary" v-access:code="IPD_PERMISSION_CODES.HANDOVER_CANCEL" @click="recordSyncAt">记录本地时间戳</Button>
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
          <!-- R215 WP3.1 批次2（ORPHAN-A11）：离职冻结 / 企微解绑（仅超管） -->
          <template v-else-if="column.key === 'personActions'">
            <div v-if="isSuperAdmin" class="flex gap-2">
              <Button danger size="small" @click="openPersonAction('resign', record as PmDirectoryEntry)">离职冻结</Button>
              <Button size="small" @click="openPersonAction('unbind', record as PmDirectoryEntry)">企微解绑</Button>
            </div>
            <span v-else class="text-xs text-gray-400">仅超管</span>
          </template>
        </template>
      </Table>

      <Empty v-if="!loading && !errorMsg && filteredEntries.length === 0" description="暂无符合条件的人员目录" />

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

    <!-- R215 GAP-F3：离职冻结·待移交清单（复职入口；数据源 hr-sync/pending-handovers，仅超管且有数据时渲染） -->
    <Card v-if="isSuperAdmin && frozenRows.length > 0" class="mb-4" title="离职冻结人员（可复职，AC-USER-09）">
      <Table
        :columns="frozenColumns"
        :data-source="frozenRows"
        :pagination="{ pageSize: 10, showSizeChanger: false }"
        :row-key="(record: Record<string, any>) => String(record.personId ?? '')"
        size="small"
        bordered
      >
        <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
          <template v-if="column.key === 'frozenSince'">
            <span>{{ record.frozenSince ?? PENDING_TEXT }}</span>
          </template>
          <template v-else-if="column.key === 'rehireAction'">
            <Button size="small" type="primary" @click="openPersonAction('rehire', { id: String(record.personId ?? ''), name: String(record.name ?? '') })">复职</Button>
          </template>
        </template>
      </Table>
      <div class="mt-2 text-xs text-gray-500">
        复职仅适用于「离职冻结待移交」窗口（employment=RESIGNED 且账户未终态 DISABLED）；已禁用账户请先走解禁流程。
      </div>
    </Card>

    <!-- R215 WP3.1 批次2（ORPHAN-A11）：离职/解绑 reason 弹窗 -->
    <Modal
      v-model:open="actionOpen"
      :title="`${ACTION_META[actionKind].title} — ${actionTarget?.name ?? ''}`"
      :confirm-loading="actionLoading"
      :ok-text="ACTION_META[actionKind].okText"
      ok-type="primary"
      :ok-button-props="{ danger: ACTION_META[actionKind].danger }"
      cancel-text="取消"
      :mask-closable="false"
      @ok="confirmPersonAction"
    >
      <div class="mb-2 text-xs text-gray-500">{{ ACTION_META[actionKind].tip }}</div>
      <Textarea
        v-model:value="actionReason"
        :maxlength="200"
        :rows="3"
        :placeholder="ACTION_META[actionKind].optional ? '备注（选填，1~200 字，留空不写入）' : '操作原因（必填，1~200 字，将写入审计日志）'"
        show-count
      />
      <div v-if="actionResult" class="mt-2 text-xs" :class="actionOpen ? 'text-gray-400' : 'text-green-600'">{{ actionResult }}</div>
    </Modal>
  </div>
</template>