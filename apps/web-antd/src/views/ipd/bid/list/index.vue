<template>
  <div class="p-4">
    <Card>
      <!-- ZK-IPD §四.1.3 招标规则提示 -->
      <Alert
        class="mb-3"
        type="info"
        show-icon
        message="ZK-IPD 招标规则"
        :description="bidListRules"
      />

      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <Select
            v-model:value="statusFilter"
            class="w-36"
            :options="statusOptions"
            @change="reloadFromFirstPage"
          />
          <Checkbox v-model:checked="onlyMine">只看待我应标</Checkbox>
          <span v-if="onlyMine" class="text-muted-foreground text-xs">（在当前页结果中筛选）</span>
        </div>
        <Tooltip v-if="!canCreateBid" :title="createDeniedReason">
          <Button type="primary" disabled>发起招标</Button>
        </Tooltip>
        <Button v-else type="primary" @click="goCreate">发起招标</Button>
      </div>

      <!-- 拒绝/断网态：错误码到中文文案的映射见 _shared/ipd-error-text.ts（domain: 'bid'） -->
      <Alert
        v-if="loadError"
        class="mb-4"
        :message="ipdErrorText(loadError, { domain: 'bid', fallback: '招标单加载失败，请稍后重试' })"
        type="error"
        show-icon
        role="alert"
      >
        <template #description>
          <Button size="small" @click="load">重新加载</Button>
        </template>
      </Alert>

      <!-- 空态：给出方向性引导（公共规范第八节写法规则） -->
      <Empty v-else-if="!loading && rows.length === 0" :description="emptyText">
        <Button v-if="canCreateBid" type="primary" @click="goCreate">发起招标</Button>
      </Empty>

      <Table
        v-else
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :pagination="pagination"
        :scroll="{ x: 960 }"
        row-key="id"
        size="middle"
        @change="onTableChange"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'title'">
            <Button type="link" class="!px-0" @click="openDetail(asBid(record))">{{ record.title || '待补充' }}</Button>
          </template>
          <template v-else-if="column.key === 'mode'">
            <Tag>{{ bidModeText(record.mode) }}</Tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="bidStatusColor(record.status)">{{ bidStatusText(record.status) }}</Tag>
          </template>
          <template v-else-if="column.key === 'expireAt'">
            {{ bidTimeText(record.expireAt) }}
          </template>
          <template v-else-if="column.key === 'createTime'">
            {{ bidTimeText(record.createTime) }}
          </template>
          <template v-else-if="column.key === 'actions'">
            <Space size="small" wrap>
              <Button v-if="isInvitedRdPm(asBid(record))" size="small" type="link" @click="goRespond(asBid(record))">去应标</Button>
              <Button v-if="isCreator(asBid(record)) && record.status === 'OPEN'" size="small" type="link" @click="goSelect(asBid(record))">遴选</Button>
              <Button v-if="isCreator(asBid(record)) && record.status === 'SELECTED'" size="small" type="link" @click="goSelect(asBid(record))">查看遴选结果</Button>
              <Button size="small" type="link" @click="openDetail(asBid(record))">详情</Button>
              <Button
                v-if="isCreator(asBid(record)) && record.status === 'OPEN'"
                size="small"
                type="link"
                :loading="isBusy(asBid(record), 'modify')"
                @click="openModify(asBid(record))"
              >修改</Button>
              <Popconfirm
                v-if="isCreator(asBid(record)) && record.status === 'OPEN'"
                title="确认撤回该招标单？创建超过 24 小时后将无法撤回。"
                @confirm="doWithdraw(asBid(record))"
              >
                <Button size="small" type="link" danger :loading="isBusy(asBid(record), 'withdraw')">撤回</Button>
              </Popconfirm>
              <Popconfirm
                v-if="isCreator(asBid(record)) && ['OPEN', 'SELECTED'].includes(record.status)"
                title="确认关闭该招标单？关闭后不再接受应标。"
                @confirm="doClose(asBid(record))"
              >
                <Button size="small" type="link" danger :loading="isBusy(asBid(record), 'close')">关闭</Button>
              </Popconfirm>
              <!-- R215 GAP-F1：AC-TEAM-09 超管对挂起（EXPIRED）招标单强制指派；30 日年龄门禁由后端硬校验 -->
              <Button
                v-if="isSuperAdmin && record.status === 'EXPIRED'"
                size="small"
                type="link"
                :loading="isBusy(asBid(record), 'assign')"
                @click="openAssign(asBid(record))"
              >超管指派</Button>
            </Space>
            <div v-if="actionError === record.id" class="mt-1 text-xs">
              <span class="text-destructive">{{ ipdErrorText(actionErrorCause, { domain: 'bid', fallback: '操作失败，请稍后重试' }) }}</span>
              <Button size="small" type="link" @click="load">刷新列表</Button>
              <Button size="small" type="link" @click="actionError = null">知道了</Button>
            </div>
          </template>
        </template>
      </Table>
    </Card>

    <!-- 招标单详情抽屉 -->
    <Drawer v-model:open="detailOpen" title="招标单详情" width="520">
      <Spin :spinning="detailLoading">
        <Alert
          v-if="detailError"
          :message="ipdErrorText(detailError, { domain: 'bid', fallback: '招标单详情加载失败' })"
          type="error"
          show-icon
        />
        <template v-else-if="detail">
          <Descriptions :column="1" size="small" bordered>
            <Descriptions.Item label="状态">
              <Tag :color="bidStatusColor(detail.status)">{{ bidStatusText(detail.status) }}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="招标方式">{{ bidModeText(detail.mode) }}</Descriptions.Item>
            <Descriptions.Item label="有效期至">{{ bidTimeText(detail.expireAt) }}</Descriptions.Item>
            <Descriptions.Item v-if="detail.mode === 'ONE_TO_ONE'" label="指定研发PM ID">{{ detail.targetPersonId ?? '待补充' }}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{{ bidTimeText(detail.createTime) }}</Descriptions.Item>
          </Descriptions>
          <h4 class="mt-4 mb-1 font-medium">招标内容</h4>
          <p class="whitespace-pre-wrap">{{ detail.content || '待补充' }}</p>
          <div class="mt-4 flex gap-2">
            <Button v-if="isInvitedRdPm(detail)" type="primary" @click="goRespond(detail)">去应标</Button>
            <Button v-if="isCreator(detail)" @click="goSelect(detail)">查看应标与遴选</Button>
          </div>
        </template>
      </Spin>
    </Drawer>

    <!-- R215 GAP-F1：修改招标条件（AC-TEAM-13 发起人本人 + OPEN + 有效期内；PUT query 三参，expireAt yyyy-MM-dd HH:mm:ss） -->
    <Modal
      v-model:open="modifyOpen"
      title="修改招标条件"
      :confirm-loading="isBusy(modifyTarget ?? ({} as BidInvitation), 'modify')"
      ok-text="保存修改"
      cancel-text="取消"
      :mask-closable="false"
      @ok="submitModify"
    >
      <Alert v-if="modifyError" class="mb-2" :message="modifyError" type="error" show-icon />
      <div class="mb-1 text-xs text-gray-500">招标标题（不少于 4 字）</div>
      <Input v-model:value="modifyForm.title" :maxlength="120" class="mb-2" />
      <div class="mb-1 text-xs text-gray-500">招标内容（4~4000 字）</div>
      <Textarea v-model:value="modifyForm.content" :rows="4" :maxlength="4000" class="mb-2" />
      <div class="mb-1 text-xs text-gray-500">有效期截止（yyyy-MM-dd HH:mm:ss）</div>
      <DatePicker
        v-model:value="modifyForm.expireAt"
        show-time
        value-format="YYYY-MM-DD HH:mm:ss"
        format="YYYY-MM-DD HH:mm:ss"
        style="width: 100%"
      />
    </Modal>

    <!-- R215 GAP-F1：超管强制指派（仅 EXPIRED 挂起超 30 日，后端 BidInvitationService:509-518 硬校验；人员 ID string 透传） -->
    <Modal
      v-model:open="assignOpen"
      title="超管指派研发PM"
      :confirm-loading="isBusy(assignTarget ?? ({} as BidInvitation), 'assign')"
      ok-text="确认指派"
      cancel-text="取消"
      :mask-closable="false"
      @ok="submitAssign"
    >
      <Alert v-if="assignError" class="mb-2" :message="assignError" type="error" show-icon />
      <div class="mb-1 text-xs text-gray-500">目标研发PM 人员 ID（纯数字，雪花 ID 按字符串提交）</div>
      <Input v-model:value="assignPersonId" :maxlength="24" placeholder="如 2096266884247736321" />
      <p class="mt-1 text-xs text-gray-400">仅对挂起（已过期）超 30 日的招标单可用；提交后招标单直接置为「已遴选」。</p>
    </Modal>
  </div>
