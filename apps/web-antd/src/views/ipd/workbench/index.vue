<script setup lang="ts">
/**
 * 页03 工作台（后端聚合 WorkbenchController GET /api/v1/workbench/summary，2026-09-06 接入真实数据）。
 *
 * 真值源：ZK-IPD LIVE URL http://127.0.0.1:4173/workspace（2026-09-06 chrome-devtools 实地抓取）。
 * 形态：身份问候（按时辰）+ 4 metric 卡 + 责任任务队列 + 我的当前推进 + 删除审批数 + 无实质产出提醒。
 * 无实质产出名单依赖绩效域月度资格规则（P1 substantive-output），后端未交付，仅如实提示不渲染名单。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { Alert, Tag } from 'ant-design-vue';

import type { Product } from '../../../api/ipd/product';
import { listProducts } from '../../../api/ipd/product';
import {
  fetchMyInitiated,
  fetchMyPendingApprovals,
  fetchWorkbenchSummary,
  fetchWorkbenchTasks,
} from '../../../api/ipd/workbench';
import type {
  MyInitiatedTaskView,
  WorkbenchSummary,
  WorkbenchTask,
  WorkbenchTaskBucket,
} from '../../../api/ipd/workbench';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import AiSuggest from '../_shared/ai-suggest.vue';
import AiTaskTodoDrawer from '../_shared/ai-tasks/ai-task-todo-drawer.vue';
import '../_shared/ipd-theme.css';
import { RULES_BY_PAGE, renderRulesDescription } from '../_shared/zk-ipd-rules';
import {
  DECISION_BUCKET_ACTION,
  DECISION_BUCKET_TEXT,
  WORKBENCH_TASK_STATUS_TEXT,
  WORKBENCH_TASK_TYPE_TEXT,
  decisionBucket,
  roleText,
  taskTypeText,
} from '../_shared/ipd-enums';
import type { WorkbenchDecisionBucket } from '../_shared/ipd-enums';
import type { SpaceScope } from './space-context';
import SpaceProgress from './space-progress.vue';
import TodoQuickEntry from './todo-quick-entry.vue';

const auth = useIpdAuthStore();
const workbenchRules = computed(() => renderRulesDescription(RULES_BY_PAGE.workbench));

/** R232 P2-04：站内待办抽屉开关（NotificationService 载荷 → 待办直达 AI 审批卡）。 */
const todoDrawerOpen = ref(false);

/** ZK-IPD 设计稿：按当前小时生成时辰问候（24h 制）。 */
const greeting = computed(() => {
  const name = auth.identity?.person.name ?? '同事';
  const hour = new Date().getHours();
  const timeText =
    hour < 5
      ? '夜深了'
      : hour < 11
        ? '早上好'
        : hour < 13
          ? '中午好'
          : hour < 18
            ? '下午好'
            : hour < 23
              ? '晚上好'
              : '夜深了';
  return `${timeText}，${name}`;
});

/** 聚合数据（真实接口，无 mock）。 */
const summary = ref<null | WorkbenchSummary>(null);
const loadError = ref('');

interface MetricCard {
  label: string;
  note: string;
  value: number | string;
  tone: 'default' | 'danger' | 'warning' | 'primary';
}
/** 4 metric：stats.pending / stats.overdue / unread / completed。 */
const metrics = computed<MetricCard[]>(() => {
  const s = summary.value?.stats;
  return [
    { label: '待我处理', note: '按责任链实时投递', value: s ? s.pending : '—', tone: 'default' },
    { label: '临期 / 超期', note: '优先处理阻断项', value: s ? s.overdue : '—', tone: 'danger' },
    { label: '未读通知', note: '站内提醒不依赖企微', value: s ? s.unread : '—', tone: 'warning' },
    { label: '已完成', note: '全过程可追溯', value: s ? s.completed : '—', tone: 'primary' },
  ];
});

const activeTab = ref<'completed' | 'followed' | 'initiated' | 'overdue' | 'pending'>('pending');

/** LIVE 工作台责任队列筛选 tab（计数来自真实聚合）。
 *  「我发起的」「我的关注」：后端 /workbench/summary（WorkbenchService#summary）
 *  仅交付 stats.pending/overdue/unread/completed，无对应聚合字段；
 *  计数置 null 隐藏徽标，不展示未核实的 0（禁止造假数据）。 */
