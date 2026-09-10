<template>
  <div class="mx-auto max-w-[900px] p-4">
    <!-- 加载态 -->
    <Card v-if="loading">
      <Spin class="flex justify-center py-12" />
    </Card>

    <template v-else>
      <!-- 断网 / 拒绝态 -->
      <Alert
        v-if="loadError"
        class="mb-4"
        :message="ipdErrorText(loadError, { domain: 'bid', fallback: '遴选信息加载失败，请稍后重试', codeTexts: { 50001: '招标单不存在或已被删除', 90001: '招标单不存在或服务暂时不可用，请稍后重试' } })"
        type="error"
        show-icon
        role="alert"
      >
        <template #description>
          <Button size="small" @click="load">重新加载</Button>
          <Button size="small" type="link" @click="goBack">返回招标单列表</Button>
        </template>
      </Alert>

      <Alert v-else-if="!bidId" class="mb-4" message="缺少招标单标识，请从招标单列表进入。" type="warning" show-icon>
        <template #description>
          <Button size="small" @click="goBack">返回招标单列表</Button>
        </template>
      </Alert>

      <template v-else-if="invitation">
        <Card class="mb-4">
          <template #title>{{ invitation.title || '待补充' }}</template>
          <Descriptions :column="1" size="small">
            <Descriptions.Item label="状态">
              <Tag :color="bidStatusColor(invitation.status)">{{ bidStatusText(invitation.status) }}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="招标方式">{{ bidModeText(invitation.mode) }}</Descriptions.Item>
            <Descriptions.Item label="有效期至">{{ bidTimeText(invitation.expireAt) }}</Descriptions.Item>
          </Descriptions>
          <h4 class="mt-3 mb-1 font-medium">招标内容</h4>
          <p class="whitespace-pre-wrap">{{ invitation.content || '待补充' }}</p>
        </Card>

        <!-- 权限边界：仅招标发起人可执行遴选（服务端对非发起人只返回其本人应标，不足以遴选） -->
        <Alert v-if="!isCreator" class="mb-4" message="仅招标发起人可执行遴选，当前账号不是本招标单发起人。" type="warning" show-icon />

        <template v-else>
          <!-- 状态说明：非招标中时为只读 -->
          <Alert
            v-if="invitation.status === 'SELECTED'"
            class="mb-4"
            message="本招标单已完成遴选，以下为遴选结果（中标一行，其余自动置为已落选）。"
            type="success"
            show-icon
          />
          <Alert
            v-else-if="invitation.status !== 'OPEN'"
            class="mb-4"
            :message="`本招标单当前状态为「${bidStatusText(invitation.status)}」，不再允许遴选。`"
            type="info"
            show-icon
          />
          <Alert
            v-else
            class="mb-4"
            message="从待遴选的应标中确定一名中标研发PM：确认后其中标行置为「已中标」，同单其余待遴选应标将自动置为「已落选」，操作不可撤销。"
            type="info"
            show-icon
          />

          <!-- 遴选提交失败（拒绝/断网态） -->
          <Alert
            v-if="selectError"
            class="mb-4"
            :message="selectError"
            type="error"
            show-icon
            role="alert"
          >
            <template #description>
              <Button size="small" @click="load">刷新后重试</Button>
            </template>
          </Alert>

          <Card :title="invitation.status === 'OPEN' ? '待遴选应标' : '应标记录'" class="mb-4">
            <Empty v-if="responses.length === 0" description="暂无应标记录。招标有效期内研发PM 提交应标后将在此显示。" />
            <Table
              v-else
              :columns="responseColumns"
              :data-source="responses"
              :pagination="false"
              :row-class-name="rowClassName"
              row-key="id"
              size="middle"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'rdPm'">
                  {{ rdPmLabel(asResponse(record)) }}
                </template>
                <template v-else-if="column.key === 'note'">
                  <span class="whitespace-pre-wrap">{{ record.responseNote || '待补充' }}</span>
                </template>
                <template v-else-if="column.key === 'respondedAt'">
                  {{ bidTimeText(record.respondedAt) }}
                </template>
                <template v-else-if="column.key === 'status'">
                  <Tag :color="bidResponseStatusColor(record.status)">{{ bidResponseStatusText(record.status) }}</Tag>
                </template>
                <template v-else-if="column.key === 'choose'">
                  <Radio
                    :checked="selectedResponseId === record.id"
                    :disabled="!canChoose(asResponse(record))"
                    @change="selectedResponseId = record.id"
                  >
                    {{ record.id === invitation.selectedResponseId ? '中标' : '选定为中标' }}
                  </Radio>
                </template>
              </template>
            </Table>
          </Card>

          <!-- 确认区：3 选 1 原子遴选（服务端单事务 + 行锁防双中标） -->
          <Card v-if="invitation.status === 'OPEN'" title="确认遴选">
            <p class="mb-3 text-sm">
              <template v-if="selected">已选择：{{ rdPmLabel(selected) }}</template>
              <template v-else>请先在上方从待遴选应标中选择一名中标研发PM。</template>
            </p>
            <Popconfirm
              title="确认为该研发PM 中标？其余待遴选应标将自动置为已落选，操作不可撤销。"
              @confirm="doSelect"
            >
              <Button type="primary" :disabled="!selected" :loading="confirmBusy">确认遴选</Button>
            </Popconfirm>
            <p class="text-muted-foreground mt-3 text-xs">
              遴选为原子操作：一个招标单仅能确定一名中标人；完成后招标单进入「已遴选」状态，落选者可凭本页记录查看结果。
            </p>
          </Card>
        </template>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