</template>

<script setup lang="ts">
// 页19 招标组队-招标单列表（看板卡 P0-10.19；后端 P2-3.1 / P2-3.2 已交付）。
// 布局：状态筛选 + 待我应标筛选 + 分页表格 + 行内操作（应标/遴选/撤回/关闭/详情抽屉）。
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';
import {
  adminAssignBidInvitation,
  closeBidInvitation,
  getBidInvitation,
  listBidInvitations,
  modifyBidInvitation,
  withdrawBidInvitation,
} from '../../../../api/ipd/bid';
import type { BidInvitation, IpdPage } from '../../../../api/ipd/bid';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import { bidModeText, bidStatusColor, bidStatusText, bidTimeText } from '../bid-display';
import { RULES_BY_PAGE, renderRulesDescription } from '../../_shared/zk-ipd-rules';
import '../../_shared/ipd-theme.css';

const router = useRouter();
const bidListRules = computed(() => renderRulesDescription(RULES_BY_PAGE.bidList));
const auth = useIpdAuthStore();

const loading = ref(false);
const loadError = ref<unknown>(null);
const page = ref<IpdPage<BidInvitation> | null>(null);
const statusFilter = ref('');
const onlyMine = ref(false);
const current = ref(1);
const pageSize = ref(20);
const actionError = ref<null | string>(null);
const actionErrorCause = ref<unknown>(null);
const busyKey = ref('');
const detailOpen = ref(false);
const detailLoading = ref(false);
const detailError = ref<unknown>(null);
const detail = ref<BidInvitation | null>(null);

