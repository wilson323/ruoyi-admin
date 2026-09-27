<script setup lang="ts">
// 卡片 P0-10.39：需求门户-查询进度（免登录顶层页，不套后台布局）。
// 凭 8 位查询码查询脱敏进度；查询码隔离——仅凭码查询，服务端只返回该码对应的需求。
// 五态：成功（徽章+时间线）/ 拒绝（码错误→明确文案、限流等）/ 空态（未查询引导、空时间线）/ 加载 / 断网。
import type { PortalDemandTrace } from '../../../../api/ipd/portal';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Alert, Badge, Button, Descriptions, Empty, Form, Input, message, Modal, Spin, Timeline } from 'ant-design-vue';

import {
  fetchPortalDemandByCode,
  PORTAL_CODE_PATTERN,
  supplementDemand,
  withdrawDemand,
} from '../../../../api/ipd/portal';
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

/** 页39 状态徽章映射（规格 8 态；未知值显式「待补充」，G-06 禁止空白）。
 *
 * 注意：本页文案与 `_shared/ipd-state-machines.DEMAND_STATUS_MACHINE` 故意不同 —
 *  游客侧强调动作进展（「已提交待受理」/「评估中」/「已排期」），内部侧强调状态归档（「新提交」/「分析中」/「已规划」）。
 *  若未来打通，应同步更新 SSOT + 此处，不应改一边。
 */
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

// ---------- R3 补登/撤回（仅 SUBMITTED 可用；入口可见性受 trace.canSupplement / canWithdraw 控制） ----------
const supplementModalOpen = ref(false);
const supplementSubmitting = ref(false);
const supplementFormRef = ref();
const supplementForm = reactive({ contact: '', functionalRequirement: '' });
const withdrawModalOpen = ref(false);
const withdrawing = ref(false);
/** 操作失败文案（api 层已按业务码映射中文，此处直接展示 cause.message，与查询失败同源机制）。 */
const actionError = ref('');
/** 补登内容非空才允许提交（双重保护：Form rule 报错 + 按钮 disabled 防绕过）。 */
const supplementReady = computed(() => supplementForm.functionalRequirement.trim().length > 0);
/** OK 按钮 disabled 计算属性：响应式传递给 Modal（inline 字面量不会被 Modal 反应式追踪）。 */
const supplementOkButtonProps = computed(() => ({ disabled: !supplementReady.value }));

function openSupplementModal() {
  actionError.value = '';
  supplementForm.contact = '';
  supplementForm.functionalRequirement = '';
  supplementModalOpen.value = true;
}

function openWithdrawModal() {
  actionError.value = '';
  withdrawModalOpen.value = true;
}

/** 操作成功后重新拉取 trace 刷新视图（面板保留不置空，避免刷新闪烁）。 */
async function reloadTrace() {
  if (!trace.value) return;
  try {
    trace.value = await fetchPortalDemandByCode(trace.value.code);
    errorText.value = '';
  } catch (cause) {
    errorText.value = cause instanceof Error ? cause.message : '查询失败，请稍后重试';
  }
}

async function submitSupplement() {
  if (supplementSubmitting.value || !trace.value || !supplementReady.value) return;
  try {
    await supplementFormRef.value?.validate();
  } catch {
    return; // AntDV validate 抛错（errorFields），字段级错误由 Form.Item 展示
  }
  supplementSubmitting.value = true;
  actionError.value = '';
  try {
    await supplementDemand(trace.value.code, {
      contact: supplementForm.contact,
      functionalRequirement: supplementForm.functionalRequirement,
    });
    supplementModalOpen.value = false;
    message.success('补登成功');
    await reloadTrace();
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : '补登失败，请稍后重试';
  } finally {
    supplementSubmitting.value = false;
  }
}

async function submitWithdraw() {
  if (withdrawing.value || !trace.value) return;
  withdrawing.value = true;
  actionError.value = '';
  try {
    await withdrawDemand(trace.value.code);
    withdrawModalOpen.value = false;
    message.success('撤回成功');
    await reloadTrace();
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : '撤回失败，请稍后重试';
  } finally {
    withdrawing.value = false;
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

      <!-- R3 操作入口：可见性严格由 canSupplement / canWithdraw 控制（受理后锁定即隐藏） -->
      <div v-if="trace.canSupplement || trace.canWithdraw" class="mb-4 flex gap-2" data-testid="portal-trace-actions">
        <Button v-if="trace.canSupplement" data-testid="portal-supplement-button" @click="openSupplementModal">
          补登
        </Button>
        <Button v-if="trace.canWithdraw" danger data-testid="portal-withdraw-button" @click="openWithdrawModal">
          撤回
        </Button>
      </div>

      <!-- 操作失败：业务码中文文案（api 层已映射，如 50002 受理后锁定） -->
      <Alert v-if="actionError" class="mb-4" type="error" show-icon :message="actionError"
        role="alert" data-testid="portal-action-error" />

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

    <!-- R3 补登 Modal：functionalRequirement ≤4000 / contact ≤128（与 GuestDemandUpdateReq @Size 红线一致） -->
    <Modal v-model:open="supplementModalOpen" :confirm-loading="supplementSubmitting"
      :mask-closable="false" :ok-button-props="supplementOkButtonProps"
      cancel-text="取消" ok-text="提交补登" title="补登需求信息" @ok="submitSupplement">
      <Form ref="supplementFormRef" :model="supplementForm" layout="vertical">
        <Form.Item label="补登内容" name="functionalRequirement" required
          :rules="[
            { required: true, message: '请填写补登内容' },
            { max: 4000, message: '补登内容不能超过 4000 字' },
          ]">
          <!-- 长度红线以 Form 规则为权威校验层（可见报错，不静默截断丢字）；show-count 仅做实时计数提示 -->
          <Input.TextArea v-model:value="supplementForm.functionalRequirement" :rows="4"
            data-testid="portal-supplement-content" placeholder="补充说明功能需求，例如使用场景、期望效果"
            show-count />
        </Form.Item>
        <Form.Item label="联系方式" name="contact"
          :rules="[{ max: 128, message: '联系方式不能超过 128 字' }]">
          <Input v-model:value="supplementForm.contact"
            data-testid="portal-supplement-contact" placeholder="手机号或邮箱，便于我们回访（可留空）" />
        </Form.Item>
      </Form>
    </Modal>

    <!-- R3 撤回 Modal：二次确认（撤回后需求关闭，不可恢复） -->
    <Modal v-model:open="withdrawModalOpen" :confirm-loading="withdrawing" :mask-closable="false"
      cancel-text="取消" ok-text="确认撤回" title="确认撤回需求？" @ok="submitWithdraw">
      <Alert type="warning" show-icon
        message="撤回后该需求将关闭且不可恢复，请确认不再需要处理该需求。" />
    </Modal>
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