// 页22 遴选（看板卡 P0-10.22；后端 PUT /bid-invitations/{id}/select 3 选 1 原子遴选已交付）。
// 幂等/防双中标的前端表达：提交期间禁用全部交互；成功后刷新进入只读结果态；
// 服务端 50002（状态冲突）映射为「请刷新后查看」的中文提示。
// 差异登记：spec 页22 要求遴选理由（≥10 字）入审计，后端 select 端点未提供 reason 通道，故 UI 不放置理由输入。
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  message,
  Popconfirm,
  Radio,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';
import { getBidInvitation, listBidResponses, preSelectBidInvitationToken, selectBidInvitation } from '../../../../api/ipd/bid';
import type { BidInvitation, BidResponse } from '../../../../api/ipd/bid';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { ipdErrorText } from '../../_shared/ipd-error-text';
import {
  bidModeText,
  bidResponseStatusColor,
  bidResponseStatusText,
  bidStatusColor,
  bidStatusText,
  bidTimeText,
} from '../bid-display';

const route = useRoute();
const router = useRouter();
const auth = useIpdAuthStore();

const loading = ref(false);
const loadError = ref<unknown>(null);
const invitation = ref<BidInvitation | null>(null);
const responses = ref<BidResponse[]>([]);
const selectedResponseId = ref('');
const confirmBusy = ref(false);
const selectError = ref('');

const bidId = computed(() => {
  const raw = route.params.bidId;
  return (Array.isArray(raw) ? raw[0] : raw) ?? '';
});

const myId = computed(() => auth.identity?.person.id ?? '');
const isCreator = computed(() => !!invitation.value && !!myId.value && String(invitation.value.createBy ?? '') === myId.value);

const selected = computed(() => responses.value.find((row) => row.id === selectedResponseId.value) ?? null);

const responseColumns = computed(() => [
  { title: '研发PM', key: 'rdPm' },
  { title: '应标说明', key: 'note' },
  { title: '应标时间', key: 'respondedAt' },
  { title: '状态', key: 'status' },
  ...(invitation.value?.status === 'OPEN' ? [{ title: '选定为中标', key: 'choose' }] : []),
]);

/** Table bodyCell 的 record 不做类型收窄：统一在此收敛断言。 */
function asResponse(record: Record<string, any>): BidResponse {
  return record as BidResponse;
}

function rdPmLabel(record: BidResponse): string {
  return record.rdPmId ? `研发PM #${record.rdPmId}` : `应标记录 #${record.id}`;
}

function canChoose(record: BidResponse): boolean {
  return !confirmBusy.value && invitation.value?.status === 'OPEN' && record.status === 'PENDING';
}

function rowClassName(record: BidResponse): string {
  if (invitation.value?.selectedResponseId && record.id === invitation.value.selectedResponseId) return 'bg-green-50';
  return '';
}

function goBack(): void {
  router.push('/ipd/bids');
}

async function load(): Promise<void> {
  if (!bidId.value) return;
  loading.value = true;
  loadError.value = null;
  try {
    const [invitationData, responseData] = await Promise.all([
      getBidInvitation(bidId.value),
      listBidResponses(bidId.value),
    ]);
    invitation.value = invitationData;
    // 发起人视角返回全量应标（隐私过滤见 BidInvitationService#listResponses）。
    responses.value = responseData ?? [];
    selectedResponseId.value = '';
  } catch (cause) {
    loadError.value = cause;
  } finally {
    loading.value = false;
  }
}

async function doSelect(): Promise<void> {
  if (!selected.value || confirmBusy.value) return;
  confirmBusy.value = true;
  selectError.value = '';
  try {
    // P1-5.2 两阶段流：先预演拿 confirmToken（24h 过期），UI 已确认后再提交 select
    const tokenView = await preSelectBidInvitationToken(bidId.value);
    await selectBidInvitation(bidId.value, selected.value.id, tokenView.token);
    message.success('遴选完成，招标单已进入「已遴选」状态');
    await load();
  } catch (cause) {
    selectError.value = ipdErrorText(cause, { domain: 'bid',
      fallback: '遴选失败，请稍后重试',
      codeTexts: {
        30001: '仅招标发起人可执行遴选',
        50001: '应标记录不存在或不属于本招标单，请刷新后重试',
        50002: '招标单状态已变更，可能已完成遴选或已关闭，请刷新后查看',
        90001: '服务暂时不可用，请稍后重试',
      },
    });
  } finally {
    confirmBusy.value = false;
  }
}

onMounted(load);
</script>
