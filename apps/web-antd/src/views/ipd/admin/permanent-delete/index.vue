<script setup lang="ts">
/**
 * 超管永久清除工作台（R215 GAP-F10；卡 eedf10f1，owner 拍板方案 A：做前端界面不裁下线）。
 *
 * 后端真值：AdminPermanentDeleteController（基路径 /api/v1/admin/permanent-delete）：
 * - POST /{entityType}/{id} 物理清除（@SaCheckPermission ipd:permanent-delete:execute :56
 *   + requireAdmin 仅超管 :61；confirmCode 必须恰等于 "PERMANENT_DELETE_CONFIRMED"
 *   = PermanentDeleteService.REQUIRED_CONFIRM_CODE :49，错码 PARAM_INVALID 不吞错）；
 * - GET  /audit 审计对账（javadoc :73 自证「前端对账视图用」；entityType 选填过滤、
 *   limit 后端默认 50 钳 [1,200]，按 create_time 倒序）。
 *
 * 高危确认门槛（准备包变更清单②）：confirmCode 输入框不预填、无复制按钮——操作人必须
 * 对照页面明示的字面量手工敲入，保住「二次确认」的人意语义；提交前 Modal 复述目标
 * 三元组（entityType/id/confirmCode 已敲）方可执行；白名单三值下拉不可达 scenario。
 *
 * 权限双闸：路由父级 IpdAdmin=SUPER_ADMIN authority 继承 + meta.access 挂
 * PERMANENT_DELETE_EXECUTE（PAGE_PERMISSIONS['/ipd/admin/permanent-delete']）。
 * ID/时间全 string 透传（api 层归一），本视图不做任何数值化与日期运算。
 */
import { onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Select,
  Table,
  Tag,
  message,
} from 'ant-design-vue';

import { IpdRequestError } from '../../../../api/ipd/auth';
import {
  type PermanentDeleteAuditRow,
  type PermanentDeleteEntityType,
  executePermanentDelete,
  listPermanentDeleteAudit,
} from '../../../../api/ipd/admin-permanent-delete';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { PENDING_TEXT } from '../../_shared/format';
import '../../_shared/ipd-theme.css';

defineOptions({ name: 'IpdAdminPermanentDelete', meta: { ipdCard: 'R215-GAP-F10' } });

/** 后端要求的确认码字面量（页面明示、手工敲入；REQUIRED_CONFIRM_CODE :49）。 */
const REQUIRED_CONFIRM_CODE = 'PERMANENT_DELETE_CONFIRMED';

// ipd-error-text 的 domain 联合类型无 'permanent_delete'（该文件禁改），走通用码表 + fallback 通道
function rejectText(cause: unknown): string {
  return ipdErrorText(cause, { fallback: cause instanceof IpdRequestError ? cause.message : '操作失败，请稍后重试' });
}

// ---------- 实体类型白名单（下拉三值；scenario 暂未建模，后端 @Pattern 兜底 400） ----------
const ENTITY_TYPE_TEXT: Record<string, string> = {
  kpi_record: 'KPI 记录',
  person: '人员',
  project: '项目',
};
const ENTITY_TYPE_COLOR: Record<string, string> = {
  kpi_record: 'orange',
  person: 'blue',
  project: 'green',
};
const entityTypeOptions = (Object.keys(ENTITY_TYPE_TEXT) as PermanentDeleteEntityType[]).map((value) => ({
  value,
  label: ENTITY_TYPE_TEXT[value] ?? value,
}));

// ---------- 区块①：清除执行表单（仅超管可达；高危门槛三道：白名单下拉 + 纯数字 ID + 手工敲确认码） ----------
const execForm = reactive({
  confirmCode: '',
  entityType: '' as '' | PermanentDeleteEntityType,
  id: '',
});
const execError = ref('');
const confirmOpen = ref(false);
const executeLoading = ref(false);

function validateExecForm(): string {
  if (!execForm.entityType) return '请选择实体类型（白名单：人员 / 项目 / KPI 记录）';
  const id = execForm.id.trim();
  if (!id) return '实体 ID 为必填（后端 @NotNull Long）';
  if (!/^\d+$/.test(id)) return '实体 ID 必须为纯数字（19 位雪花 ID 按文本原样提交，禁数值化）';
  if (!execForm.confirmCode.trim()) return '确认码为必填（后端 @NotBlank）——请对照上方提示手工输入';
  return '';
}

function openConfirm(): void {
  execError.value = '';
  const problem = validateExecForm();
  if (problem) {
    execError.value = problem;
    return;
  }
  confirmOpen.value = true; // Modal 复述目标三元组，二次确认的人意语义
}

