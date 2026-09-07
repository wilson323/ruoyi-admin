<script setup lang="ts">
/**
 * 页03 工作台（后端聚合 WorkbenchController GET /api/v1/workbench/summary，2026-09-06 接入真实数据）。
 *
 * 真值源：ZK-IPD LIVE URL http://127.0.0.1:4173/workspace（2026-09-06 chrome-devtools 实地抓取）。
 * 形态：身份问候（按时辰）+ 4 metric 卡 + 责任任务队列 + 我的当前推进 + 删除审批数 + 无实质产出提醒。
 * 无实质产出名单依赖绩效域月度资格规则（P1 substantive-output），当前展示真实空态。
 */
import { computed, onMounted, ref } from 'vue';
import { Alert, Tag } from 'ant-design-vue';

import { fetchWorkbenchSummary } from '../../../api/ipd/workbench';
import type { WorkbenchSummary, WorkbenchTask } from '../../../api/ipd/workbench';
import { useIpdAuthStore } from '../../../store/ipd-auth';
import '../_shared/ipd-theme.css';
import { RULES_BY_PAGE, renderRulesDescription } from '../_shared/zk-ipd-rules';

const auth = useIpdAuthStore();
const workbenchRules = computed(() => renderRulesDescription(RULES_BY_PAGE.workbench));

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
    // TODO(P4-3.1): 等聚合端点交付后恢复「我发起的」计数徽标
    { key: 'initiated', label: '我发起的', count: null },
    { key: 'overdue', label: '临期/超期', count: s ? s.overdue : 0 },
    { key: 'completed', label: '已完成', count: s ? s.completed : 0 },
    // TODO(P4-3.1): 等聚合端点交付后恢复「我的关注」计数徽标
    { key: 'followed', label: '我的关注', count: null },
  ];
});

/** 责任队列：后端 tasks 平铺 → 按项目分组（真实 stage_action）。 */
interface TaskGroup {
  projectName: string;
  count: number;
  items: { kind: string; title: string; desc: string; code: string; initiator: string; time: string; overdue: boolean }[];
}

const STATUS_TEXT: Record<string, string> = {
  IN_PROGRESS: '进行中',
  NOT_STARTED: '未开始',
  DELAYED: '已延期',
};

function formatDue(iso: null | number | string): string {
  if (!iso) return '无截止';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd} 截止`;
}

const taskGroups = computed<TaskGroup[]>(() => {
  const tasks = summary.value?.tasks ?? [];
  const visible = activeTab.value === 'overdue'
    ? tasks.filter((t) => t.priority === 'high')
    : tasks;
  const byProject = new Map<string, WorkbenchTask[]>();
  for (const t of visible) {
    const key = t.projectName ?? '未命名项目';
    byProject.set(key, [...(byProject.get(key) ?? []), t]);
  }
  return [...byProject.entries()].map(([projectName, items]) => ({
    projectName,
    count: items.length,
    items: items.map((t) => ({
      kind: STATUS_TEXT[t.status] ?? t.status,
      title: t.title ?? t.actionCode ?? '阶段动作',
      desc: `责任角色 ${t.ownerRole ?? 'BOTH'} · ${t.isBlocking === '1' ? '阻断项' : '非阻断'}`,
      code: t.projectCode ?? '',
      initiator: '',
      time: formatDue(t.dueDate),
      // 超期红字按事实判定（dueDate 已过，与后端 priority=high 同口径），而非仅 DELAYED 状态
      overdue: typeof t.dueDate === 'number' && t.dueDate < Date.now(),
    })),
  }));
});

/** 删除审批待办数（组长=待初审；超管=待终审）。 */
const deletionPending = computed(() => summary.value?.deletionPending ?? 0);

/** 我的当前推进。 */
const currentAdvance = computed(() => summary.value?.currentAdvance ?? null);

onMounted(async () => {
  try {
    summary.value = await fetchWorkbenchSummary();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '聚合接口加载失败';
  }
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
      <button type="button" class="ipd-wb-continue">
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
            <h2 class="ipd-wb-section-title">责任任务队列</h2>
            <span class="ipd-wb-section-meta">{{ taskGroups.reduce((n, g) => n + g.count, 0) }} 项</span>
          </header>
          <p v-if="loadError" class="ipd-wb-empty">聚合接口加载失败：{{ loadError }}</p>
          <div v-else-if="activeTab !== 'pending' && activeTab !== 'overdue'" class="ipd-wb-empty">
            {{ activeTab === 'followed' ? '尚未收藏业务对象；在动作工作区点击收藏后，会集中显示在这里。' : '当前没有待处理事项；新的动作、审批、移交、绩效或整改责任会自动投递到这里。' }}
          </div>
          <template v-else>
          <div v-if="taskGroups.length === 0" class="ipd-wb-empty">
            暂无责任任务；任务到达会按责任链实时投递到这里。
          </div>
          <div v-for="g in taskGroups" :key="g.projectName" class="ipd-wb-group">
            <h3 class="ipd-wb-group-title">
              {{ g.projectName }}
              <Tag color="blue">{{ g.count }}项</Tag>
            </h3>
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
                  <span v-if="it.code">{{ it.code }}</span>
                  <span v-if="it.initiator"> · 发起人 </span>
                  <span v-if="it.initiator">{{ it.initiator }}</span>
                  <span> · </span>
                  <span :class="{ 'ipd-wb-overdue': it.overdue }">{{ it.time }}</span>
                </p>
              </div>
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
                {{ currentAdvance.projectName }} · {{ currentAdvance.actionStatus ?? 'IDLE' }} · 深入业务详情办理
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
              每次状态变化会同时完成当前任务、投递下一责任人、生成通知并写入审计。
            </p>
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
            <h3 class="ipd-wb-section-title">无实质产出提醒</h3>
            <span class="ipd-wb-section-meta">仅提醒，不自动停发</span>
          </header>
          <div class="ipd-wb-empty ipd-wb-empty-tight">
            本月暂无待复核名单；月度资格规则扫描后自动展示（P1 substantive-output 接入）。
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>

/* V12-F3: 原 1100px 断点归一至 768px（唯一断点常量见 _shared/ipd-breakpoints.ts） */
@media (max-width: 768px) {
  .ipd-wb-queue-grid { grid-template-columns: 1fr; }
}

/* 页面容器（原型 .page-frame：28px 32px 60px，max-width 1600px 居中） */
.ipd-workbench {
  display: grid;
  gap: 18px;
  max-width: 1600px;
  padding: 28px 32px 60px;
  margin: auto;
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