const Textarea = Input.TextArea;
const myId = computed(() => auth.identity?.person.id ?? '');
const isSuperAdmin = computed(() => auth.identity?.person.personType === 'SUPER_ADMIN');
const isRdPm = computed(() => auth.identity?.person.personType === 'RD_PM');
const canCreateBid = computed(() => ['MARKET_PM', 'SUPER_ADMIN'].includes(auth.identity?.person.personType ?? ''));
const createDeniedReason = '发起招标通常由市场PM 操作，当前角色暂不可用。如需代创建请联系你的产品组长，由产品组长走超管指派端点（BID_INVITATION_ADMIN_ASSIGN）代为发起。';

const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '招标中', value: 'OPEN' },
  { label: '已遴选', value: 'SELECTED' },
  { label: '已过期', value: 'EXPIRED' },
  { label: '已关闭', value: 'CLOSED' },
];

const columns = [
  { title: '标题', key: 'title' },
  { title: '招标方式', key: 'mode' },
  { title: '状态', key: 'status' },
  { title: '有效期至', key: 'expireAt' },
  { title: '创建时间', key: 'createTime' },
  { title: '操作', key: 'actions', width: 260 },
];

const emptyText = computed(() =>
  statusFilter.value
    ? '暂无符合筛选条件的招标单。可切换状态或点击「刷新」重试。'
    : '暂无招标单。市场PM 可点击「发起招标」创建；研发PM 请等待定向邀请或公开征集。',
);

/** 待我应标：研发PM + 招标中 + 公开征集或定向邀请本人（仅服务端已返回的当前页内筛选）。 */
const rows = computed(() => {
  const records = page.value?.records ?? [];
  if (!onlyMine.value) return records;
  return records.filter((row) => isInvitedRdPm(row));
});

