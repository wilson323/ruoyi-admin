<script setup lang="ts">
import type { Dayjs } from 'dayjs';

import type { PmDirectoryEntry } from '../../../../api/ipd/handover';
import type {
  Project,
  ProjectBaselineBody,
  ProjectCertListView,
  ProjectMemberView,
  ProjectStatus,
} from '../../../../api/ipd/project';

/**
 * 页10 项目详情-项目概览（卡 P0-10.10；后端 GET /projects/{id} 已交付）。
 *
 * 摘要（产品/模板/来源/补齐状态）+ 四立项基准值（修改需双签 BR-INC-04；DRAFT 期内可经
 * POST /{id}/baselines 直改）+ 差异化系数与定值理由（BR-INC-05）+ 项目状态流转
 * + G-02 删除申请入口。
 * R215 WP3.1 批次3 接线（ORPHAN-A2/A3，2026-09 后端已交付，G-04 头注漂移修正）：
 * - ORPHAN-A2 认证项 4 端点：清单 GET /{id}/cert-items + sync 同步 + 手工补充 + 状态流转；
 * - ORPHAN-A3：四基准 DRAFT 期直改、上市日期初次录入（POST /{id}/launch-date）、
 *   项目成员绑定与快照列表（GET/POST /{projectId}/members，P2-4.1）。
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  DescriptionsItem,
  Grid,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';
import dayjs from 'dayjs';

import { getPmDirectory } from '../../../../api/ipd/handover';
import {
  addProjectCertItem,
  bindProjectMember,
  changeProjectCertItemStatus,
  changeProjectStatus,
  getProject,
  listProjectCertItems,
  listProjectMembers,
  recordProjectLaunchDate,
  syncProjectCertItems,
  updateProjectBaselines,
} from '../../../../api/ipd/project';
import { useIpdAuthStore } from '../../../../store/ipd-auth';
import { PENDING_TEXT } from '../../_shared/format';
import { ipdErrorText, isTransportError } from '../../_shared/ipd-error-text';
import { IPD_PERMISSION_CODES } from '../../_shared/ipd-permission-codes';
import {
  catchupText,
  coefficientText,
  levelText,
  parseMarkets,
  projectDateTimeText,
  projectMoneyText,
  projectStatusColor,
  projectStatusText,
  sourceText,
  stageColor,
  stageText,
  templateText,
} from '../project-display';

const route = useRoute();
const router = useRouter();

const projectId = computed(() => String(route.params.projectId ?? ''));
const loading = ref(false);
const loadError = ref<unknown>(null);
const project = ref<null | Project>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    project.value = await getProject(projectId.value);
    // R215 WP3.1 批次3：认证清单 / 成员列表随概览并行加载（独立容错，互不阻塞）。
    void loadCert();
    void loadMembers();
  } catch (error) {
    project.value = null;
    loadError.value = error;
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/** 状态机合法后继（前端只提供入口，最终由服务端校验）。 */
const NEXT_STATUS: Record<string, { label: string; value: ProjectStatus }[]> = {
  ACTIVE: [
    { label: '暂停项目', value: 'SUSPENDED' },
    { label: '归档结项', value: 'ARCHIVED' },
  ],
  ARCHIVED: [],
  DRAFT: [{ label: '进入组队', value: 'TEAMING' }],
  SUSPENDED: [
    { label: '恢复进行', value: 'ACTIVE' },
    { label: '归档结项', value: 'ARCHIVED' },
  ],
  TEAMING: [{ label: '启动项目', value: 'ACTIVE' }],
};

const nextStatuses = computed(
  () => NEXT_STATUS[project.value?.status ?? ''] ?? [],
);
const transiting = ref('');

async function transit(target: ProjectStatus, label: string): Promise<void> {
  if (transiting.value) return;
  transiting.value = target;
  try {
    project.value = await changeProjectStatus(projectId.value, target);
    message.success(
      `项目已${label}（${projectStatusText(project.value.status)}）`,
    );
  } catch (error) {
    message.error(
      isTransportError(error)
        ? '无法连接服务，请检查网络后重试'
        : ipdErrorText(error, {
            domain: 'project',
            fallback: '状态流转失败，请稍后重试',
          }),
    );
  } finally {
    transiting.value = '';
  }
}