interface QueueTab {
  key: 'completed' | 'followed' | 'initiated' | 'overdue' | 'pending';
  label: string;
  count: null | number;
}
const queueTabs = computed<QueueTab[]>(() => {
  const s = summary.value?.stats;
  return [
    { key: 'pending', label: '待我处理', count: s ? s.pending : 0 },
    // P1-4 + R215 A10: 「我发起的」优先用 my-initiated 端点明细数（权威）；
    // 端点未返回前回退 stats.myInitiated（后端三表 create_by=当前人计数，旧后端缺键时 ?? 0）
    {
      key: 'initiated',
      label: '我发起的',
      count: myInitiatedLoaded.value ? myInitiatedTasks.value.length : (s ? (s.myInitiated ?? 0) : 0),
    },
    { key: 'overdue', label: '临期/超期', count: s ? s.overdue : 0 },
    { key: 'completed', label: '已完成', count: s ? s.completed : 0 },
    // P1-4: 「我的关注」无关注数据模型（用户拍板：先不做），保持 null 隐藏徽标
    { key: 'followed', label: '我的关注', count: null },
  ];
});

/* ---------- 面板文案：只陈述后端真交付到的程度，不与徽标互相否认 ----------
 * 「已完成」徽标数是真的（/summary stats.completed），但 /workbench/tasks 对 bucket=completed
 * 显式 400（WorkbenchService.tasks：「无卡级数据源契约：completed 仅有计数」）——面板必须说明
 * 只有计数、没有逐条明细，不得回答「当前没有待处理事项」（那是另一件事，且与徽标打架）。
 * 「我的关注」更彻底：前端源码（apps/ 各子包的 src）无收藏入口，后端无收藏实体/聚合器
 * （saved_items 全仓仅见 2026-09-25 建表草稿，该草稿自注真库无此表；本行未对真库实测），
 * 原文案「在动作工作区点击收藏后…」属指令型假信息——用户会去找一个不存在的按钮。 */
const NON_QUEUE_TAB_NOTICE: Record<'completed' | 'followed', string> = {
  completed:
    '已完成仅提供计数（见上方徽标，聚合接口 stats.completed）；逐条完成明细后端未交付，此处不列出具体单据，也不做假数据。',
  followed:
    '我的关注后端未交付（无业务对象收藏数据模型，也未提供收藏入口）；此处不展示收藏列表，也不做假数据。',
};

/** 只有「已完成」「我的关注」两个 tab 停在提示上。
 *  「我发起的」走 /workbench/my-initiated 真明细（既有渲染路径），不属本提示覆盖范围。
 *  模板 v-else-if 直接用本判断，条件只此一处，避免两处各写一遍又漂移。 */
const showsNonQueueNotice = computed(
  () => activeTab.value === 'completed' || activeTab.value === 'followed',
);

const nonQueueNotice = computed(() => {
  const tab = activeTab.value;
  if (tab === 'completed') return NON_QUEUE_TAB_NOTICE.completed;
  if (tab === 'followed') return NON_QUEUE_TAB_NOTICE.followed;
  return '';
});

/** 队列卡空态文案。必须按 tab 区分：
 *  - 「我发起的」用「暂无责任任务」是套错口径，且未拉到数据时不得渲染成「没有」；
 *  - 其余 tab 保留责任任务口径，并限定在已接入聚合器的类型内。 */
const queueEmptyNotice = computed(() => {
  if (activeTab.value !== 'initiated') {
    return '暂无责任任务；已接入聚合器的任务到达会按责任链实时投递到这里。';
  }
  if (!myInitiatedLoaded.value) {
    return myInitiatedError.value
      ? '我发起的明细加载失败（/workbench/my-initiated）；此处不显示 0，也不做假数据。'
      : '我发起的明细加载中…';
  }
  return '暂无我发起的单据。';
});

/* ---------- 跨角色接力链路的真实覆盖范围 ----------
 * 真值源：docs/ipd-系统说明/workbench-tasktype-契约登记.yaml（后端仓）
 * 「已实现 9 类 / 未实现 7 类（PLANNED）」+ WorkbenchService.ALL_TASK_TYPES 现役 16 类。
 * 下列 7 类契约已登记但无聚合器（无生产者）→ 状态变化后下游无人接手，
 * 原「每次状态变化会同时完成当前任务、投递下一责任人…」对这几类是空头承诺。 */
const UNWIRED_TASK_TYPES = [
  'capacity_approval',
  'change_implementation',
  'change_verify',
  'rd_replacement',
  'receipt_review',
  'retirement_review',
  'waiver_review',
] as const;

const handoffScopeNotice = computed(() => {
  const names = UNWIRED_TASK_TYPES.map((k) => WORKBENCH_TASK_TYPE_TEXT[k]).join('、');
  return `状态变化会完成当前任务、投递下一责任人、生成通知并写入审计——仅限已接入聚合器的任务类型；${names}共 ${UNWIRED_TASK_TYPES.length} 类聚合器未交付，状态变化后不会自动投递待办。`;
});