async function doExecute(): Promise<void> {
  if (executeLoading.value) return; // UI 防抖
  const problem = validateExecForm(); // doExecute 可被直接调用，执行前复检三道门槛
  if (problem) {
    confirmOpen.value = false;
    execError.value = problem;
    return;
  }
  const entityType = execForm.entityType as PermanentDeleteEntityType; // 复检已保证非空串
  executeLoading.value = true;
  try {
    const r = await executePermanentDelete(entityType, execForm.id.trim(), execForm.confirmCode.trim());
    message.success(
      `永久清除已执行并落审计：审计 ${r.auditId}（${ENTITY_TYPE_TEXT[r.entityType] ?? r.entityType} #${r.entityId}，操作人 ${r.operatorName}）`,
    );
    confirmOpen.value = false;
    execForm.entityType = '';
    execForm.id = '';
    execForm.confirmCode = '';
    await loadAudit(); // 成功后回拉对账表
  } catch (cause) {
    confirmOpen.value = false;
    execError.value = rejectText(cause); // confirmCode 错码/实体不存在等业务错透传不吞
  } finally {
    executeLoading.value = false;
  }
}

// ---------- 区块②：审计对账表（GET /audit；javadoc 自证前端对账视图用；onMounted 一次 + 手动刷新） ----------
const auditRows = ref<PermanentDeleteAuditRow[]>([]);
const auditLoading = ref(false);
const auditError = ref('');
const filterType = ref<'' | PermanentDeleteEntityType>('');
const filterLimit = ref(50); // 后端默认 50、钳 [1,200]；档位三值覆盖上限
const limitOptions = [50, 100, 200].map((v) => ({ value: v, label: `最近 ${v} 条` }));

const columns = [
  { title: '审计 ID', dataIndex: 'id', key: 'id', width: 200 },
  { title: '操作人', key: 'operator', width: 160 },
  { title: '实体类型', key: 'entityType', width: 110 },
  { title: '实体 ID', dataIndex: 'entityId', key: 'entityId', width: 200 },
  { title: '删除时间', dataIndex: 'deletedAt', key: 'deletedAt', width: 210 },
  { title: '来源 IP', dataIndex: 'ipAddress', key: 'ipAddress', width: 130 },
  { title: '操作', key: 'action', width: 110 },
];

async function loadAudit(): Promise<void> {
  auditLoading.value = true;
  auditError.value = '';
  try {
    auditRows.value = await listPermanentDeleteAudit(
      filterType.value === '' ? undefined : filterType.value,
      filterLimit.value,
    );
  } catch (cause) {
    auditRows.value = [];
    auditError.value = rejectText(cause);
  } finally {
    auditLoading.value = false;
  }
}

function onFilterChange(): void {
  loadAudit().catch(() => { /* 错误已进 auditError 呈现 */ });
}

onMounted(() => {
  loadAudit().catch(() => { /* 错误已进 auditError 呈现 */ });
});

// ---------- 快照查看（originalDataJson：合法 JSON 格式化展开，非法原文兜底不抛） ----------
const snapshotOpen = ref(false);
const snapshotTitle = ref('');
const snapshotText = ref('');
function showSnapshot(record: PermanentDeleteAuditRow): void {
  snapshotTitle.value = `清除快照 · ${ENTITY_TYPE_TEXT[record.entityType] ?? record.entityType} #${record.entityId}`;
  try {
    snapshotText.value = JSON.stringify(JSON.parse(record.originalDataJson), null, 2);
  } catch {
    snapshotText.value = record.originalDataJson || PENDING_TEXT; // 非法 JSON 原文兜底
  }
  snapshotOpen.value = true;
}
</script>

