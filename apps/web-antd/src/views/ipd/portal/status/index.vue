<script setup lang="ts">
// 卡片 P0-10.39：需求门户-查询进度（免登录顶层页，不套后台布局）。
// 凭 8 位查询码查询脱敏进度；查询码隔离——仅凭码查询，服务端只返回该码对应的需求。
// 五态：成功（徽章+时间线）/ 拒绝（码错误→明确文案、限流等）/ 空态（未查询引导、空时间线）/ 加载 / 断网。
import type { PortalDemandTrace } from '../../../../api/ipd/portal';

import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Alert, Badge, Button, Descriptions, Empty, Form, Input, Spin, Timeline } from 'ant-design-vue';

import { fetchPortalDemandByCode, PORTAL_CODE_PATTERN } from '../../../../api/ipd/portal';
import { formatDateTime } from '../../_shared/format';
import PortalShell from '../portal-shell.vue';

const route = useRoute();
const form = reactive({ code: '' });
const querying = ref(false);
const errorText = ref('');
/** 查询成功的结果；非空时显示进度面板。 */
const trace = ref<PortalDemandTrace | null>(null);
/** 是否已发起过查询（区分「未查询」空态与查询中/失败）。 */
const queried = ref(false);

/** 页39 状态徽章映射（规格 8 态；未知值显式「待补充」，G-06 禁止空白）。 */
const STATUS_TEXT: Record<string, string> = {
  SUBMITTED: '已提交待受理',
  ACCEPTED: '已受理',
  EVALUATING: '评估中',
  SCHEDULED: '已排期',
  PROCESSING: '处理中',
  CLOSED: '已关闭',
  ARCHIVED: '已归档',
  WITHDRAWN: '已撤回',
};
function statusText(status: string): string {
  return STATUS_TEXT[status] ?? '待补充';
}
function badgeKind(status: string): 'default' | 'error' | 'processing' | 'success' | 'warning' {
  if (status === 'WITHDRAWN') return 'warning';
  if (status === 'CLOSED' || status === 'ARCHIVED') return 'default';
  if (status === 'SUBMITTED' || status === 'ACCEPTED' || status === 'EVALUATING' || status === 'SCHEDULED' || status === 'PROCESSING') return 'processing';
  return 'default';
}

onMounted(() => {
  // 规格 §5①：游客凭 38 页 8 位码访问 /portal/track?code=… 时自动查询
  const prefill = typeof route.query.code === 'string' ? route.query.code.toUpperCase() : '';
  if (PORTAL_CODE_PATTERN.test(prefill)) {
    form.code = prefill;
    void queryTrace();
  }
});

function sanitizeCodeInput() {
  form.code = form.code.toUpperCase().replaceAll(/[^A-Z0-9]/g, '').slice(0, 8);
}

async function queryTrace() {
  if (querying.value) return;
  if (!PORTAL_CODE_PATTERN.test(form.code)) {
    errorText.value = '请输入 8 位大写字母或数字的查询码';
    return;
  }
  querying.value = true;
  errorText.value = '';
  queried.value = true;
  trace.value = null;
  try {
    trace.value = await fetchPortalDemandByCode(form.code);
  } catch (cause) {
    errorText.value = cause instanceof Error ? cause.message : '查询失败，请稍后重试';
  } finally {
    querying.value = false;
  }
}
</script>

<template>
  <PortalShell>
    <h1 class="mb-2 text-xl font-semibold" data-testid="portal-track-title">查询进度</h1>
    <p class="mb-4 text-sm text-[#909399]">输入提交成功时保存的 8 位查询码，查看该需求的处理进度。</p>
    <Alert class="mb-6" type="info" show-icon
      message="本系统仅展示您提交需求的处理进度，不公开内部负责人与评审信息。" />

    <!-- 查询表单 -->
    <Form :model="form" layout="vertical" @finish="queryTrace">
      <Form.Item label="查询码" name="code"
        :rules="[{ required: true, pattern: /^[A-Z0-9]{8}$/, message: '查询码为 8 位大写字母或数字' }]">
        <div class="flex gap-2">
          <Input v-model:value="form.code" :maxlength="8" size="large" class="portal-code-input"
            placeholder="如 AB12CD34" data-testid="portal-track-input" @input="sanitizeCodeInput" />
          <Button type="primary" size="large" html-type="submit" :loading="querying" data-testid="portal-track-button">
            查询进度
          </Button>
        </div>
      </Form.Item>
    </Form>

    <!-- 拒绝态：业务码中文文案（码错误 / 限流 / 断网） -->
    <Alert v-if="errorText" class="mb-4" type="error" show-icon :message="errorText" role="alert" data-testid="portal-track-error" />

    <!-- 成功态：状态徽章 + 时间线 + 附件清单（仅文件名/大小） -->
    <div v-if="trace" data-testid="portal-track-result">
      <Descriptions class="mb-4" :column="1" size="small" bordered>
        <Descriptions.Item key="status" label="当前状态">
          <Badge :status="badgeKind(trace.status)" :text="statusText(trace.status)" data-testid="portal-status-badge" />
        </Descriptions.Item>
        <Descriptions.Item key="customer" label="客户名称">
          <span data-testid="portal-track-customer">{{ trace.customerName || '待补充' }}</span>
        </Descriptions.Item>
        <Descriptions.Item key="code" label="查询码">
          <span class="font-mono tracking-[0.15em]" data-testid="portal-track-code">{{ trace.code }}</span>
        </Descriptions.Item>
      </Descriptions>

      <h2 class="mb-3 text-base font-medium">处理时间线</h2>
      <Timeline v-if="trace.timeline.length > 0" data-testid="portal-timeline">
        <Timeline.Item v-for="(entry, index) in trace.timeline" :key="`${entry.stage}-${index}`">
          <p class="text-sm font-medium">{{ statusText(entry.stage) }}</p>
          <p class="text-xs text-[#909399]">{{ formatDateTime(entry.occurredAt ?? null, '待补充') }}</p>
          <p v-if="entry.memo" class="mt-1 text-xs text-[#606266]">{{ entry.memo }}</p>
        </Timeline.Item>
      </Timeline>
      <!-- 空态：时间线为空（G-06：显式文案，不留空白） -->
      <Empty v-else description="暂无处理记录，需求仍在排队中，请稍后再来查看。" data-testid="portal-timeline-empty" />

      <template v-if="trace.attachments.length > 0">
        <h2 class="mb-3 mt-5 text-base font-medium">附件清单</h2>
        <ul class="list-disc pl-5 text-sm text-[#606266]" data-testid="portal-attachments">
          <li v-for="file in trace.attachments" :key="file.fileName">
            {{ file.fileName }}<template v-if="file.fileSize !== null">（{{ file.fileSize }}）</template>
          </li>
        </ul>
      </template>
    </div>

    <!-- 空态：尚未查询时的引导（G-06：不展示任何模拟数据） -->
    <div v-else-if="!queried && !errorText" class="py-6 text-center" data-testid="portal-track-empty">
      <Empty description="输入查询码后点击「查询进度」，查看您提交需求的处理进度。" />
    </div>

    <!-- 加载态 -->
    <div v-else-if="querying" class="flex justify-center py-6">
      <Spin size="large" data-testid="portal-track-loading" />
    </div>
  </PortalShell>
</template>

<style scoped>
/* 查询码输入框用等宽字体，便于对照抄写 8 位码 */
.portal-code-input :deep(input) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}
</style>