/** G-02：全站唯一删除入口收敛到删除申请页，带预填 query。 */
function gotoDeletion(): void {
  router
    .push({
      path: '/ipd/deletion/my-requests',
      query: { entityType: 'projects', entityId: projectId.value },
    })
    .catch((error: unknown) => {
      message.error(
        `导航失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

/**
 * 「目标市场」列跨度（响应式）：与 :column="{ xs: 1, sm: 2, lg: 3 }" 对齐。
 * antd 对「显式 span > 本行剩余列」会收缩该列并弹 Sum of column span 警告——
 * 目标市场前共 9 项，仅 lg（3 列）档恰好整行填满可独占整行；sm/md/xs 档收为 1 格。
 */
const screens = Grid.useBreakpoint();
const marketSpan = computed(() => (screens.value.lg ? 3 : 1));
const markets = computed(() =>
  parseMarkets(project.value?.targetMarkets ?? null),
);
/** 存量导入补齐提示（BR-PROD-03）。 */
const catchupBanner = computed(() => {
  if (
    project.value?.source !== 'LEGACY' ||
    project.value.catchupStatus !== 'IN_PROGRESS'
  )
    return '';
  return '该项目为存量导入，概念阶段起的缺失节点需逐一补齐；已标记「历史缺失」的动作自动豁免门禁。';
});

// ────────────── R215 WP3.1 批次3（ORPHAN-A2）：国别认证清单 ──────────────

const CERT_STATUS_OPTIONS = [
  { label: '待启动', value: 'PENDING' },
  { label: '进行中', value: 'IN_PROGRESS' },
  { label: '已完成', value: 'DONE' },
  { label: '不适用', value: 'NA' },
] as const;
const CERT_STATUS_TEXT: Record<string, string> = {
  DONE: '已完成',
  IN_PROGRESS: '进行中',
  NA: '不适用',
  PENDING: '待启动',
};
const CERT_STATUS_COLOR: Record<string, string> = {
  DONE: 'success',
  IN_PROGRESS: 'processing',
  NA: 'default',
  PENDING: 'warning',
};

const certLoading = ref(false);
const certError = ref<unknown>(null);
const certView = ref<null | ProjectCertListView>(null);

async function loadCert(): Promise<void> {
  certLoading.value = true;
  certError.value = null;
  try {
    certView.value = await listProjectCertItems(projectId.value);
  } catch (error) {
    certView.value = null;
    certError.value = error;
  } finally {
    certLoading.value = false;
  }
}

function certActionError(cause: unknown): void {
  message.error(
    isTransportError(cause)
      ? '无法连接服务，请检查网络后重试'
      : ipdErrorText(cause, {
          domain: 'project',
          fallback: '认证清单操作失败，请稍后重试',
        }),
  );
}

const certColumns = [
  { title: '国家/地区', key: 'country', width: 120 },
  { title: '认证名', dataIndex: 'certName', key: 'certName', width: 120 },
  { title: '认证机构', key: 'certAuthority', width: 130 },
  { title: '强制', key: 'isMandatory', width: 70 },
  { title: '来源', key: 'source', width: 80 },
  { title: '状态', key: 'status', width: 96 },
  { title: '状态流转', key: 'certAction', width: 132 },
];

/** 按当前目标市场同步模板项（只增不重置 DONE）。 */
const certSyncing = ref(false);
async function syncCert(): Promise<void> {
  if (certSyncing.value) return;
  certSyncing.value = true;
  try {
    const added = await syncProjectCertItems(projectId.value);
    message.success(
      added > 0
        ? `已按当前目标市场同步认证清单，新增 ${added} 项（DONE 项不重置）`
        : '认证清单已是最新（无新增项）',
    );
    await loadCert();
  } catch (error) {
    certActionError(error);
  } finally {
    certSyncing.value = false;
  }
}

/** 手工补充认证项（AC-PROD-12）。 */
const certAddOpen = ref(false);
const certAddSubmitting = ref(false);
const certForm = reactive({
  certAuthority: '',
  certName: '',
  countryCode: '',
  countryName: '',
  isMandatory: '1',
});

function openCertAdd(): void {
  certForm.certAuthority = '';
  certForm.certName = '';
  certForm.countryCode = '';
  certForm.countryName = '';
  certForm.isMandatory = '1';
  certAddOpen.value = true;
}

async function submitCertAdd(): Promise<void> {
  if (
    !certForm.countryCode.trim() ||
    !certForm.countryName.trim() ||
    !certForm.certName.trim()
  ) {
    message.warning('国家码、国别名、认证名均为必填');
    return;
  }
  certAddSubmitting.value = true;
  try {
    const item = await addProjectCertItem(projectId.value, {
      certAuthority: certForm.certAuthority.trim() || undefined,
      certName: certForm.certName.trim(),
      countryCode: certForm.countryCode.trim().toUpperCase(),
      countryName: certForm.countryName.trim(),
      isMandatory: certForm.isMandatory,
    });
    message.success(`已补充认证项：${item.countryCode} ${item.certName}`);
    certAddOpen.value = false;
    await loadCert();
  } catch (error) {
    certActionError(error);
  } finally {
    certAddSubmitting.value = false;
  }
}

/** 状态流转（PENDING→IN_PROGRESS→DONE / NA；DONE 后不被 sync 重置，@Version 乐观锁）。 */
const certStatusSaving = ref('');
async function changeCertStatus(itemId: string, target: string): Promise<void> {
  if (certStatusSaving.value) return;
  certStatusSaving.value = itemId;
  try {
    await changeProjectCertItemStatus(projectId.value, itemId, target);
    message.success(`认证项已流转为「${CERT_STATUS_TEXT[target] ?? target}」`);
    await loadCert();
  } catch (error) {
    certActionError(error);
    // 失败回滚下拉显示：重载清单恢复服务端真值。
    await loadCert();
  } finally {
    certStatusSaving.value = '';
  }
}

// ────────────── R215 WP3.1 批次3（ORPHAN-A3）：四基准 DRAFT 期直改 ──────────────

/** P1-2.2：仅 DRAFT 期内可直改；立项后锁定走双签（服务端最终权威）。 */
const canEditBaselines = computed(() => project.value?.status === 'DRAFT');
const baselineOpen = ref(false);
const baselineSaving = ref(false);
const baselineForm = reactive<ProjectBaselineBody>({
  targetChannelCount: 0,
  targetNps: 0,
  targetSalesAmount: 0,
  targetSceneCount: 0,
});

function openBaselines(): void {
  if (!project.value) return;
  // targetSalesAmount 后端为 BigDecimal 字符串，编辑期转数字。
  baselineForm.targetSalesAmount =
    Number(project.value.targetSalesAmount ?? 0) || 0;
  baselineForm.targetChannelCount = project.value.targetChannelCount ?? 0;
  baselineForm.targetNps = project.value.targetNps ?? 0;
  baselineForm.targetSceneCount = project.value.targetSceneCount ?? 0;
  baselineOpen.value = true;
}

async function submitBaselines(): Promise<void> {
  baselineSaving.value = true;
  try {
    project.value = await updateProjectBaselines(projectId.value, {
      ...baselineForm,
    });
    message.success('四基准已更新（DRAFT 期内可直改；立项后锁定走双签）');
    baselineOpen.value = false;
  } catch (error) {
    message.error(
      isTransportError(error)
        ? '无法连接服务，请检查网络后重试'
        : ipdErrorText(error, {
            domain: 'project',
            fallback: '基准更新失败，请稍后重试',
          }),
    );
  } finally {
    baselineSaving.value = false;
  }
}

// ────────────── R215 WP3.1 批次3（ORPHAN-A3）：上市日期初次录入 ──────────────

/** 后端 javadoc：仅 DRAFT|TEAMING|ACTIVE 可调（状态机无 CONFIRMED）；launch_date 已存在拒绝（走双签）。 */
const LAUNCH_RECORDABLE_STATUSES = new Set(['ACTIVE', 'DRAFT', 'TEAMING']);
const canRecordLaunchDate = computed(() =>
  Boolean(
    project.value &&
    !project.value.launchDate &&
    LAUNCH_RECORDABLE_STATUSES.has(project.value.status),
  ),
);

const launchOpen = ref(false);
const launchSaving = ref(false);
const launchDateModel = ref<Dayjs | undefined>(undefined);
const launchReason = ref('');

function openLaunchDate(): void {
  launchDateModel.value = undefined;
  launchReason.value = '';
  launchOpen.value = true;
}

async function submitLaunchDate(): Promise<void> {
  if (!launchDateModel.value || !dayjs.isDayjs(launchDateModel.value)) {
    message.warning('请选择上市日期');
    return;
  }
  const reason = launchReason.value.trim();
  if (!reason) {
    message.warning('录入理由必填（写入 INITIAL_LAUNCH_DATE 审计）');
    return;
  }
  launchSaving.value = true;
  try {
    project.value = await recordProjectLaunchDate(
      projectId.value,
      launchDateModel.value.format('YYYY-MM-DD'),
      reason,
    );
    message.success(
      '上市日期已初次录入；后续修改需走双签变更流程（AC-INC-33）',
    );
    launchOpen.value = false;
  } catch (error) {
    message.error(
      isTransportError(error)
        ? '无法连接服务，请检查网络后重试'
        : ipdErrorText(error, {
            domain: 'project',
            fallback: '上市日期录入失败，请稍后重试',
          }),
    );
  } finally {
    launchSaving.value = false;
  }
}

// ────────────── R215 WP3.1 批次3（ORPHAN-A3）：项目成员（P2-4.1 评级快照） ──────────────

const ROLE_TEXT: Record<string, string> = {
  MARKET_PM: '市场 PM',
  RD_PM: '研发 PM',
};
const memberLoading = ref(false);
const memberError = ref<unknown>(null);
const members = ref<ProjectMemberView[]>([]);

async function loadMembers(): Promise<void> {
  memberLoading.value = true;
  memberError.value = null;
  try {
    members.value = await listProjectMembers(projectId.value);
  } catch (error) {
    members.value = [];
    memberError.value = error;
  } finally {
    memberLoading.value = false;
  }
}

const memberColumns = [
  { title: '角色', key: 'role', width: 100 },
  { title: '人员 ID', dataIndex: 'personId', key: 'personId', width: 170 },
  { title: '锁定级别', key: 'lockedLevel', width: 96 },
  { title: '锁定津贴基准', key: 'lockedAmount', width: 120 },
  { title: '加入日期', dataIndex: 'joinDate', key: 'joinDate', width: 110 },
  { title: '超额备案编号', key: 'approvalRef', width: 130 },
  { title: '奖金资格', key: 'bonusEligible', width: 88 },
];

/** 绑定发起口径（requireProjectCreator）：市场 PM / 组长 / 超管（页08 研发 PM 不可发起）。 */
const auth = useIpdAuthStore();
const canBindMember = computed(() =>
  ['GROUP_LEADER', 'MARKET_PM', 'SUPER_ADMIN'].includes(
    auth.identity?.person.personType ?? '',
  ),
);

const bindOpen = ref(false);
const bindSubmitting = ref(false);
const personOptions = ref<PmDirectoryEntry[]>([]);
const personLoading = ref(false);
const bindForm = reactive({ approvalRef: '', personId: '' });

/** 仅市场/研发 PM 可被绑定（AC-TEAM-10：role 与人员 personType 强一致）。 */
const bindablePersons = computed(() =>
  personOptions.value.filter(
    (entry) => entry.personType === 'MARKET_PM' || entry.personType === 'RD_PM',
  ),
);
const bindPersonOptions = computed(() =>
  bindablePersons.value.map((entry) => ({
    label: `${entry.name}（${entry.employeeNo ?? '无工号'} · ${ROLE_TEXT[entry.personType] ?? entry.personType}）`,
    value: entry.id,
  })),
);
const selectedPerson = computed(
  () =>
    bindablePersons.value.find((entry) => entry.id === bindForm.personId) ??
    null,
);

async function openBind(): Promise<void> {
  bindForm.approvalRef = '';
  bindForm.personId = '';
  bindOpen.value = true;
  if (personOptions.value.length === 0) {
    personLoading.value = true;
    try {
      const directory = await getPmDirectory();
      personOptions.value = directory.directory ?? [];
    } catch {
      personOptions.value = [];
      message.error('人员目录加载失败，请稍后重试');
    } finally {
      personLoading.value = false;
    }
  }
}

async function submitBind(): Promise<void> {
  if (!selectedPerson.value) {
    message.warning('请选择人员（仅市场 PM / 研发 PM 可绑定，AC-TEAM-10）');
    return;
  }
  bindSubmitting.value = true;
  try {
    // role 由所选人员 personType 决定（服务端 AC-TEAM-10 强校验，前端不提供第二个入口）。
    const member = await bindProjectMember(projectId.value, {
      approvalRef: bindForm.approvalRef.trim() || undefined,
      personId: bindForm.personId,
      role: selectedPerson.value.personType,
    });
    message.success(
      `已绑定${ROLE_TEXT[member.role] ?? member.role}（评级快照与津贴基准已锁定）`,
    );
    bindOpen.value = false;
    await loadMembers();
  } catch (error) {
    message.error(
      isTransportError(error)
        ? '无法连接服务，请检查网络后重试'
        : ipdErrorText(error, {
            domain: 'project',
            fallback: '成员绑定失败，请稍后重试',
          }),
    );
  } finally {
    bindSubmitting.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Card v-if="loading" class="text-center">
      <Spin>正在加载项目概览……</Spin>
    </Card>

    <Alert
      v-else-if="loadError"
      :message="
        isTransportError(loadError)
          ? '无法连接服务，请检查网络后重试'
          : ipdErrorText(loadError, {
              domain: 'project',
              fallback: '项目概览加载失败，请稍后重试',
            })
      "
      show-icon
      type="error"
    >
      <template #description>
        <Button size="small" @click="load">重新加载</Button>
      </template>
    </Alert>

    <template v-else-if="project">
      <Alert
        v-if="catchupBanner"
        :message="catchupBanner"
        show-icon
        type="warning"
      />

      <Card title="项目摘要">
        <Descriptions bordered :column="{ xs: 1, sm: 2, lg: 3 }" size="small">
          <DescriptionsItem label="项目编码">
            {{ project.code || PENDING_TEXT }}
          </DescriptionsItem>
          <DescriptionsItem label="产品 ID">
            {{ project.productId || PENDING_TEXT }}
          </DescriptionsItem>
          <DescriptionsItem label="模板类型">
            {{ templateText(project.templateType) }}
          </DescriptionsItem>
          <DescriptionsItem label="立项级别">
            {{ levelText(project.level) }}
          </DescriptionsItem>
          <DescriptionsItem label="当前阶段">
            <Tag :color="stageColor(project.currentStage)">
              {{ stageText(project.currentStage) }}
            </Tag>
          </DescriptionsItem>
          <DescriptionsItem label="项目状态">
            <Tag :color="projectStatusColor(project.status)">
              {{ projectStatusText(project.status) }}
            </Tag>
          </DescriptionsItem>
          <DescriptionsItem label="来源">
            {{ sourceText(project.source) }}
          </DescriptionsItem>
          <DescriptionsItem label="补齐状态">
            {{ catchupText(project.catchupStatus) }}
          </DescriptionsItem>
          <DescriptionsItem label="主组 ID">
            {{ project.mainGroupId || PENDING_TEXT }}
          </DescriptionsItem>
          <DescriptionsItem label="目标市场" :span="marketSpan">
            <Space v-if="markets.length > 0" wrap>
              <Tag v-for="market in markets" :key="market" color="blue">
                {{ market }}
              </Tag>
            </Space>
            <span v-else>{{ PENDING_TEXT }}</span>
          </DescriptionsItem>
          <DescriptionsItem label="上市日期（修改需双签）">
            {{
              project.launchDate
                ? projectDateTimeText(project.launchDate)
                : PENDING_TEXT
            }}
          </DescriptionsItem>
          <DescriptionsItem label="差异化系数（BR-INC-05）">
            {{ coefficientText(project.levelCoefficient) }}
          </DescriptionsItem>
          <!-- 末项不写 span：antd getFilledItem 对「span=undefined」自动补满本行剩余列且不弹警告；
               显式 span 超限才会被收缩并弹 Sum of column span 警告。 -->
          <DescriptionsItem label="系数定值理由（S/B 必填）">
            {{ project.levelCoefficientReason || PENDING_TEXT }}
          </DescriptionsItem>
        </Descriptions>
      </Card>

      <Card title="立项基准（修改需双签）">
        <template #extra>
          <!-- R215 WP3.1 批次3（ORPHAN-A3）：DRAFT 期内直改四基准（P1-2.2）；立项后锁定走双签。 -->
          <Button
            v-if="canEditBaselines"
            v-access:code="IPD_PERMISSION_CODES.PROJECT_STATUS_CHANGE"
            size="small"
            @click="openBaselines"
          >
            DRAFT 期内修改基准
          </Button>
          <span v-else class="text-muted-foreground text-xs"
            >立项后锁定（双签变更）</span
          >
        </template>
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div class="rounded border p-4">
            <div class="text-muted-foreground text-xs">
              立项目标销售额（元）
            </div>
            <div class="mt-1 text-lg font-semibold tabular-nums">
              {{ projectMoneyText(project.targetSalesAmount) }}
            </div>
          </div>
          <div class="rounded border p-4">
            <div class="text-muted-foreground text-xs">立项目标渠道商数</div>
            <div class="mt-1 text-lg font-semibold tabular-nums">
              {{ project.targetChannelCount ?? PENDING_TEXT }}
            </div>
          </div>
          <div class="rounded border p-4">
            <div class="text-muted-foreground text-xs">立项 NPS（0-100）</div>
            <div class="mt-1 text-lg font-semibold tabular-nums">
              {{ project.targetNps ?? PENDING_TEXT }}
            </div>
          </div>
          <div class="rounded border p-4">
            <div class="text-muted-foreground text-xs">立项目标场景数</div>
            <div class="mt-1 text-lg font-semibold tabular-nums">
              {{ project.targetSceneCount ?? PENDING_TEXT }}
            </div>
          </div>
        </div>
      </Card>

      <Card title="项目治理">
        <Space wrap>
          <Button
            v-for="next in nextStatuses"
            :key="next.value"
            :loading="transiting === next.value"
            :danger="next.value === 'ARCHIVED'"
            @click="transit(next.value, next.label)"
          >
            {{ next.label }}
          </Button>
          <span
            v-if="nextStatuses.length === 0"
            class="text-muted-foreground text-sm"
          >
            当前状态无可用流转（已归档或状态锁定）
          </span>
          <Button danger type="primary" @click="gotoDeletion">
            发起删除申请
          </Button>
          <!-- R215 WP3.1 批次3（ORPHAN-A3）：L08 上市日期初次录入（已存在则走双签，不显示本按钮）。 -->
          <Button
            v-if="canRecordLaunchDate"
            v-access:code="IPD_PERMISSION_CODES.PROJECT_STATUS_CHANGE"
            @click="openLaunchDate"
          >
            初次录入上市日期
          </Button>
        </Space>
        <div class="text-muted-foreground mt-2 text-xs">
          状态流转与删除均由服务端最终权限校验；删除走两级审核（组长初审 →
          超管终审），不做即时删除（G-02）。
        </div>
      </Card>

      <!-- R215 WP3.1 批次3（ORPHAN-A2）：国别认证清单（GET/POST /{id}/cert-items 全组接线）。 -->
      <Card title="国别认证清单（P1-7.1）">
        <template #extra>
          <Space>
            <Button
              v-access:code="IPD_PERMISSION_CODES.PROJECT_STATUS_CHANGE"
              size="small"
              :loading="certSyncing"
              @click="syncCert"
            >
              按目标市场同步
            </Button>
            <Button
              v-access:code="IPD_PERMISSION_CODES.PROJECT_STATUS_CHANGE"
              size="small"
              @click="openCertAdd"
            >
              手工补充认证项
            </Button>
          </Space>
        </template>

        <Alert
          v-if="certView && certView.unknownMarkets.length > 0"
          class="mb-3"
          :message="`目标市场 ${certView.unknownMarkets.join('、')} 无对应认证模板，请手工补充认证项或修正目标市场`"
          show-icon
          type="warning"
        />
        <Alert
          v-if="certError"
          class="mb-3"
          :message="
            isTransportError(certError)
              ? '无法连接服务，请检查网络后重试'
              : ipdErrorText(certError, {
                  domain: 'project',
                  fallback: '认证清单加载失败，请稍后重试',
                })
          "
          show-icon
          type="error"
        >
          <template #description>
            <Button size="small" @click="loadCert">重新加载</Button>
          </template>
        </Alert>

        <Table
          v-else
          :loading="certLoading"
          :columns="certColumns"
          :data-source="certView?.items ?? []"
          :row-key="(record: Record<string, any>) => String(record.id ?? '')"
          :pagination="{
            pageSize: 10,
            showTotal: (total: number) => `共 ${total} 项`,
            showSizeChanger: false,
          }"
          size="small"
          bordered
        >
          <template
            #bodyCell="{
              column,
              record,
            }: {
              column: Record<string, any>;
              record: Record<string, any>;
            }"
          >
            <template v-if="column.key === 'country'">
              <span
                >{{ record.countryName || PENDING_TEXT }}（{{
                  record.countryCode || '-'
                }}）</span
              >
            </template>
            <template v-else-if="column.key === 'certAuthority'">
              <span>{{ record.certAuthority || PENDING_TEXT }}</span>
            </template>
            <template v-else-if="column.key === 'isMandatory'">
              <Tag :color="record.isMandatory === '1' ? 'red' : 'default'">
                {{ record.isMandatory === '1' ? '强制' : '可选' }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'source'">
              <Tag :color="record.source === 'AUTO' ? 'blue' : 'purple'">
                {{ record.source === 'AUTO' ? '模板' : '手工' }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'status'">
              <Tag
                :color="CERT_STATUS_COLOR[record.status as string] ?? 'default'"
              >
                {{ CERT_STATUS_TEXT[record.status as string] ?? record.status }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'certAction'">
              <!-- 状态流转（DONE 不被 sync 重置；服务端 @Version 乐观锁 + 权限校验最终权威）。 -->
              <Select
                :value="record.status"
                :options="[...CERT_STATUS_OPTIONS]"
                size="small"
                class="!w-28"
                :disabled="certStatusSaving === String(record.id)"
                @change="
                  (value: unknown) =>
                    changeCertStatus(String(record.id), String(value))
                "
              />
            </template>
          </template>
          <template #emptyText>
            <span
              >暂无认证项；点击右上「按目标市场同步」带出模板项，或手工补充</span
            >
          </template>
        </Table>
        <div v-if="certView" class="text-muted-foreground mt-2 text-xs">
          模板版本
          {{
            certView.catalogVersion ?? PENDING_TEXT
          }}；同步只增不重置已完成项，DONE 后状态保留。
        </div>
      </Card>

      <!-- R215 WP3.1 批次3（ORPHAN-A3）：项目成员（GET/POST /{projectId}/members，P2-4.1 评级快照）。 -->
      <Card title="项目成员（P2-4.1 评级快照）">
        <template #extra>
          <Button v-if="canBindMember" size="small" @click="openBind">
            绑定成员
          </Button>
          <span v-else class="text-muted-foreground text-xs"
            >绑定发起：市场 PM / 组长 / 超管</span
          >
        </template>

        <Alert
          v-if="memberError"
          class="mb-3"
          :message="
            isTransportError(memberError)
              ? '无法连接服务，请检查网络后重试'
              : ipdErrorText(memberError, {
                  domain: 'project',
                  fallback: '成员列表加载失败，请稍后重试',
                })
          "
          show-icon
          type="error"
        >
          <template #description>
            <Button size="small" @click="loadMembers">重新加载</Button>
          </template>
        </Alert>

        <Table
          v-else
          :loading="memberLoading"
          :columns="memberColumns"
          :data-source="members"
          :row-key="(record: Record<string, any>) => String(record.id ?? '')"
          :pagination="{
            pageSize: 10,
            showTotal: (total: number) => `共 ${total} 人`,
            showSizeChanger: false,
          }"
          size="small"
          bordered
        >
          <template
            #bodyCell="{
              column,
              record,
            }: {
              column: Record<string, any>;
              record: Record<string, any>;
            }"
          >
            <template v-if="column.key === 'role'">
              <Tag :color="record.role === 'MARKET_PM' ? 'blue' : 'green'">
                {{ ROLE_TEXT[record.role as string] ?? record.role }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'lockedLevel'">
              <span>{{ record.lockedLevel || PENDING_TEXT }}</span>
            </template>
            <template v-else-if="column.key === 'lockedAmount'">
              <span>{{ record.lockedAmount ?? PENDING_TEXT }}</span>
            </template>
            <template v-else-if="column.key === 'approvalRef'">
              <span>{{ record.approvalRef || '—' }}</span>
            </template>
            <template v-else-if="column.key === 'bonusEligible'">
              <span>{{
                record.bonusEligible === '1'
                  ? '是'
                  : record.bonusEligible === '0'
                    ? '否'
                    : PENDING_TEXT
              }}</span>
            </template>
          </template>
          <template #emptyText>
            <span
              >暂无成员；点击右上「绑定成员」录入（绑定即锁定评级快照与津贴基准）</span
            >
          </template>
        </Table>
        <div class="text-muted-foreground mt-2 text-xs">
          绑定即按人员当日评级锁定级别与津贴基准（快照不再随人员评级浮动）；角色与人员类型强一致（AC-TEAM-10），
          绑第阈值个项目须填超额备案编号（AC-TEAM-11，服务端强制）。
        </div>
      </Card>

      <!-- 手工补充认证项 Modal（AC-PROD-12）。 -->
      <Modal
        v-model:open="certAddOpen"
        title="手工补充认证项"
        :confirm-loading="certAddSubmitting"
        ok-text="确认补充"
        cancel-text="取消"
        :mask-closable="false"
        @ok="submitCertAdd"
      >
        <div class="mb-3 text-xs text-gray-500">
          手工项不受模板同步影响（source=MANUAL）；国家码建议两位字母（如 DE /
          SA）。
        </div>
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-right text-sm">国家码 *</span>
            <Input
              v-model:value="certForm.countryCode"
              placeholder="DE"
              class="!w-32"
              :maxlength="8"
            />
            <span class="w-20 shrink-0 text-right text-sm">国别名 *</span>
            <Input
              v-model:value="certForm.countryName"
              placeholder="德国"
              class="flex-1"
              :maxlength="60"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-right text-sm">认证名 *</span>
            <Input
              v-model:value="certForm.certName"
              placeholder="CE"
              class="flex-1"
              :maxlength="120"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-right text-sm">认证机构</span>
            <Input
              v-model:value="certForm.certAuthority"
              placeholder="TÜV / 深圳计量院（可空）"
              class="flex-1"
              :maxlength="120"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-right text-sm">是否强制</span>
            <Select
              v-model:value="certForm.isMandatory"
              class="!w-32"
              :options="[
                { label: '强制', value: '1' },
                { label: '可选', value: '0' },
              ]"
            />
          </div>
        </div>
      </Modal>

      <!-- DRAFT 期四基准直改 Modal（P1-2.2 / ORPHAN-A3）。 -->
      <Modal
        v-model:open="baselineOpen"
        title="修改四项立项基准（仅 DRAFT 期）"
        :confirm-loading="baselineSaving"
        ok-text="确认修改"
        cancel-text="取消"
        :mask-closable="false"
        @ok="submitBaselines"
      >
        <div class="mb-3 text-xs text-gray-500">
          P1-2.2：DRAFT
          期内可直改；进入组队/启动后锁定，修改需走双签变更（BR-INC-04）。
        </div>
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <span class="w-36 shrink-0 text-right text-sm"
              >立项目标销售额（元）</span
            >
            <InputNumber
              v-model:value="baselineForm.targetSalesAmount"
              :min="1"
              :step="10000"
              class="flex-1"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-36 shrink-0 text-right text-sm"
              >立项目标渠道商数</span
            >
            <InputNumber
              v-model:value="baselineForm.targetChannelCount"
              :min="1"
              class="flex-1"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-36 shrink-0 text-right text-sm"
              >立项 NPS（0-100）</span
            >
            <InputNumber
              v-model:value="baselineForm.targetNps"
              :min="0"
              :max="100"
              class="flex-1"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-36 shrink-0 text-right text-sm">立项目标场景数</span>
            <InputNumber
              v-model:value="baselineForm.targetSceneCount"
              :min="1"
              class="flex-1"
            />
          </div>
        </div>
      </Modal>

      <!-- 上市日期初次录入 Modal（L08 / ORPHAN-A3）。 -->
      <Modal
        v-model:open="launchOpen"
        title="初次录入上市日期（L08）"
        :confirm-loading="launchSaving"
        ok-text="确认录入"
        cancel-text="取消"
        :mask-closable="false"
        @ok="submitLaunchDate"
      >
        <div class="mb-3 text-xs text-gray-500">
          仅可初次录入；已有上市日期的项目修改需走双签变更流程（AC-INC-33）。理由写入
          INITIAL_LAUNCH_DATE 审计。
        </div>
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <span class="w-24 shrink-0 text-right text-sm">上市日期 *</span>
            <DatePicker v-model:value="launchDateModel" class="!w-56" />
          </div>
          <div class="flex items-start gap-2">
            <span class="w-24 shrink-0 text-right text-sm leading-6"
              >录入理由 *</span
            >
            <Input.TextArea
              v-model:value="launchReason"
              class="flex-1"
              placeholder="如：渠道备货排期确认（必填，≤500 字，写入审计）"
              :auto-size="{ minRows: 2, maxRows: 4 }"
              :maxlength="500"
              show-count
            />
          </div>
        </div>
      </Modal>

      <!-- 绑定成员 Modal（P2-4.1 / ORPHAN-A3）。 -->
      <Modal
        v-model:open="bindOpen"
        title="绑定项目成员"
        :confirm-loading="bindSubmitting"
        ok-text="确认绑定"
        cancel-text="取消"
        :mask-closable="false"
        @ok="submitBind"
      >
        <div class="mb-3 text-xs text-gray-500">
          角色由人员类型自动判定（市场 PM / 研发
          PM，AC-TEAM-10）；绑定即锁定评级快照与津贴基准；
          绑第阈值个项目须填超额备案编号（AC-TEAM-11，服务端强制校验）。
        </div>
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-right text-sm">人员 *</span>
            <Select
              v-model:value="bindForm.personId"
              class="flex-1"
              :options="bindPersonOptions"
              :loading="personLoading"
              placeholder="选择市场 PM / 研发 PM"
              show-search
              option-filter-prop="label"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-right text-sm">绑定角色</span>
            <Select
              class="flex-1"
              :value="selectedPerson?.personType ?? undefined"
              :options="[
                { label: '自动随人员类型（AC-TEAM-10）', value: 'AUTO' },
              ]"
              disabled
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="w-20 shrink-0 text-right text-sm">超额备案编号</span>
            <Input
              v-model:value="bindForm.approvalRef"
              class="flex-1"
              placeholder="绑第阈值个项目时必填（评级委员会备案编号）"
              :maxlength="64"
            />
          </div>
        </div>
      </Modal>
    </template>
  </div>
</template>
