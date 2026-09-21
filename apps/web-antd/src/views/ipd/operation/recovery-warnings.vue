<script setup lang="ts">
/**
 * 90 日回款预警（R149 后端实装；前端 /ipd/operation/recovery-warnings 路由承载）。
 *
 * 设计：触发扫描（POST /api/v1/recovery/check-90d?scanDate=）+ 列表（GET /api/v1/recovery/warnings）。
 * 列表字段跟 RecoveryWarning：项目、预警日期、距上市天数、回款比例、阈值、状态。
 * - 触发扫描弹窗：日期选择，默认当天（YYYY-MM-DD），沿用 format/value-format 双向；
 * - 列表：项目名称 / 预警日期 / 回款截止 / 已逾期天数 / 金额 / 状态 / 创建时间；
 * - 五态：加载 / 列表 / 空态 / 拒绝与断网；不展示任何模拟数据（G-06）。
 * - Alert 顶部说明：触发扫描后会自动通知超管与产品组长（业务契约）。
 *
 * 权限：路由 meta.access 走 PAGE_PERMISSIONS['/ipd/operation/recovery-warnings']
 *   （RECOVERY_CHECK_90D + RECOVERY_WARNINGS_QUERY），按钮 v-access:code 双闸门禁。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  message as antMessage,
} from 'ant-design-vue';
import dayjs, { type Dayjs } from 'dayjs';

import {
  type RecoveryWarningItem,
  checkRecovery90d,
  listRecoveryWarnings,
} from '../../../api/ipd/recovery';
import { IPD_PERMISSION_CODES } from '../_shared/ipd-permission-codes';

type Phase = 'error' | 'loading' | 'ready';

const rows = ref<RecoveryWarningItem[]>([]);
const phase = ref<Phase>('loading');
const errorMsg = ref('');

function rejectText(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作失败，请稍后重试';
}

async function load(): Promise<void> {
  phase.value = 'loading';
  errorMsg.value = '';
  try {
    rows.value = await listRecoveryWarnings();
    phase.value = 'ready';
  } catch (cause) {
    phase.value = 'error';
    errorMsg.value = rejectText(cause);
  }
}

onMounted(load);

/** 触发扫描弹窗（默认日期 = 今天）。 */
const scanOpen = ref(false);
const scanDate = reactive<{ value: Dayjs }>({ value: dayjs() });
const scanning = ref(false);
function openScan(): void {
  scanDate.value = dayjs();
  scanOpen.value = true;
}

async function submitScan(): Promise<void> {
  if (scanning.value) return;
  scanning.value = true;
  try {
    const dateStr = scanDate.value.format('YYYY-MM-DD');
    const saved = await checkRecovery90d(dateStr);
    antMessage.success(`扫描完成：新增 ${saved} 条预警（${dateStr}）`);
    scanOpen.value = false;
    await load();
  } catch (cause) {
    antMessage.error(rejectText(cause));
  } finally {
    scanning.value = false;
  }
}

const columns = [
  { dataIndex: 'projectId', key: 'projectId', title: '项目', width: 140 },
  { dataIndex: 'warningDate', key: 'warningDate', title: '预警日期', width: 130 },
  { dataIndex: 'daysSinceLaunch', key: 'daysSinceLaunch', title: '距上市', width: 110 },
  { dataIndex: 'recoveryRate', key: 'recoveryRate', title: '回款比例', width: 120 },
  { dataIndex: 'threshold', key: 'threshold', title: '阈值', width: 100 },
  { dataIndex: 'status', key: 'status', title: '状态', width: 110 },
];

/** 把 0~1 的比例格式化成百分数；空值或非数字显示破折号。 */
function percentText(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

const STATUS_TEXT: Record<string, string> = {
  PENDING: '待处理',
  HANDLED: '已处理',
  IGNORED: '已忽略',
};

const rowsCount = computed(() => rows.value.length);
function asRecord(record: Record<string, any>): RecoveryWarningItem {
  return record as RecoveryWarningItem;
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <Alert
      message="90 日回款预警——触发扫描后会自动通知超管与产品组长"
      description="列表展示当前超管可见范围内已触发的预警条目（ACTIVE / RESOLVED），逾期天数与金额按服务端口径展示；触发扫描时可选指定扫描日期（默认当天）。"
      show-icon
      type="info"
    />

    <Card>
      <template #title>
        <Space>
          <span>预警列表</span>
          <Tag color="default">当前 {{ rowsCount }} 条</Tag>
        </Space>
      </template>
      <Space wrap>
        <Button v-access:code="IPD_PERMISSION_CODES.RECOVERY_CHECK_90D" type="primary" @click="openScan">
          触发扫描
        </Button>
        <Button v-access:code="IPD_PERMISSION_CODES.RECOVERY_WARNINGS_QUERY" @click="load">刷新</Button>
      </Space>
    </Card>

    <Card v-if="phase === 'loading'" class="text-center">
      <Spin tip="正在加载预警列表" />
    </Card>

    <template v-else>
      <Alert v-if="phase === 'error'" :message="errorMsg" show-icon type="error" role="alert">
        <template #action>
          <Button danger size="small" @click="load">重新加载</Button>
        </template>
      </Alert>

      <Card v-else-if="rowsCount === 0" class="text-center">
        <Empty description="尚无预警记录。可点击「触发扫描」按选定日期检查。" />
      </Card>

      <Card v-else>
        <Table :columns="columns" :data-source="rows" :pagination="{ pageSize: 20, showSizeChanger: false }" row-key="id" size="middle">
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'projectId'">
              <span class="font-medium tabular-nums">#{{ asRecord(record).projectId }}</span>
            </template>
            <template v-else-if="column.key === 'warningDate'">
              <span class="tabular-nums">{{ asRecord(record).warningDate || '—' }}</span>
            </template>
            <template v-else-if="column.key === 'daysSinceLaunch'">
              <span class="tabular-nums">{{ asRecord(record).daysSinceLaunch ?? 0 }} 天</span>
            </template>
            <template v-else-if="column.key === 'recoveryRate'">
              <span class="tabular-nums">{{ percentText(asRecord(record).recoveryRate) }}</span>
            </template>
            <template v-else-if="column.key === 'threshold'">
              <span class="tabular-nums">{{ percentText(asRecord(record).threshold) }}</span>
            </template>
            <template v-else-if="column.key === 'status'">
              <Tag :color="asRecord(record).status === 'PENDING' ? 'red' : 'default'">
                {{ STATUS_TEXT[asRecord(record).status] ?? asRecord(record).status }}
              </Tag>
            </template>
          </template>
        </Table>
      </Card>
    </template>

    <Modal
      v-model:open="scanOpen"
      :confirm-loading="scanning"
      :mask-closable="false"
      cancel-text="取消"
      ok-text="触发扫描"
      title="触发 90 日回款预警扫描"
      width="480px"
      @ok="submitScan"
    >
      <div class="py-2">
        <p class="text-muted-foreground mb-3 text-sm">
          扫描会以选定日期为基准检查回款超期项目，触发后将自动通知超管与产品组长。
        </p>
        <Space>
          <span>扫描日期：</span>
          <DatePicker v-model:value="scanDate.value" format="YYYY-MM-DD" placeholder="选择日期" value-format="YYYY-MM-DD" />
        </Space>
      </div>
    </Modal>
  </div>
</template>