/** 待办与超期按三类决定分组；我发起的仍是单组。项目名留在每条卡片上。 */
interface TaskGroup {
  projectName: string;
  count: number;
  items: {
    kind: string;
    title: string;
    desc: string;
    code: string;
    initiator: string;
    time: string;
    overdue: boolean;
    deepLink: string;
    actionLabel: string;
    projectName: string;
  }[];
}

const STATUS_TEXT: Record<string, string> = WORKBENCH_TASK_STATUS_TEXT;

/** R215 A10：my-initiated / my-pending-approvals 聚合卡（三单据+阶段动作统一视图）。 */
const myInitiatedTasks = ref<MyInitiatedTaskView[]>([]);
const myInitiatedLoaded = ref(false);
/** my-initiated 拉取失败标记：区分「确实没有」与「没拉到」——失败不得渲染成 0/空。
 *  徽标在未加载时回退 stats.myInitiated，故失败态必须显式说出来，否则与徽标打架。 */
const myInitiatedError = ref(false);
const myPendingApprovals = ref<MyInitiatedTaskView[]>([]);

// 后端 WorkbenchService 常量值为短形式（TASK_TYPE_DELETION_REQUEST = "DELETION" 等，实测 16039 响应）；
// 常量名/javadoc 的长形式是命名误导，以此处短形式为准。
// 2026-10-03 拆除：系数变更单已随业绩窗口域下线，后端 myInitiated() 现只聚合删除 + 上市日期两表
// （WorkbenchService.TASK_TYPE_* 已无 COEFFICIENT 常量），故移除 COEFFICIENT 标签键。
const MY_INITIATED_SOURCE_TEXT: Record<string, string> = {
  DELETION: '删除申请',
  LAUNCH_DATE: '上市日期变更',
  STAGE_ACTION: '阶段动作',
};

/** 待我审批摘要（治理卡用，最多列 3 条）。 */
const pendingApprovalsDigest = computed(() => {
  const list = myPendingApprovals.value;
  if (list.length === 0) return '';
  const head = list.slice(0, 3).map((t) => t.title ?? `#${t.id}`).join('；');
  return list.length > 3 ? `${head} 等 ${list.length} 项` : head;
});

function formatDue(iso: null | number | string | undefined): string {
  if (!iso) return '无截止';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd} 截止`;
}

/** 仅日期（MM/DD）。用于「我发起的」的 createdAt：那是发起时间，
 *  不是期限——套 formatDue 会把它渲染成「09/20 截止」，凭空造出一个不存在的截止日。 */
function formatDateOnly(iso: null | number | string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

/** WB-17-1 S0：任务队列过滤视图（GET /workbench/tasks?bucket=pending|overdue）。
 *  端点失败/旧后端缺路由时回退 /summary tasks 平铺（overdue 仍走 priority=high 旧口径），不造假数据。 */
const queueTasks = ref<WorkbenchTask[]>([]);
const queueFromTasks = ref(false);

async function loadQueueTasks(bucket: WorkbenchTaskBucket): Promise<void> {
  try {
    const page = await fetchWorkbenchTasks({ bucket });
    queueTasks.value = page.tasks ?? [];
    queueFromTasks.value = true;
  } catch {
    queueTasks.value = [];
    queueFromTasks.value = false;
  }
}

const taskGroups = computed<TaskGroup[]>(() => {
  // R215 A10：「我发起的」tab 用 my-initiated 端点真数据（不再复用 stage_action 队列）
  if (activeTab.value === 'initiated') {
    const items = myInitiatedTasks.value.map((t) => ({
      kind: STATUS_TEXT[t.status] ?? t.status,
      title: t.title ?? `单据 #${t.id}`,
      // D6（2026-10-06）：sourceTable 是库表名，不进用户可见文案。
      desc: MY_INITIATED_SOURCE_TEXT[t.taskType] ?? t.taskType,
      code: '',
      initiator: '',
      time: t.createdAt ? `发起 ${formatDateOnly(t.createdAt)}` : '—',
      overdue: false,
      deepLink: '',
      actionLabel: '',
      projectName: '',
    }));
    return items.length > 0 ? [{ projectName: '我发起的', count: items.length, items }] : [];
  }
  // WB-17-1 S0：优先消费 GET /workbench/tasks（bucket 已由后端过滤）；失败回退 summary.tasks
  const tasks = queueFromTasks.value ? queueTasks.value : (summary.value?.tasks ?? []);
  const visible = activeTab.value === 'overdue' && !queueFromTasks.value
    ? tasks.filter((t) => t.priority === 'high')
    : tasks;
  const order: WorkbenchDecisionBucket[] = ['review', 'fact', 'blocked'];
  const byBucket = new Map<WorkbenchDecisionBucket, WorkbenchTask[]>(
    order.map((key) => [key, []]),
  );
  for (const t of visible) {
    byBucket.get(decisionBucket(t.taskType, t.isBlocking))!.push(t);
  }
  return order.map((key) => {
    const items = byBucket.get(key) ?? [];
    return {
      projectName: DECISION_BUCKET_TEXT[key],
      count: items.length,
      items: items.map((t) => ({
        kind: STATUS_TEXT[t.status] ?? t.status,
        title: t.title ?? t.actionCode ?? '阶段动作',
        // D6（2026-10-06）：ownerRole 裸码改中文名（BOTH 不再裸显）。
        desc: `${taskTypeText(t.taskType)}${t.ownerRole ? ` · 责任角色 ${roleText(t.ownerRole)}` : ''} · ${t.isBlocking === '1' ? '阻断项' : '非阻断'}`,
        code: t.projectCode ?? '',
        initiator: '',
        time: formatDue(t.dueDate),
        overdue: typeof t.dueDate === 'number' && t.dueDate < Date.now(),
        deepLink: t.deepLink,
        actionLabel: DECISION_BUCKET_ACTION[key],
        projectName: t.projectName ?? '',
      })),
    };
  });
});

