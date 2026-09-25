<script setup lang="ts">
/**
 * P0 升级链处置台（R215 GAP-F4；P0EscalationController 3 端点，超管/组长处置视图）。
 *
 * 区块：
 * - 升级链列表（projectId 过滤 + 状态 tag：PENDING 灰 / ESCALATED 红 / RESOLVED 绿）；
 * - 「触发扫描」按钮（后端 :60 requireAdmin 仅超管 → 页内 isSuperAdmin 收敛，
 *   扫描返回本轮升级条数 escalated；person-sync 同款角色判定先例）；
 * - 行「标记处置完成」Modal（remark 选填，走 @RequestParam query 非 body）。
 *
 * 边界（准备包 §F4 禁止项）：
 * - 后端刻意不暴露「新建升级链」HTTP（Controller 头注 :32-33 防越权伪造）→ 本页只读+处置，无新建入口；
 * - id/projectId/p0EventId 19 位雪花 string 透传（api 层归一），视图零数值化。
 *
 * 五态：loading / empty / error（403/30001 透传后端 message）/ 按钮防重（loading 门禁）。
 */
import { computed, onMounted, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  Textarea,
  message as antMessage,
} from 'ant-design-vue';

import {
  type P0EscalationChainView,
  checkEscalation,
  listEscalationChains,
  resolveEscalationChain,
} from '../../../../api/ipd/p0-escalation';
import { IpdRequestError } from '../../../../api/ipd/auth';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { PENDING_TEXT } from '../../_shared/format';
import '../../_shared/ipd-theme.css';

defineOptions({ name: 'IpdAdminP0Escalation', meta: { ipdCard: 'R215-GAP-F4' } });

// ipd-error-text 的 domain 联合类型无 'p0-escalation'（该文件本轮禁改），走通用码表 + fallback 通道
function rejectText(cause: unknown): string {
  return ipdErrorText(cause, { fallback: cause instanceof IpdRequestError ? cause.message : '操作失败，请稍后重试' });
}

// check 端点 requireAdmin 仅超管（P0EscalationController.java:60）→ 页内角色收敛（person-sync 先例）
const auth = useIpdAuthStore();
const personType = computed(() => auth.identity?.person.personType ?? '');
const isSuperAdmin = computed(() => personType.value === 'SUPER_ADMIN');

type Phase = 'error' | 'loading' | 'ready';

const rows = ref<P0EscalationChainView[]>([]);
const phase = ref<Phase>('loading');
const errorMsg = ref('');

async function load(): Promise<void> {
  phase.value = 'loading';
  errorMsg.value = '';
  try {
    rows.value = await listEscalationChains();
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    errorMsg.value = rejectText(cause);
  }
}

onMounted(load);

// ---------- 项目过滤（projectId 选填，19 位雪花 string 透传） ----------
const filterProjectId = ref('');
const filtering = ref(false);

async function applyFilter(): Promise<void> {
  filtering.value = true;
  errorMsg.value = '';
  try {
    // 纯数字校验：非数字/含字母直接拦（后端 Long 反序列化数字串，格式错=400 白跑）
    const pid = filterProjectId.value.trim();
    rows.value = await listEscalationChains(pid === '' || /^\d+$/.test(pid) ? pid || undefined : undefined);
    phase.value = 'ready';
    if (pid !== '' && !/^\d+$/.test(pid)) {
      errorMsg.value = '项目 ID 须为纯数字字符串，本次已按未过滤查询';
    }
  } catch (cause) {
    phase.value = 'error';
    errorMsg.value = rejectText(cause);
  } finally {
    filtering.value = false;
  }
}

// ---------- 触发扫描（仅超管；requireAdmin :60） ----------
const checking = ref(false);

async function runCheck(): Promise<void> {
  if (checking.value) return;
  checking.value = true;
  try {
    const r = await checkEscalation();
    antMessage.success(`扫描完成：本轮升级 ${r.escalated} 条（escalationCount≥2 已通知双方组长）`);
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    checking.value = false;
  }
}

// ---------- 标记处置完成（组长/超管；remark 选填走 query） ----------
const resolveOpen = ref(false);
const resolveTarget = ref<P0EscalationChainView | null>(null);
const resolveRemark = ref('');
const resolving = ref(false);

// 参数兼容 Table bodyCell 插槽的 Record<string, any> 形态（data-source 实际是 P0EscalationChainView）
function openResolve(row: P0EscalationChainView | Record<string, any>): void {
  resolveTarget.value = row as P0EscalationChainView;
  resolveRemark.value = '';
  resolveOpen.value = true;
}

async function submitResolve(): Promise<void> {
  const target = resolveTarget.value;
  if (!target || resolving.value) return;
  resolving.value = true;
  try {
    const r = await resolveEscalationChain(target.id, resolveRemark.value.trim() || undefined);
    if (r.resolved) {
      antMessage.success(`升级链 #${r.id} 已标记处置完成（RESOLVED）`);
    } else {
      antMessage.warning(`后端未确认处置（id=${r.id}），请刷新列表核对状态`);
    }
    resolveOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    resolving.value = false;
  }
}