<template>
  <div class="ipd-permanent-delete p-4">
    <Alert
      class="mb-4"
      type="error"
      show-icon
      message="永久清除工作台（R149 batch2b C3 · 仅超管）：物理删除不可逆、无软删回收站；每次清除前整行快照入审计表永久保留。请核对目标三元组后再执行。"
    />

    <!-- 区块①：清除执行表单（高危门槛：白名单下拉 + 纯数字 ID 校验 + 手工敲入确认码 + Modal 复述） -->
    <Card class="mb-4" title="执行永久清除" :body-style="{ paddingBottom: '8px' }">
      <Alert class="mb-3" type="warning" show-icon>
        <template #message>
          二次确认码：<span class="font-mono font-semibold">{{ REQUIRED_CONFIRM_CODE }}</span>
          <span class="ml-2 text-gray-500">（请对照本提示在下方输入框手工敲入，页面不提供预填与复制按钮）</span>
        </template>
      </Alert>
      <div class="mb-2 flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">实体类型（白名单三值）</div>
          <Select
            v-model:value="execForm.entityType"
            :options="entityTypeOptions"
            style="width: 160px"
            placeholder="人员 / 项目 / KPI 记录"
            aria-label="实体类型（白名单三值）"
          />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">实体 ID（纯数字，19 位雪花按文本提交）</div>
          <Input
            v-model:value="execForm.id"
            :maxlength="20"
            style="width: 280px"
            placeholder="如 2096266884247736321"
            aria-label="实体 ID（纯数字）"
          />
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">确认码（手工输入，不预填）</div>
          <Input
            v-model:value="execForm.confirmCode"
            :maxlength="64"
            style="width: 300px"
            placeholder="请对照上方提示逐字手工输入"
            aria-label="确认码（手工输入）"
          />
        </div>
        <Button danger :loading="executeLoading" @click="openConfirm">提交清除…</Button>
      </div>
      <Alert v-if="execError" class="mb-2" :message="execError" type="error" show-icon role="alert" />
      <p class="mt-1 text-xs text-gray-400">
        scenario 类型暂未建模（后端白名单外一律 400）；confirmCode 错码后端 PARAM_INVALID 拒绝并透传原因。
      </p>

      <!-- Modal 复述目标三元组：物理删除最后一道人意闸门 -->
      <Modal
        v-model:open="confirmOpen"
        title="确认执行永久清除（不可逆）"
        :confirm-loading="executeLoading"
        ok-text="确认永久清除"
        ok-type="danger"
        cancel-text="取消"
        @ok="doExecute"
      >
        <Alert
          class="mb-3"
          type="error"
          show-icon
          message="该操作将物理删除目标行（绕过软删回收站），删除后仅能凭审计快照人工对账还原，无法撤销！"
        />
        <p>实体类型：<Tag :color="ENTITY_TYPE_COLOR[execForm.entityType] ?? 'default'">{{ (ENTITY_TYPE_TEXT[execForm.entityType] ?? execForm.entityType) || '—' }}</Tag></p>
        <p>实体 ID：<span class="font-mono">{{ execForm.id.trim() || '—' }}</span></p>
        <p>确认码：<span class="font-mono">{{ execForm.confirmCode ? '已手工输入' : '—' }}</span></p>
      </Modal>
    </Card>

    <!-- 区块②：审计对账表（entityType 过滤 + limit 档位 + 快照展开） -->
    <Card title="清除审计对账（永久保留）">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <Select
          v-model:value="filterType"
          :options="[{ value: '', label: '全部类型' }, ...entityTypeOptions]"
          style="width: 160px"
          aria-label="实体类型过滤"
          @change="onFilterChange"
        />
        <Select
          v-model:value="filterLimit"
          :options="limitOptions"
          style="width: 140px"
          aria-label="对账条数上限"
          @change="onFilterChange"
        />
        <Button :loading="auditLoading" @click="loadAudit">刷新</Button>
      </div>
      <Alert v-if="auditError" class="mb-3" :message="auditError" type="error" show-icon role="alert" />
      <Table
        :columns="columns"
        :data-source="auditRows"
        :loading="auditLoading"
        :pagination="{ pageSize: 20, showSizeChanger: true }"
        row-key="id"
        size="small"
        bordered
        :scroll="{ x: 1120 }"
      >
        <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
          <template v-if="column.key === 'id' || column.key === 'entityId' || column.key === 'deletedAt'">
            <span class="font-mono text-xs">{{ record[column.key as string] ?? PENDING_TEXT }}</span>
          </template>
          <template v-else-if="column.key === 'operator'">
            <div>{{ record.operatorName || PENDING_TEXT }}</div>
            <div class="font-mono text-xs text-gray-400">{{ record.operatorId }}</div>
          </template>
          <template v-else-if="column.key === 'entityType'">
            <Tag :color="ENTITY_TYPE_COLOR[String(record.entityType)] ?? 'default'">
              {{ ENTITY_TYPE_TEXT[String(record.entityType)] ?? String(record.entityType) }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <Button size="small" @click="showSnapshot(record as unknown as PermanentDeleteAuditRow)">查看快照</Button>
          </template>
        </template>
        <template #emptyText>
          <Empty :image="Empty.PRESENTED_IMAGE_SIMPLE" description="暂无清除审计记录" />
        </template>
      </Table>

      <!-- 快照详情：合法 JSON 格式化，非法原文兜底 -->
      <Modal v-model:open="snapshotOpen" :title="snapshotTitle" :footer="null" width="720px">
        <pre class="max-h-[480px] overflow-auto rounded bg-gray-50 p-3 font-mono text-xs">{{ snapshotText }}</pre>
      </Modal>
    </Card>
  </div>
</template>