/* ---------- 产品空间（=工作空间）：选择器 + 空间内容/数据范围 ----------
 * 概念关系：产品空间即工作空间；不同产品空间对应不同的工作空间内容与数据范围。
 * 选项真值 listProducts()（label=productName，value=id），默认选中第一个；切换触发空间重载。 */

const spaces = ref<Product[]>([]);
const spacesState = ref<'empty' | 'error' | 'loading' | 'ready'>('loading');
const selectedSpaceId = ref('');
/** 当前空间项目数据范围（space-progress 上报；待办快捷入口按 projectIds 过滤）。 */
const spaceScope = ref<SpaceScope>({ status: 'loading' });

const selectedSpaceName = computed(
  () => spaces.value.find((p) => p.id === selectedSpaceId.value)?.productName ?? '',
);

async function loadSpaces(): Promise<void> {
  spacesState.value = 'loading';
  try {
    const rows = await listProducts();
    spaces.value = rows;
    if (rows.length === 0) {
      // 产品空间为空 → 整块空态（不渲染模拟下拉/示例数据）
      spacesState.value = 'empty';
      selectedSpaceId.value = '';
      return;
    }
    spacesState.value = 'ready';
    // 默认选中第一个产品空间；已选项仍存在则保持
    const first = rows[0];
    if (first && !rows.some((p) => p.id === selectedSpaceId.value)) {
      selectedSpaceId.value = first.id;
    }
  } catch {
    spaces.value = [];
    spacesState.value = 'error';
  }
}

function onSpaceScopeChange(scope: SpaceScope): void {
  spaceScope.value = scope;
}

/** 删除审批待办数（组长=待初审；超管=待终审）。 */
const deletionPending = computed(() => summary.value?.deletionPending ?? 0);

/** 我的当前推进。 */
const currentAdvance = computed(() => summary.value?.currentAdvance ?? null);

onMounted(async () => {
  // 产品空间（=工作空间）选择器真数据（与聚合接口并行，互不阻塞）
  void loadSpaces();
  try {
    summary.value = await fetchWorkbenchSummary();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '聚合接口加载失败';
  }
  // R215 A10：我发起的/待我审批（失败静默降级——不阻塞主面板，计数回退 stats.myInitiated）
  fetchMyInitiated()
    .then((rows) => {
      myInitiatedTasks.value = rows;
      myInitiatedLoaded.value = true;
    })
    .catch(() => {
      myInitiatedError.value = true;
    });
  fetchMyPendingApprovals()
    .then((rows) => {
      myPendingApprovals.value = rows;
    })
    .catch(() => {});
  // WB-17-1 S0：责任任务队列改从 /workbench/tasks 拉过滤视图（缺省 bucket=pending）
  void loadQueueTasks('pending');
});

// 队列 tab 切换（pending / overdue）联动重拉 /workbench/tasks 过滤视图
watch(activeTab, (tab) => {
  if (tab === 'pending' || tab === 'overdue') void loadQueueTasks(tab);
});
</script>

