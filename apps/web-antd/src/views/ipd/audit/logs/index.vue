<script setup lang="ts">
/**
 * 页06 审计日志（卡 P0-10.6；后端 /scope 分层分页 + /verify 四态验链 + /export/scope + /rebuild-chain 已交付）。
 * 分层可见：超管=全局 / 组长=本组 / PM=本人（AC-AUD-04/05）；hash 链校验与链重建仅超管（DEF-9/DEF-4）；
 * 导出为服务端落 EXPORT 审计事件，文件流待后端；服务端过滤交付前，关键字过滤仅作用于当前页。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Input,
  Table,
  Tag,
  message,
} from 'ant-design-vue';

import {
  type AuditChainVerifyResultView,
  type AuditLog,
  type AuditScopePage,
  exportAuditByScope,
  pageAuditByScope,
  parseAuditPayload,
  rebuildAuditChain,
  verifyAuditChain,
} from '../../../../api/ipd/audit';
import AiSuggest from '../../_shared/ai-suggest.vue';
import { formatDateTime } from '../../_shared/format';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';

const state = reactive({ pageNo: 1, pageSize: 20 });
const keyword = ref('');
const data = ref<AuditScopePage | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    data.value = await pageAuditByScope(state.pageNo, state.pageSize);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '加载审计日志失败');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const scopeText = computed(() => {
  const scope = data.value?.scope;
  if (scope === 'GLOBAL') return '全局（超级管理员）';
  if (scope === 'GROUP') return '本组（产品组长）';
  if (scope === 'OWN') return '仅本人';
  return '';
});

/** 服务端过滤交付前，仅当前页本地过滤（提示见页首 Alert）。 */
const rows = computed(() => {
  const records = data.value?.page.records ?? [];
  const q = keyword.value.trim().toLowerCase();
  if (!q) return records;
  return records.filter((log) =>
    [log.action, log.entityType, log.entityId, log.operatorName, log.reason]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLowerCase().includes(q)),
  );
});

const pagination = computed(() => ({
  current: data.value?.page.current ?? 1,
  pageSize: state.pageSize,
  total: data.value?.page.total ?? 0,
  showSizeChanger: false,
  onChange: (page: number) => {
    state.pageNo = page;
    void load();
  },
}));

const verifyResult = ref<AuditChainVerifyResultView | null>(null);
const verifying = ref(false);
async function verify() {
  verifying.value = true;
  try {
    verifyResult.value = await verifyAuditChain();
  } catch (error) {
    message.error(error instanceof Error ? error.message : '校验失败');
  } finally {
    verifying.value = false;
  }
}

