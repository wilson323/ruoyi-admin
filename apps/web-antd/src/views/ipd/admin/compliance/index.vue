<script setup lang="ts">
/**
 * 合规中心（R215 GAP-F6；后端 ComplianceController P2-5.1，ZK-IPD §九 AC-COMP-01~05）。
 *
 * 四区块（Tab）：
 * ① 数据保留规则（只读表，AC-COMP-01）
 * ② 删除请求登记（AC-COMP-02/03：30 天期限；actor 服务端推导，前端不传 requesterId——SEC-API-01）
 * ③ 资源审计链（AC-COMP-04：type+ID 分页查询）
 * ④ R/W 分离判定（AC-COMP-05：conflict 红标 + roleList）
 *
 * 路由门禁 meta.access=[COMPLIANCE_READ]；写按钮 v-access COMPLIANCE_WRITE。
 * ID 一律 string 透传（api/ipd/compliance.ts 归一），本视图不做任何数值化。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Input,
  Select,
  Table,
  Tabs,
  TabPane,
  Tag,
  Textarea,
} from 'ant-design-vue';

import {
  type AuditEntryView,
  type DataDeletionRequestView,
  type DataRetentionRule,
  type PermissionSeparationView,
  checkPermissionSeparation,
  createDataDeletionRequest,
  fetchAuditTrail,
  fetchRetentionRules,
} from '../../../../api/ipd/compliance';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { PENDING_TEXT } from '../../_shared/format';
import '../../_shared/ipd-theme.css';

defineOptions({ name: 'IpdAdminCompliance', meta: { ipdCard: 'R215-GAP-F6' } });

// ipd-error-text 的 domain 联合类型无 'compliance'（该文件本轮禁改），走通用码表 + fallback 通道
function rejectText(cause: unknown): string {
  return ipdErrorText(cause, { fallback: cause instanceof IpdRequestError ? cause.message : '操作失败，请稍后重试' });
}

const activeTab = ref('retention');

// ---------- ① 数据保留规则 ----------
const retentionLoading = ref(false);
const retentionError = ref('');
const retentionRules = ref<DataRetentionRule[]>([]);
const retentionColumns = [
  { title: '资源类型', dataIndex: 'resourceType', key: 'resourceType', width: 200 },
  { title: '保留天数', dataIndex: 'retentionDays', key: 'retentionDays', width: 120 },
  { title: '删除策略', dataIndex: 'deletionPolicy', key: 'deletionPolicy', width: 160 },
  { title: '法律依据', dataIndex: 'legalBasis', key: 'legalBasis' },
];

async function loadRetention(): Promise<void> {
  retentionLoading.value = true;
  retentionError.value = '';
  try {
    retentionRules.value = await fetchRetentionRules();
  } catch (cause) {
    retentionRules.value = [];
    retentionError.value = rejectText(cause);
  } finally {
    retentionLoading.value = false;
  }
}
onMounted(loadRetention);

// ---------- ② 删除请求登记 ----------
const RESOURCE_TYPE_OPTIONS = [
  { label: '项目（projects）', value: 'projects' },
  { label: '需求（requirements）', value: 'requirements' },
  { label: '人员（persons）', value: 'persons' },
  { label: '审计日志（audit_logs）', value: 'audit_logs' },
];
const deletionForm = reactive({ reason: '', resourceId: '', resourceType: 'projects' });
const deletionError = ref('');
const deletionSubmitting = ref(false);
const deletionResult = ref<DataDeletionRequestView | null>(null);

async function submitDeletion(): Promise<void> {
  deletionError.value = '';
  deletionResult.value = null;
  // resourceId：雪花 ID 纯数字字符串（禁 Number()，19 位无损）；reason 非空预检（后端 @NotBlank）
  if (!/^\d+$/.test(deletionForm.resourceId.trim())) {
    deletionError.value = '资源 ID 须为纯数字字符串（雪花 ID 按文本提交）';
    return;
  }
  if (!deletionForm.reason.trim()) {
    deletionError.value = '请填写删除理由（后端 @NotBlank）';
    return;
  }
  deletionSubmitting.value = true;
  try {
    deletionResult.value = await createDataDeletionRequest({
      reason: deletionForm.reason.trim(),
      resourceId: deletionForm.resourceId.trim(),
      resourceType: deletionForm.resourceType,
    });
  } catch (cause) {
    deletionError.value = rejectText(cause);
  } finally {
    deletionSubmitting.value = false;
  }
}

// ---------- ③ 资源审计链 ----------
const auditForm = reactive({ pageNo: 1, pageSize: 20, resourceId: '', resourceType: 'projects' });
const auditLoading = ref(false);
const auditError = ref('');
const auditRows = ref<AuditEntryView[]>([]);
const auditTotal = ref(0);
const auditColumns = [
  { title: '序号', dataIndex: 'seq', key: 'seq', width: 110 },
  { title: '操作人', key: 'actor', width: 180 },
  { title: '动作', dataIndex: 'action', key: 'action', width: 150 },
  { title: '实体', key: 'entity', width: 220 },
  { title: '时间', dataIndex: 'createTime', key: 'createTime', width: 190 },
];

async function queryAuditTrail(): Promise<void> {
  auditError.value = '';
  if (!auditForm.resourceId.trim() || !auditForm.resourceType) {
    auditError.value = '请填写资源类型与资源 ID 后再查询';
    return;
  }
  auditLoading.value = true;
  try {
    const page = await fetchAuditTrail(
      auditForm.resourceType,
      auditForm.resourceId.trim(),
      auditForm.pageNo,
      auditForm.pageSize,
    );
    auditRows.value = page.records;
    auditTotal.value = page.total;
  } catch (cause) {
    auditRows.value = [];
    auditTotal.value = 0;
    auditError.value = rejectText(cause);
  } finally {
    auditLoading.value = false;
  }
}

// ---------- ④ R/W 分离判定 ----------
const separationUserId = ref('');
const separationLoading = ref(false);
const separationError = ref('');
const separationResult = ref<PermissionSeparationView | null>(null);
const conflictText = computed(() => {
  const r = separationResult.value;
  if (!r) return '';
  return r.conflict ? 'R/W 同源冲突（越权风险，需拆分授权）' : '无冲突（读/写职责分离合规）';
});

async function checkSeparation(): Promise<void> {
  separationError.value = '';
  separationResult.value = null;
  if (!/^\d+$/.test(separationUserId.value.trim())) {
    separationError.value = '用户 ID 须为纯数字字符串';
    return;
  }
  separationLoading.value = true;
  try {
    separationResult.value = await checkPermissionSeparation(separationUserId.value.trim());
  } catch (cause) {
    separationError.value = rejectText(cause);
  } finally {
    separationLoading.value = false;
  }
}
</script>

<template>
  <div class="ipd-compliance p-4">
    <Alert
      class="mb-4"
      type="info"
      show-icon
      message="合规中心（AC-COMP-01~05）：数据保留规则 / 删除请求登记 / 资源审计链 / R-W 权限分离判定。删除请求为 compliance 侧登记链，与数据删除审批流（deletion-requests）分属两套后端表。"
    />

    <Tabs v-model:activeKey="activeTab">
      <TabPane key="retention" tab="数据保留规则">
        <Card>
          <div class="mb-3">
            <Button :loading="retentionLoading" @click="loadRetention">重新加载</Button>
          </div>
          <Alert v-if="retentionError" class="mb-3" :message="retentionError" type="error" show-icon role="alert" />
          <Table
            :columns="retentionColumns"
            :data-source="retentionRules"
            :loading="retentionLoading"
            :pagination="false"
            row-key="resourceType"
            size="small"
            bordered
          />
        </Card>
      </TabPane>

      <TabPane key="deletion" tab="删除请求登记">
        <Card title="创建数据删除请求（AC-COMP-02/03；提交后 30 天期限 + 强制审计）">
          <div class="mb-2 max-w-[560px]">
            <div class="mb-1 text-xs text-gray-500">资源类型</div>
            <Select v-model:value="deletionForm.resourceType" :options="RESOURCE_TYPE_OPTIONS" class="w-full" />
          </div>
          <div class="mb-2 max-w-[560px]">
            <div class="mb-1 text-xs text-gray-500">资源 ID（纯数字，雪花 ID 字符串透传）</div>
            <Input v-model:value="deletionForm.resourceId" :maxlength="24" placeholder="如 2096266884247736321" />
          </div>
          <div class="mb-2 max-w-[560px]">
            <div class="mb-1 text-xs text-gray-500">删除理由（必填，≤1024 字）</div>
            <Textarea v-model:value="deletionForm.reason" :maxlength="1024" :rows="3" placeholder="如：用户撤回授权（个保法/GDPR Art.17）" />
          </div>
          <Alert v-if="deletionError" class="mb-2 max-w-[560px]" :message="deletionError" type="error" show-icon role="alert" />
          <!-- 写操作权限门禁：ipd:compliance:write（后端 SEC-API-01 actor 会话推导，前端不传 requesterId） -->
          <Button type="primary" :loading="deletionSubmitting" v-access:code="IPD_PERMISSION_CODES.COMPLIANCE_WRITE" @click="submitDeletion">提交删除请求</Button>
          <Alert
            v-if="deletionResult"
            class="mt-3 max-w-[560px]"
            type="success"
            show-icon
            :message="`请求已登记：#${deletionResult.id}（状态 ${deletionResult.status}），处理期限 ${deletionResult.deadlineAt ?? PENDING_TEXT}`"
          />
        </Card>
      </TabPane>

      <TabPane key="audit" tab="资源审计链">
        <Card title="按资源类型 + ID 查询审计链（AC-COMP-04）">
          <div class="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <div class="mb-1 text-xs text-gray-500">资源类型</div>
              <Select v-model:value="auditForm.resourceType" :options="RESOURCE_TYPE_OPTIONS" style="width: 200px" />
            </div>
            <div>
              <div class="mb-1 text-xs text-gray-500">资源 ID</div>
              <Input v-model:value="auditForm.resourceId" :maxlength="24" style="width: 240px" placeholder="纯数字" />
            </div>
            <Button type="primary" :loading="auditLoading" @click="queryAuditTrail">查询</Button>
          </div>
          <Alert v-if="auditError" class="mb-3" :message="auditError" type="error" show-icon role="alert" />
          <Table
            :columns="auditColumns"
            :data-source="auditRows"
            :loading="auditLoading"
            :pagination="{ current: auditForm.pageNo, pageSize: auditForm.pageSize, total: auditTotal, showSizeChanger: true }"
            row-key="seq"
            size="small"
            bordered
            @change="(pag: any) => { auditForm.pageNo = Number(pag?.current ?? 1); auditForm.pageSize = Number(pag?.pageSize ?? 20); queryAuditTrail(); }"
          >
            <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
              <template v-if="column.key === 'actor'">
                {{ record.actorName ?? PENDING_TEXT }}（{{ record.actorId }}）
              </template>
              <template v-else-if="column.key === 'entity'">
                {{ record.entityType ?? PENDING_TEXT }} / {{ record.entityId }}
              </template>
            </template>
          </Table>
        </Card>
      </TabPane>

      <TabPane key="separation" tab="R/W 分离判定">
        <Card title="用户读写权限分离判定（AC-COMP-05）">
          <div class="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <div class="mb-1 text-xs text-gray-500">用户 ID（纯数字）</div>
              <Input v-model:value="separationUserId" :maxlength="24" style="width: 260px" placeholder="如 2096266884247736321" />
            </div>
            <Button type="primary" :loading="separationLoading" @click="checkSeparation">判定</Button>
          </div>
          <Alert v-if="separationError" class="mb-3" :message="separationError" type="error" show-icon role="alert" />
          <template v-if="separationResult">
            <div class="mb-2">
              <Tag :color="separationResult.conflict ? 'red' : 'green'">{{ conflictText }}</Tag>
            </div>
            <div class="mb-2 text-sm">
              读权限：<Tag :color="separationResult.hasReadRole ? 'blue' : 'default'">{{ separationResult.hasReadRole ? '持有' : '无' }}</Tag>
              写权限：<Tag :color="separationResult.hasWriteRole ? 'blue' : 'default'">{{ separationResult.hasWriteRole ? '持有' : '无' }}</Tag>
              用户 ID：<span class="font-mono">{{ separationResult.userId }}</span>
            </div>
            <div>
              <span class="mr-2 text-xs text-gray-500">角色清单：</span>
              <Tag v-for="role in separationResult.roleList" :key="role">{{ role }}</Tag>
              <span v-if="separationResult.roleList.length === 0" class="text-xs text-gray-400">{{ PENDING_TEXT }}</span>
            </div>
          </template>
        </Card>
      </TabPane>
    </Tabs>
  </div>
</template>