<template>
  <div class="ipd-workbench">
    <!-- 标题块：身份问候 + 副标题 + 继续当前IPD动作 按钮（按 LIVE URL 1:1 对齐） -->
    <div class="ipd-wb-header">
      <div>
        <h1 class="ipd-wb-title">{{ greeting }}</h1>
        <p class="ipd-wb-subtitle">
          所有跨项目、跨角色待办都在这里接力；必须进入业务详情查看上下文后办理。
        </p>
      </div>
      <div class="ipd-wb-space-picker" data-testid="workbench-space-picker">
        <label class="ipd-wb-space-label" for="ipd-wb-space-select">产品空间（工作空间）</label>
        <select
          v-if="spacesState === 'ready'"
          id="ipd-wb-space-select"
          v-model="selectedSpaceId"
          class="ipd-wb-space-select"
          data-testid="workbench-space-select"
        >
          <option v-for="p in spaces" :key="p.id" :value="p.id">{{ p.productName }}</option>
        </select>
        <span v-else class="ipd-wb-space-placeholder">
          {{ spacesState === 'loading' ? '产品空间加载中…' : spacesState === 'empty' ? '暂无产品空间' : '产品空间加载失败' }}
        </span>
      </div>
      <RouterLink to="/ipd/product-lines">产品线团队空间</RouterLink>
      <button
        type="button"
        class="ipd-wb-continue"
        :disabled="!currentAdvance"
        @click="currentAdvance && $router.push(currentAdvance.deepLink).catch(() => {})"
      >
        继续当前IPD动作
      </button>
    </div>

    <!-- ZK-IPD §三.1.4 业务规则提示：长期无产出提醒 -->
    <div class="ipd-wb-rules">
      <Alert
        type="info"
        show-icon
        message="ZK-IPD 津贴风控规则"
        :description="workbenchRules"
      />
    </div>

    <!-- 4 metric 卡（按 LIVE URL 顺序：待我处理 / 临期·超期 / 未读通知 / 已完成） -->
    <div
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="workbench-metrics"
    >
      <div
        v-for="m in metrics"
        :key="m.label"
        class="ipd-metric-card"
        :class="['tone-' + m.tone]"
      >
        <div class="ipd-metric-label">{{ m.label }}</div>
        <div class="ipd-metric-value">{{ m.value }}</div>
        <div class="ipd-metric-note">{{ m.note }}</div>
      </div>
    </div>

    <!-- R232 P2-04：站内待办入口（待办直达 AI 审批卡，与「未读通知」metric 同区块） -->
    <div class="ipd-wb-todo-entry">
      <button
        type="button"
        class="ipd-wb-coach-btn"
        data-testid="workbench-todo-btn"
        @click="todoDrawerOpen = true"
      >
        站内待办（AI 任务直达）
      </button>
    </div>

    <!-- 产品空间（=工作空间）：第一个项目的阶段进度 + 待办事项快捷入口（真实接口四态，不假绿） -->
    <section class="ipd-wb-space" data-testid="workbench-space-section">
      <header class="ipd-wb-section-header">
        <h2 class="ipd-wb-section-title">工作空间{{ selectedSpaceName ? ` · ${selectedSpaceName}` : '' }}</h2>
        <span class="ipd-wb-section-meta">不同产品空间对应不同的工作空间内容与数据范围</span>
      </header>
      <div v-if="spacesState === 'loading'" class="ipd-wb-empty">产品空间加载中…</div>
      <div v-else-if="spacesState === 'error'" class="ipd-wb-empty" data-testid="workbench-space-error">
        <p class="ipd-wb-fail-text">产品空间加载失败</p>
        <button
          type="button"
          class="ipd-wb-retry-btn"
          data-testid="workbench-space-retry"
          @click="loadSpaces"
        >
          重试
        </button>
      </div>
      <div v-else-if="spacesState === 'empty'" class="ipd-wb-empty" data-testid="workbench-space-empty">
        暂无产品空间
      </div>
      <div v-else class="ipd-wb-space-grid">
        <SpaceProgress
          :space-id="selectedSpaceId"
          :space-name="selectedSpaceName"
          @open-flow="(projectId) => $router.push(`/ipd/projects/${projectId}/flow`).catch(() => {})"
          @scope-change="onSpaceScopeChange"
        />
        <TodoQuickEntry
          :scope="spaceScope"
          :space-id="selectedSpaceId"
          :space-name="selectedSpaceName"
          @open-task="(deepLink) => $router.push(deepLink).catch(() => {})"
        />
      </div>
    </section>

    <!-- 责任任务队列筛选 tab（按 LIVE URL 实拍顺序） -->
    <div class="ipd-wb-queue">
      <div class="ipd-wb-tabs" role="tablist">
        <button
          v-for="t in queueTabs"
          :key="t.key"
          type="button"
          role="tab"
          :aria-selected="activeTab === t.key"
          :class="['ipd-wb-tab', { active: activeTab === t.key }]"
          @click="activeTab = t.key"
        >
          {{ t.label }}<span v-if="t.count" class="ipd-wb-tab-count">{{ t.count }}</span>
        </button>
      </div>

      <div class="ipd-wb-queue-grid">
        <!-- 责任任务队列（左列） -->
        <section class="ipd-wb-queue-card">
          <header class="ipd-wb-section-header">
            <h2 class="ipd-wb-section-title">今天需要我决定什么</h2>
            <span class="ipd-wb-section-meta">{{ taskGroups.reduce((n, g) => n + g.count, 0) }} 项</span>
          </header>
          <p v-if="loadError" class="ipd-wb-empty">聚合接口加载失败：{{ loadError }}</p>
          <div v-else-if="showsNonQueueNotice" class="ipd-wb-empty">
            {{ nonQueueNotice }}
          </div>
          <template v-else>
          <div v-if="taskGroups.every((g) => g.count === 0)" class="ipd-wb-empty">
            {{ queueEmptyNotice }}
          </div>
          <div v-for="g in taskGroups" :key="g.projectName" class="ipd-wb-group">
            <h3 class="ipd-wb-group-title">
              {{ g.projectName }}
              <Tag color="blue">{{ g.count }}项</Tag>
            </h3>
            <p v-if="g.items.length === 0" class="ipd-wb-empty">暂无</p>
            <article
              v-for="(it, idx) in g.items"
              :key="idx"
              class="ipd-wb-task"
            >
              <Tag class="ipd-wb-task-kind" color="processing">{{ it.kind }}</Tag>
              <div class="ipd-wb-task-body">
                <h4 class="ipd-wb-task-title">{{ it.title }}</h4>
                <p class="ipd-wb-task-desc">{{ it.desc }}</p>
                <p class="ipd-wb-task-meta">
                  <span v-if="it.projectName">{{ it.projectName }}</span>
                  <span v-if="it.projectName && it.code"> · </span>
                  <span v-if="it.code">{{ it.code }}</span>
                  <span v-if="it.initiator"> · 发起人 </span>
                  <span v-if="it.initiator">{{ it.initiator }}</span>
                  <span> · </span>
                  <span :class="{ 'ipd-wb-overdue': it.overdue }">{{ it.time }}</span>
                </p>
              </div>
              <button
                v-if="it.deepLink"
                type="button"
                class="ipd-wb-coach-btn"
                data-testid="workbench-task-open"
                @click="$router.push(it.deepLink).catch(() => {})"
              >
                {{ it.actionLabel }}
              </button>
            </article>
          </div>
          </template>
        </section>

        <!-- 右列：我的当前推进 + 跨角色工作不再失联 -->
        <aside class="ipd-wb-queue-side">
          <section class="ipd-wb-side-card">
            <header class="ipd-wb-section-header">
              <h2 class="ipd-wb-section-title">我的当前推进</h2>
              <span class="ipd-wb-section-meta">{{ currentAdvance ? (currentAdvance.currentStage ?? '—') : '—' }}</span>
            </header>
            <div v-if="currentAdvance" class="ipd-wb-current">
              <p class="ipd-wb-current-code">{{ currentAdvance.projectCode ?? currentAdvance.projectName }}</p>
              <h3 class="ipd-wb-current-title">{{ currentAdvance.actionName ?? '当前阶段无待办动作' }}</h3>
              <p class="ipd-wb-current-meta">
                {{ currentAdvance.projectName }} · {{ currentAdvance.actionStatus ?? '当前没有在途动作命中你的角色' }} · 深入业务详情办理
              </p>
              <button type="button" class="ipd-wb-coach-btn" @click="$router.push(currentAdvance.deepLink).catch(() => {})">
                打开任务教练
              </button>
            </div>
            <div v-else class="ipd-wb-current">
              <p class="ipd-wb-current-code">—</p>
              <h3 class="ipd-wb-current-title">尚无进行中的 IPD 动作</h3>
              <p class="ipd-wb-current-meta">项目推进后，当前阶段动作会实时展示在这里</p>
              <button type="button" class="ipd-wb-coach-btn" disabled>
                打开任务教练
              </button>
            </div>
          </section>

          <section class="ipd-wb-side-card ipd-wb-handoff">
            <header class="ipd-wb-section-header">
              <h2 class="ipd-wb-section-title">跨角色工作不再失联</h2>
            </header>
            <p class="ipd-wb-handoff-desc">
              {{ handoffScopeNotice }}
            </p>
          </section>

          <!-- R227-C1 AI-FUSION L2：场景化 AI 入口（建议下一步 / 风险预警，后端拉上下文前端不拼数据） -->
          <section class="ipd-wb-side-card">
            <header class="ipd-wb-section-header">
              <h2 class="ipd-wb-section-title">AI 帮忙</h2>
            </header>
            <AiSuggest scene="workbench.next-step" label="AI 建议下一步" data-testid="wb-ai-next-step" />
            <AiSuggest scene="workbench.risk-warning" label="AI 风险预警" data-testid="wb-ai-risk" />
          </section>
        </aside>
      </div>
    </div>

    <!-- 治理待办与资格提醒 -->
    <section class="ipd-wb-governance">
      <header class="ipd-wb-section-header">
        <h2 class="ipd-wb-section-title">治理待办与资格提醒</h2>
      </header>
      <p class="ipd-wb-section-sub">
        已并入我的工作台；删除申请仍从对应业务对象发起。
      </p>
      <div class="ipd-wb-governance-grid">
        <section class="ipd-wb-side-card">
          <header class="ipd-wb-section-header">
            <h3 class="ipd-wb-section-title">删除审批</h3>
            <span class="ipd-wb-section-meta">{{ deletionPending }}项待处理</span>
          </header>
          <div class="ipd-wb-empty ipd-wb-empty-tight">
            {{ deletionPending > 0 ? `有 ${deletionPending} 项删除申请待处理；从对应业务对象进入办理。` : '暂无待处理删除审批。' }}
          </div>
        </section>

        <section class="ipd-wb-side-card">
          <header class="ipd-wb-section-header">
            <h3 class="ipd-wb-section-title">待我审批</h3>
            <span class="ipd-wb-section-meta">{{ myPendingApprovals.length }}项待处理</span>
          </header>
          <div class="ipd-wb-empty ipd-wb-empty-tight">
            {{
              myPendingApprovals.length > 0
                ? `${pendingApprovalsDigest}；从对应单据进入办理。`
                : '暂无待我审批的变更/删除单据。'
            }}
          </div>
        </section>

        <section class="ipd-wb-side-card">
          <header class="ipd-wb-section-header">
            <h3 class="ipd-wb-section-title">无实质产出提醒</h3>
            <span class="ipd-wb-section-meta">仅提醒，不自动停发</span>
          </header>
          <div class="ipd-wb-empty ipd-wb-empty-tight">
            无实质产出名单（P1 substantive-output，月度资格规则扫描）后端未交付；此处不展示名单，也不做假数据。
          </div>
        </section>
      </div>
    </section>

    <!-- R232 P2-04：站内待办 + AI 任务直达抽屉（页03 站内信落位，跨设备不靠会话回放） -->
    <AiTaskTodoDrawer
      v-model:open="todoDrawerOpen"
      :project-id="currentAdvance?.projectId ?? undefined"
    />
  </div>
