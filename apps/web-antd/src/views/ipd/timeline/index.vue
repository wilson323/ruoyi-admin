<script setup lang="ts">
/**
 * 页37 全流程轨迹（卡 ZK-D2；原型 /timeline）。
 *
 * 后端真值：
 * - 无 timeline 聚合端点；本视图以审计日志（GET /audit-logs/scope，分层范围）作为时间线主轴，
 *   工作台待办（GET /workbench/summary，2026-09-06 交付）与奖金池列表
 *   （GET /bonus-pool/list，参数 projectId）三源融合，按时间倒序呈现「全流程轨迹」语义；
 * - 服务端不支持按 entity/action 过滤，本页筛选仅作用于当前页（前端叠加）；
 * - 时间戳来源审计事件 createTime（毫秒数）与业务时间戳需统一为可比较的时间字符串。
 *
 * 五态：成功（融合时间线）/ 拒绝与断网 / 空态（无事件）/ 加载；不展示任何模拟数据。
 */
import { computed, onMounted, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Select,
  SelectOption,
  Spin,
  Tag,
  Timeline,
  TimelineItem,
} from 'ant-design-vue';

import {
  type AuditLog,
  type AuditScopePage,
  pageAuditByScope,
} from '../../../api/ipd/audit';
import {
  type WorkbenchSummary,
  type WorkbenchTask,
  fetchWorkbenchSummary,
} from '../../../api/ipd/workbench';
import {
  type BonusPool,
  listBonusPools,
} from '../../../api/ipd/bonus';
import { IpdRequestError } from '../../../api/ipd/auth';
import { formatDateTime, PENDING_TEXT } from '../_shared/format';

defineOptions({
  name: 'IpdTimeline',
  meta: {
    ipdBackend: '无 timeline 聚合端点；以审计日志（GET /audit-logs/scope）+ 工作台（GET /workbench/summary）+ 奖金池（GET /bonus-pool/list）三源融合按时间倒序。',
    ipdCard: 'ZK-D2',
  },
});

const keyword = ref('');
const scopeFilter = ref<'ALL' | 'AUDIT' | 'WORKBENCH' | 'BONUS'>('ALL');
const loading = ref(false);
const errorMsg = ref('');
const isNetwork = ref(false);

const auditData = ref<AuditScopePage | null>(null);
const workbenchData = ref<WorkbenchSummary | null>(null);
const bonusEntries = ref<BonusPool[]>([]);

interface TimelineEntry {
  at: null | number | string;
  category: 'AUDIT' | 'BONUS' | 'WORKBENCH';
  key: string;
  scope?: string;
  summary: string;
  detail?: string;
  status?: string;
  payload?: Record<string, unknown>;
}