const pagination = computed(() => ({
  current: current.value,
  pageSize: pageSize.value,
  total: page.value?.total ?? 0,
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条`,
}));

function isCreator(record: BidInvitation): boolean {
  return !!myId.value && String(record.createBy ?? '') === myId.value;
}

/** Table bodyCell 的 record 不做类型收窄：统一在此收敛断言（与 project/list openDetail 同模式）。 */
function asBid(record: Record<string, any>): BidInvitation {
  return record as BidInvitation;
}

/** 研发PM 且「招标中」且（公开征集或定向邀请本人）→ 可应标（UI 按 spec 页21 限定研发PM 应标）。 */
function isInvitedRdPm(record: BidInvitation): boolean {
  const invited = record.mode === 'PUBLIC' || String(record.targetPersonId ?? '') === myId.value;
  return isRdPm.value && record.status === 'OPEN' && invited;
}

function isBusy(record: BidInvitation, action: 'assign' | 'close' | 'modify' | 'withdraw'): boolean {
  return !!record.id && busyKey.value === `${record.id}:${action}`;
}

function markBusy(record: BidInvitation, action: 'assign' | 'close' | 'modify' | 'withdraw'): void {
  busyKey.value = `${record.id}:${action}`;
}

function goCreate(): void {
  router.push('/ipd/bids/create').catch((err: unknown) => {
    message.error(`导航失败: ${err instanceof Error ? err.message : String(err)}`);
  });
}

async function goRespond(record: Pick<BidInvitation, 'id'>): Promise<void> {
  try {
    await router.push(`/ipd/bids/${record.id}/respond`);
  } catch (err: unknown) {
    message.error(`导航失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function goSelect(record: Pick<BidInvitation, 'id'>): void {
  router.push(`/ipd/bids/${record.id}/select`).catch((err: unknown) => {
    message.error(`导航失败: ${err instanceof Error ? err.message : String(err)}`);
  });
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  actionError.value = null;
  try {
    page.value = await listBidInvitations({
      pageNo: current.value,
      pageSize: pageSize.value,
      status: statusFilter.value || undefined,
    });
  } catch (cause) {
    loadError.value = cause;
  } finally {
    loading.value = false;
  }
}

function reloadFromFirstPage(): void {
  current.value = 1;
  load();
}

function onTableChange(pag: { current?: number; pageSize?: number }): void {
  current.value = pag.current ?? 1;
  pageSize.value = pag.pageSize ?? 20;
  load();
}

async function doWithdraw(record: BidInvitation): Promise<void> {
  markBusy(record, 'withdraw');
  try {
    await withdrawBidInvitation(record.id);
    message.success('招标单已撤回并关闭，不再接受应标');
    await load();
  } catch (cause) {
    actionError.value = record.id;
    actionErrorCause.value = cause;
  } finally {
    busyKey.value = '';
  }
}

async function doClose(record: BidInvitation): Promise<void> {
  markBusy(record, 'close');
  try {
    await closeBidInvitation(record.id);
    message.success('招标单已关闭');
    await load();
  } catch (cause) {
    actionError.value = record.id;
    actionErrorCause.value = cause;
  } finally {
    busyKey.value = '';
  }
}

// ---------- R215 GAP-F1：修改招标条件 / 超管指派（P2-3.3 AC-TEAM-13 / AC-TEAM-09） ----------
const modifyOpen = ref(false);
const modifyTarget = ref<BidInvitation | null>(null);
const modifyError = ref('');
const modifyForm = reactive({ content: '', expireAt: '', title: '' });
const assignOpen = ref(false);
const assignTarget = ref<BidInvitation | null>(null);
const assignPersonId = ref('');
const assignError = ref('');

function openModify(record: BidInvitation): void {
  modifyTarget.value = record;
  modifyForm.title = record.title ?? '';
  modifyForm.content = record.content ?? '';
  modifyForm.expireAt = record.expireAt ?? '';
  modifyError.value = '';
  modifyOpen.value = true;
}

async function submitModify(): Promise<void> {
  const record = modifyTarget.value;
  if (!record || busyKey.value === `${record.id}:modify`) return;
  const title = modifyForm.title.trim();
  const content = modifyForm.content.trim();
  if (title.length < 4) { modifyError.value = '招标标题不少于 4 字'; return; }
  if (content.length < 4 || content.length > 4000) { modifyError.value = '招标内容需 4~4000 字'; return; }
  if (!modifyForm.expireAt || new Date(modifyForm.expireAt.replace(' ', 'T')).getTime() <= Date.now()) {
    modifyError.value = '有效期截止须晚于当前时间（格式 yyyy-MM-dd HH:mm:ss）';
    return;
  }
  markBusy(record, 'modify');
  try {
    // 三值全量提交（后端 service 直接 set 三字段，BidInvitationService.java:456-458）
    await modifyBidInvitation(record.id, { content, expireAt: modifyForm.expireAt, title });
    message.success('招标条件已修改');
    modifyOpen.value = false;
    await load();
  } catch (cause) {
    modifyOpen.value = false;
    actionError.value = record.id;
    actionErrorCause.value = cause;
  } finally {
    busyKey.value = '';
  }
}

function openAssign(record: BidInvitation): void {
  assignTarget.value = record;
  assignPersonId.value = '';
  assignError.value = '';
  assignOpen.value = true;
}

async function submitAssign(): Promise<void> {
  const record = assignTarget.value;
  if (!record) return;
  const targetPersonId = assignPersonId.value.trim();
  // 19 位雪花 ID 校验：仅数字串，禁 Number()（string 透传，参照 create/index.vue:167 先例）
  if (!/^\d+$/.test(targetPersonId)) {
    assignError.value = '请填写目标研发PM 的人员 ID（纯数字字符串）';
    return;
  }
  markBusy(record, 'assign');
  try {
    await adminAssignBidInvitation(record.id, targetPersonId);
    message.success('已超管指派，招标单置为「已遴选」');
    assignOpen.value = false;
    await load();
  } catch (cause) {
    assignOpen.value = false;
    actionError.value = record.id;
    actionErrorCause.value = cause;
  } finally {
    busyKey.value = '';
  }
}

async function openDetail(record: Pick<BidInvitation, 'id'>): Promise<void> {
  detailOpen.value = true;
  detailLoading.value = true;
  detailError.value = null;
  detail.value = null;
  try {
    detail.value = await getBidInvitation(record.id);
  } catch (cause) {
    detailError.value = cause;
  } finally {
    detailLoading.value = false;
  }
}

onMounted(load);
</script>