</template>

<style scoped>

/* V12-F3: 原 1100px 断点归一至 768px（唯一断点常量见 _shared/ipd-breakpoints.ts） */
@media (max-width: 768px) {
  .ipd-wb-queue-grid { grid-template-columns: 1fr; }

  .ipd-wb-space-grid { grid-template-columns: 1fr; }

  .ipd-wb-header { flex-wrap: wrap; }
}

/* 页面容器（原型 .page-frame：28px 32px 60px，max-width 1600px 居中） */
.ipd-workbench {
  display: grid;
  gap: 18px;
  max-width: 1600px;
  padding: 28px 32px 60px;
  margin: auto;
}


/* 产品空间（=工作空间）：选择器 + 区块 */
.ipd-wb-space-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ipd-wb-space-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-space-select {
  height: 38px;
  min-width: 200px;
  padding: 0 12px;
  font-size: 14px;
  color: var(--ipd-text, #172033);
  background: var(--ipd-surface, #fff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 6px;
}

.ipd-wb-space-placeholder {
  height: 38px;
  font-size: 13px;
  line-height: 38px;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-space {
  padding: 20px 24px;
  background: var(--ipd-surface, #fff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
}

.ipd-wb-space-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}

.ipd-wb-fail-text {
  margin: 0 0 10px;
  font-weight: 600;
  color: var(--ipd-red, #e45757);
}

.ipd-wb-retry-btn {
  padding: 6px 18px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ipd-blue, #245bf4);
  cursor: pointer;
  background: var(--ipd-blue-soft, #edf2ff);
  border: 1px solid var(--ipd-blue, #245bf4);
  border-radius: 6px;
}

/* R232 P2-04 站内待办入口行 */
.ipd-wb-todo-entry {
  display: flex;
  justify-content: flex-end;
}

/* 标题块（greeting + continue 按钮） */
.ipd-wb-header {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  background: var(--ipd-surface, #fff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
}

.ipd-wb-title {
  margin: 0;
  font-family: var(--ipd-font, Inter, 'Noto Sans SC', 'Microsoft YaHei', sans-serif);
  font-size: 25px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ipd-text, #172033);
}

.ipd-wb-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-continue {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  height: 38px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  cursor: pointer;
  background: var(--ipd-blue, #245bf4);
  border: none;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgb(36 91 244 / 18%);
}

.ipd-wb-continue:hover {
  background: var(--ipd-blue-dark, #1747d7);
  box-shadow: 0 6px 16px rgb(36 91 244 / 24%);
}

/* 4 metric 卡（与 LIVE 工作台 metric 一致：白底 / 灰边 / 8px 圆角 / 17px 20px padding） */
.ipd-metric-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 96px;
  padding: 17px 20px;
  background: var(--ipd-surface, #fff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
}

.ipd-metric-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ipd-text, #172033);
}

.ipd-metric-value {
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  color: var(--ipd-text, #172033);
}

.tone-danger .ipd-metric-value { color: var(--ipd-red, #e45757); }

.tone-warning .ipd-metric-value { color: var(--ipd-amber, #c98313); }

.tone-primary .ipd-metric-value { color: var(--ipd-blue, #245bf4); }

.ipd-metric-note {
  font-size: 12px;
  color: var(--ipd-muted, #697388);
}

/* 责任队列 tab + 卡片 */
.ipd-wb-queue {
  padding: 20px 24px;
  background: var(--ipd-surface, #fff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
}

.ipd-wb-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.ipd-wb-tab {
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ipd-text, #172033);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 6px;
  transition: all 0.15s;
}

.ipd-wb-tab:hover {
  color: var(--ipd-blue, #245bf4);
  border-color: var(--ipd-blue, #245bf4);
}

.ipd-wb-tab.active {
  font-weight: 600;
  color: var(--ipd-blue, #245bf4);
  background: var(--ipd-blue-soft, #edf2ff);
  border-color: var(--ipd-blue, #245bf4);
}

.ipd-wb-tab-count {
  display: inline-block;
  min-width: 18px;
  padding: 0 5px;
  margin-left: 6px;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  color: var(--ipd-blue, #245bf4);
  background: var(--ipd-blue-soft, #edf2ff);
  border-radius: 9px;
}

.ipd-wb-tab.active .ipd-wb-tab-count {
  background: #fff;
}

.ipd-wb-overdue {
  font-weight: 600;
  color: var(--ipd-red, #e45757);
}

.ipd-wb-queue-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 20px;
}

.ipd-wb-queue-card,
.ipd-wb-side-card,
.ipd-wb-governance {
  padding: 18px 20px;
  background: var(--ipd-surface, #fff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
}

.ipd-wb-queue-side,
.ipd-wb-governance-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ipd-wb-section-header {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}

.ipd-wb-section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--ipd-text, #172033);
}

.ipd-wb-section-meta {
  font-size: 12px;
  font-weight: 500;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-section-sub {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-empty {
  padding: 28px 12px;
  font-size: 13px;
  color: var(--ipd-muted, #697388);
  text-align: center;
}

.ipd-wb-empty-tight { padding: 14px 0; }

.ipd-wb-group + .ipd-wb-group { margin-top: 16px; }

.ipd-wb-group-title {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ipd-text, #172033);
}

.ipd-wb-task {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 8px;
  background: var(--ipd-surface, #fff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 6px;
}

.ipd-wb-task-kind {
  flex-shrink: 0;
  height: 22px;
  line-height: 20px;
}

.ipd-wb-task-body {
  flex: 1;
  min-width: 0;
}

.ipd-wb-task-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ipd-text, #172033);
}

.ipd-wb-task-desc {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-task-meta {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-current-code {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-current-title {
  margin: 4px 0 6px;
  font-size: 15px;
  font-weight: 700;
  color: var(--ipd-text, #172033);
}

.ipd-wb-current-meta {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-coach-btn {
  width: 100%;
  height: 38px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  background: var(--ipd-blue, #245bf4);
  border: none;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgb(36 91 244 / 18%);
}

.ipd-wb-coach-btn:disabled {
  color: var(--ipd-muted, #697388);
  cursor: not-allowed;
  background: var(--ipd-line, #dfe4ed);
  box-shadow: none;
}

.ipd-wb-handoff-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ipd-muted, #697388);
}

.ipd-wb-nooutput {
  padding: 0;
  margin: 0;
  list-style: none;
}

.ipd-wb-nooutput li {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: baseline;
  padding: 8px 0;
  font-size: 13px;
  border-top: 1px dashed var(--ipd-line, #dfe4ed);
}

.ipd-wb-nooutput li:first-child { border-top: none; }

.ipd-wb-nooutput-person {
  font-weight: 600;
  color: var(--ipd-text, #172033);
}

.ipd-wb-nooutput-sep { color: var(--ipd-muted, #697388); }

.ipd-wb-nooutput-project { color: var(--ipd-text, #172033); }

.ipd-wb-nooutput-meta {
  display: block;
  width: 100%;
  margin-top: 2px;
  font-size: 12px;
  color: var(--ipd-muted, #697388);
}

/* ============================================================================
 * 工作台视觉对齐 —— 真值源：ZK-IPD LIVE URL 2026-09-06 chrome-devtools 实测
 * 关键色：--ipd-blue #245bf4 / --ipd-text #172033 / --ipd-muted #697388
 *       / --ipd-line #dfe4ed / --ipd-bg #f5f7fb
 * ============================================================================ */
</style>