const exporting = ref(false);
async function exportLogs() {
  exporting.value = true;
  try {
    const { exported, scope } = await exportAuditByScope();
    message.success(`已登记导出审计：${exported} 条（范围 ${scope}）；文件流导出待后端交付`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出失败');
  } finally {
    exporting.value = false;
  }
}

const rebuilding = ref(false);
async function rebuild() {
  rebuilding.value = true;
  try {
    const { fixed } = await rebuildAuditChain();
    message.success(`链重建完成：重算 ${fixed} 行哈希`);
    verifyResult.value = null;
  } catch (error) {
    message.error(error instanceof Error ? error.message : '重建失败');
  } finally {
    rebuilding.value = false;
  }
}

/** L2 AI 入口 adopt 回传（C08 零直写）：建议仅落本地暂存提示，由真人复核后走既有端点手动操作。 */
const adoptedAi = ref<{ markdown: string; scene: string } | null>(null);
function onAiAdopt(payload: { markdown: string; scene: string }): void {
  adoptedAi.value = payload;
}

const chainStateText: Record<AuditChainVerifyResultView['chain'], string> = {
  BROKEN: '断裂（哈希与序号并存）',
  GAP: '序号缺行',
  HASH_BROKEN: '哈希断裂（可链重建修复）',
  OK: '完整通过',
};

const detail = ref<AuditLog | null>(null);
/** 表格 slot 的 record 是宽松对象，在此收口断言（vue-tsc 对 bodyCell 不做类型收窄）。 */
function openDetail(row: Record<string, any>): void {
  detail.value = row as AuditLog;
}
function payloadText(raw: null | string | undefined): string {
  const parsed = parseAuditPayload(raw);
  if (parsed === null) return '（无）';
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
}

const columns = [
  { title: '序号', dataIndex: 'seq', key: 'seq', width: 80 },
  { title: '操作人', key: 'operator', width: 140 },
  { title: '动作', dataIndex: 'action', key: 'action', width: 130 },
  { title: '对象', key: 'entity', width: 170 },
  { title: '原因', dataIndex: 'reason', key: 'reason', ellipsis: true },
  { title: '时间', key: 'createTime', width: 150 },
  { title: '操作', key: 'actions', width: 80 },
];
</script>

<template>
  <div class="p-4">
    <Alert
      class="mb-4"
      :message="`当前查询范围：${scopeText || '加载中'}。审计只增不改、每条携带前后快照与 hash 链（BR-AUD-01/02）；关键字过滤在服务端过滤交付前仅作用于当前页。`"
      show-icon
      type="info"
    />

    <Card class="mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <Input v-model:value="keyword" allow-clear class="w-64" placeholder="按动作 / 对象 / 操作人过滤当前页" />
        <Button :loading="loading" @click="load">刷新</Button>
        <Button v-access:code="IPD_PERMISSION_CODES.AUDIT_LOG_VERIFY" :loading="verifying" @click="verify">校验 hash 链</Button>
        <Button v-access:code="IPD_PERMISSION_CODES.AUDIT_LOG_EXPORT" :loading="exporting" @click="exportLogs">导出</Button>
        <!-- 后端 /rebuild-chain 挂 VERIFY 权限（AuditLogController@SaCheckPermission），无独立 rebuild 码 -->
        <Button v-access:code="IPD_PERMISSION_CODES.AUDIT_LOG_VERIFY" :loading="rebuilding" danger @click="rebuild">
          链重建（DEF-4）
        </Button>
      </div>
      <!-- L2 每页 AI 入口（2026-09-28）：审计异常检测（userPrompt 素材必填；采纳仅回传宿主，C08 零直写） -->
      <div class="mt-4">
        <AiSuggest
          scene="audit.anomaly-detect"
          needs-prompt
          adoptable
          label="AI 审计异常检测"
          data-testid="audit-ai-anomaly"
          @adopt="onAiAdopt"
        />
        <p v-if="adoptedAi" class="text-muted-foreground mt-2 text-xs" data-testid="audit-ai-adopted">
          AI 建议已回传宿主（{{ adoptedAi.scene }}）：仅草稿不写库，请人工复核后手动操作。
        </p>
      </div>

      <Descriptions v-if="verifyResult" bordered :column="3" class="mt-4" size="small">
        <DescriptionsItem label="链状态">
          <Tag :color="verifyResult.chain === 'OK' ? 'success' : 'error'">
            {{ chainStateText[verifyResult.chain] }}
          </Tag>
        </DescriptionsItem>
        <DescriptionsItem label="总行数">{{ verifyResult.total }}</DescriptionsItem>
        <DescriptionsItem label="哈希断裂">{{ verifyResult.hashBroken }}</DescriptionsItem>
        <DescriptionsItem label="序号缺行">{{ verifyResult.gaps }}</DescriptionsItem>
        <DescriptionsItem label="合并断裂点">{{ verifyResult.broken }}</DescriptionsItem>
        <DescriptionsItem label="创世哈希">{{ verifyResult.genesis }}</DescriptionsItem>
      </Descriptions>
    </Card>

    <Card title="审计记录（seq 倒序）">
      <Table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="pagination"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'operator'">
            {{ record.operatorName ?? record.operatorId }}
            <span class="text-muted-foreground ml-1 text-xs">{{ record.operatorRole ?? '' }}</span>
          </template>
          <template v-else-if="column.key === 'entity'">
            {{ record.entityType ?? '—' }} / {{ record.entityId ?? '—' }}
          </template>
          <template v-else-if="column.key === 'createTime'">{{ formatDateTime(record.createTime) }}</template>
          <template v-else-if="column.key === 'actions'">
            <Button size="small" type="link" @click="openDetail(record)">详情</Button>
          </template>
        </template>
      </Table>
    </Card>

    <Drawer :open="detail !== null" :title="detail ? `审计详情 #${detail.seq}` : ''" width="520" @close="detail = null">
      <Descriptions v-if="detail" bordered :column="1" size="small">
        <DescriptionsItem label="动作">{{ detail.action }}</DescriptionsItem>
        <DescriptionsItem label="对象">{{ detail.entityType ?? '—' }} / {{ detail.entityId ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="操作人">
          {{ detail.operatorName ?? detail.operatorId }}（{{ detail.operatorRole ?? '—' }}）
        </DescriptionsItem>
        <DescriptionsItem label="原因">{{ detail.reason ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="时间">{{ formatDateTime(detail.createTime) }}</DescriptionsItem>
        <DescriptionsItem label="IP">{{ detail.ipAddress ?? '—' }}</DescriptionsItem>
        <DescriptionsItem label="prevHash">
          <span class="break-all text-xs">{{ detail.prevHash ?? '—' }}</span>
        </DescriptionsItem>
        <DescriptionsItem label="currHash">
          <span class="break-all text-xs">{{ detail.currHash ?? '—' }}</span>
        </DescriptionsItem>
        <DescriptionsItem label="变更前">
          <pre class="bg-muted max-h-48 overflow-auto rounded p-2 text-xs">{{ payloadText(detail.beforeData) }}</pre>
        </DescriptionsItem>
        <DescriptionsItem label="变更后">
          <pre class="bg-muted max-h-48 overflow-auto rounded p-2 text-xs">{{ payloadText(detail.afterData) }}</pre>
        </DescriptionsItem>
      </Descriptions>
    </Drawer>
  </div>
</template>