function rejectText(cause: unknown): string {
  if (cause instanceof IpdRequestError) {
    if (cause.kind === 'transport') return '无法连接服务，请检查网络后重试';
    if (cause.kind === 'cancelled') return '操作已取消，请重试';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}

/** 把审计事件汇总成统一时间线条目（at 数字毫秒 / 字符串 ISO 都允许）。 */
function auditToEntry(log: AuditLog, scope: string): TimelineEntry {
  const at = log.createTime ?? null;
  const op = log.operatorName || log.operatorId || PENDING_TEXT;
  const role = log.operatorRole ? `[${log.operatorRole}]` : '';
  const entity = log.entityType ? `${log.entityType}#${log.entityId ?? '?'}` : '';
  const detail = log.reason ? ` · 原因：${log.reason}` : '';
  return {
    at,
    category: 'AUDIT',
    detail,
    key: `audit-${log.id}`,
    payload: { seq: log.seq, before: log.beforeData, after: log.afterData },
    scope,
    status: log.action,
    summary: `${op}${role} → ${log.action}${entity ? ' · ' + entity : ''}${detail}`,
  };
}

function workbenchTaskToEntry(task: WorkbenchTask): TimelineEntry {
  const at = task.dueDate ?? null;
  return {
    at,
    category: 'WORKBENCH',
    detail: task.deepLink ?? '',
    key: `wb-${task.id}`,
    status: task.status,
    summary: `待办：${task.title ?? task.actionCode ?? task.id} · ${task.projectName ?? task.projectId ?? PENDING_TEXT}`,
  };
}

function bonusToEntry(pool: BonusPool): TimelineEntry {
  return {
    at: pool.createTime ?? null,
    category: 'BONUS',
    detail: `项目 ${pool.projectId} · 生成于 ${formatDateTime(pool.createTime)}`,
    key: `bonus-${pool.id}`,
    status: pool.status,
    summary: `奖金池 #${pool.id} 状态：${pool.status} · 基数 ${pool.basePool ?? PENDING_TEXT} · 系数 ${pool.coefficient ?? PENDING_TEXT}`,
  };
}

function toMillis(at: null | number | string): number {
  if (at === null || at === undefined) return 0;
  if (typeof at === 'number') return at < 1e12 ? at * 1000 : at;
  const ts = Date.parse(String(at));
  return Number.isFinite(ts) ? ts : 0;
}

const entries = computed<TimelineEntry[]>(() => {
  const out: TimelineEntry[] = [];
  const scope = auditData.value?.scope;
  if (auditData.value?.page.records) {
    for (const log of auditData.value.page.records) out.push(auditToEntry(log, scope ?? ''));
  }
  if (workbenchData.value?.tasks) {
    for (const task of workbenchData.value.tasks) out.push(workbenchTaskToEntry(task));
  }
  for (const pool of bonusEntries.value) out.push(bonusToEntry(pool));
  out.sort((a, b) => toMillis(b.at) - toMillis(a.at));
  return out;
});

const filteredEntries = computed<TimelineEntry[]>(() => {
  if (scopeFilter.value !== 'ALL') {
    const target = scopeFilter.value;
    return entries.value.filter((entry) => entry.category === target);
  }
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return entries.value;
  return entries.value.filter((entry) => entry.summary.toLowerCase().includes(kw));
});

const entryCounts = computed(() => {
  const counts = { AUDIT: 0, BONUS: 0, WORKBENCH: 0 };
  for (const entry of entries.value) counts[entry.category] += 1;
  return counts;
});

const CATEGORY_TEXT: Record<'AUDIT' | 'BONUS' | 'WORKBENCH', { color: string; label: string }> = {
  AUDIT: { color: 'blue', label: '审计事件' },
  BONUS: { color: 'gold', label: '奖金池' },
  WORKBENCH: { color: 'green', label: '工作台待办' },
};

async function load(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  isNetwork.value = false;
  try {
    const [audit, summary] = await Promise.allSettled([
      pageAuditByScope(1, 20),
      fetchWorkbenchSummary(),
    ]);
    auditData.value = audit.status === 'fulfilled' ? audit.value : null;
    workbenchData.value = summary.status === 'fulfilled' ? summary.value : null;
    // 奖金池：尝试从 audit/summary 中找到最近 projectId；无则跳过（避免误跨项目）。
    bonusEntries.value = [];
    let projectId: null | string = null;
    if (workbenchData.value?.currentAdvance?.projectId) projectId = workbenchData.value.currentAdvance.projectId;
    else if (workbenchData.value?.tasks.length) projectId = workbenchData.value.tasks[0]?.projectId ?? null;
    if (projectId) {
      try {
        bonusEntries.value = await listBonusPools(projectId);
      } catch {
        bonusEntries.value = [];
      }
    }
    // 全部失败时，给出合并错误文案
    if (audit.status === 'rejected' && summary.status === 'rejected') {
      throw audit.reason;
    }
  } catch (cause) {
    errorMsg.value = rejectText(cause);
    isNetwork.value = cause instanceof IpdRequestError && cause.kind === 'transport';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="ipd-timeline p-4">
    <Alert
      class="mb-4"
      :message="`全流程轨迹：审计日志（GET /audit-logs/scope，分层范围）+ 工作台待办（GET /workbench/summary）+ 奖金池（GET /bonus-pool/list?projectId）三源融合，按时间倒序。无 timeline 聚合端点，本页以审计为时间线主轴；后端不支持按 entity/action 过滤，关键词仅作用于当前页。`"
      show-icon
      type="info"
    />

    <Card title="筛选与数据源" class="mb-4">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-gray-500">类别</div>
          <Select v-model:value="scopeFilter" style="width: 200px">
            <SelectOption value="ALL">全部</SelectOption>
            <SelectOption value="AUDIT">仅审计事件</SelectOption>
            <SelectOption value="WORKBENCH">仅工作台待办</SelectOption>
            <SelectOption value="BONUS">仅奖金池</SelectOption>
          </Select>
        </div>
        <div>
          <div class="mb-1 text-xs text-gray-500">关键词</div>
          <Input v-model:value="keyword" placeholder="摘要 / 操作人 / 实体" style="width: 280px" allow-clear />
        </div>
        <Button type="primary" :loading="loading" @click="load">刷新</Button>
      </div>
      <div class="mt-3 flex flex-wrap gap-2 text-xs">
        <Tag color="blue">审计：{{ entryCounts.AUDIT }}</Tag>
        <Tag color="green">工作台待办：{{ entryCounts.WORKBENCH }}</Tag>
        <Tag color="gold">奖金池：{{ entryCounts.BONUS }}</Tag>
        <span class="ml-2 text-gray-500">审计分层：{{ auditData?.scope ?? '—' }}</span>
      </div>
    </Card>

    <Card title="融合时间线（按时间倒序）" class="mb-4">
      <Spin v-if="loading" tip="加载中...">
        <div style="min-height: 160px"></div>
      </Spin>
      <Empty v-else-if="filteredEntries.length === 0 && !errorMsg" description="暂无事件" />
      <Timeline v-else>
        <TimelineItem
          v-for="entry in filteredEntries"
          :key="entry.key"
          :color="entry.category === 'AUDIT' ? 'blue' : entry.category === 'BONUS' ? 'gold' : 'green'"
        >
          <div class="flex flex-wrap items-center gap-2">
            <Tag :color="CATEGORY_TEXT[entry.category].color">{{ CATEGORY_TEXT[entry.category].label }}</Tag>
            <Tag v-if="entry.status" color="default">{{ entry.status }}</Tag>
            <span class="text-sm">{{ entry.summary }}</span>
          </div>
          <div class="text-xs text-gray-500">{{ formatDateTime(entry.at) }}</div>
          <div v-if="entry.detail" class="text-xs text-gray-500">{{ entry.detail }}</div>
        </TimelineItem>
      </Timeline>

      <Alert
        v-if="errorMsg"
        class="mt-3"
        :message="isNetwork ? '网络异常' : '部分源加载失败'"
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