const columns = [
  { title: '升级链 ID', dataIndex: 'id', key: 'id', width: 190 },
  { title: '项目', dataIndex: 'projectId', key: 'projectId', width: 190 },
  { title: 'P0 事件', dataIndex: 'p0EventId', key: 'p0EventId', width: 190 },
  { title: '连续未升级', dataIndex: 'escalationCount', key: 'escalationCount', width: 110 },
  { title: '最近未升级', dataIndex: 'lastEscalationAt', key: 'lastEscalationAt', width: 170 },
  { title: '下次阈值', dataIndex: 'nextThresholdAt', key: 'nextThresholdAt', width: 170 },
  { title: '状态', key: 'status', width: 110 },
  { title: '备注', dataIndex: 'remark', key: 'remark' },
  { title: '操作', key: 'action', width: 140 },
];

const STATUS_META: Record<string, { color: string; text: string }> = {
  PENDING: { color: 'default', text: '待升级（PENDING）' },
  ESCALATED: { color: 'red', text: '已升级（ESCALATED）' },
  RESOLVED: { color: 'green', text: '已处置（RESOLVED）' },
};

function statusColor(s: string): string {
  return STATUS_META[s]?.color ?? 'default';
}

function statusText(s: string): string {
  return STATUS_META[s]?.text ?? s;
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="P0 升级链处置台（AC-C4：同一 P0 连续两次未升级 → 升级双方组长）"
      description="列表按 (项目, P0 事件) 维度展示升级计数；触发扫描为运维/测试手动口（正常轮询由调度器承担，仅超管）；处置完成将状态置 RESOLVED 停止计数。业务记录由后端 P0 事件服务内部登记，不提供手工新建入口（防越权伪造）。"
      show-icon
      type="info"
    />

    <Card>
      <template #title>
        <Space wrap>
          <span>升级链列表</span>
          <Tag color="default">当前 {{ rows.length }} 条</Tag>
        </Space>
      </template>
      <Space wrap class="mb-3">
        <Input
          v-model:value="filterProjectId"
          :maxlength="24"
          placeholder="按项目 ID 过滤（纯数字，留空查全部）"
          style="width: 280px"
          @press-enter="applyFilter"
        />
        <Button :loading="filtering" @click="applyFilter">查询</Button>
        <Button @click="filterProjectId = ''; load()">重置</Button>
        <!-- 触发扫描：后端 requireAdmin 仅超管（:60），组长不可见（禁为组长配该按钮） -->
        <Button v-if="isSuperAdmin" :loading="checking" type="primary" @click="runCheck">触发扫描</Button>
      </Space>
      <Alert v-if="errorMsg" class="mb-3" :message="errorMsg" type="error" show-icon role="alert">
        <template #action>
          <Button danger size="small" @click="load">重新加载</Button>
        </template>
      </Alert>

      <div v-if="phase === 'loading'" class="flex justify-center py-8" role="status">
        <Spin tip="正在加载升级链" />
      </div>
      <Empty v-else-if="phase === 'ready' && rows.length === 0" description="暂无升级链记录（P0 事件超期未升级时由后端自动登记）" />
      <Table
        v-else-if="phase === 'ready'"
        :columns="columns"
        :data-source="rows"
        :pagination="{ pageSize: 20, showSizeChanger: false }"
        row-key="id"
        size="small"
        bordered
      >
        <template #bodyCell="{ column, record }: { column: Record<string, any>; record: Record<string, any> }">
          <template v-if="column.key === 'id' || column.key === 'projectId' || column.key === 'p0EventId'">
            <span class="font-mono">{{ record[column.key] }}</span>
          </template>
          <template v-else-if="column.key === 'escalationCount'">
            <span class="tabular-nums">{{ record.escalationCount }}</span>
          </template>
          <template v-else-if="column.key === 'lastEscalationAt'">
            <span class="tabular-nums">{{ record.lastEscalationAt ?? PENDING_TEXT }}</span>
          </template>
          <template v-else-if="column.key === 'nextThresholdAt'">
            <span class="tabular-nums">{{ record.nextThresholdAt ?? PENDING_TEXT }}</span>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="statusColor(record.status)">{{ statusText(record.status) }}</Tag>
          </template>
          <template v-else-if="column.key === 'remark'">
            {{ record.remark ?? PENDING_TEXT }}
          </template>
          <template v-else-if="column.key === 'action'">
            <!-- RESOLVED 行不再提供处置入口（状态机已闭环）；PENDING/ESCALATED 行组长+超管可处置 -->
            <Button v-if="record.status !== 'RESOLVED'" size="small" type="link" @click="openResolve(record)">
              标记处置完成
            </Button>
            <span v-else class="text-xs text-gray-400">已闭环</span>
          </template>
        </template>
      </Table>
    </Card>

    <Modal
      v-model:open="resolveOpen"
      :confirm-loading="resolving"
      :mask-closable="false"
      cancel-text="取消"
      ok-text="确认处置完成"
      title="标记升级链处置完成（RESOLVED）"
      width="520px"
      @ok="submitResolve"
    >
      <div class="py-2">
        <p class="text-muted-foreground mb-3 text-sm">
          将升级链
          <span class="font-mono">#{{ resolveTarget?.id ?? '' }}</span>
          （项目 <span class="font-mono">{{ resolveTarget?.projectId ?? '' }}</span>）标记为已处置，
          后端停止该 (项目, P0 事件) 的继续计数。
        </p>
        <div class="mb-1 text-xs text-gray-500">处置备注（选填，随审计留痕）</div>
        <Textarea v-model:value="resolveRemark" :maxlength="200" :rows="3" placeholder="如：已督促双方组长升级，P0 已恢复处理" />
      </div>
    </Modal>
  </div>
</template>
