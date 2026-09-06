<script setup lang="ts">
/**
 * 页03 工作台（卡 P0-10.3，后端聚合接口 P4-3.1 未交付）。
 *
 * 真值源：ZK-IPD LIVE URL http://127.0.0.1:4173/workspace（2026-09-06 chrome-devtools 实地抓取）。
 *         设计稿字段：--navy / --navy-2 / --blue / --blue-dark / --blue-soft
 * 形态：身份问候（按时辰）+ 4 metric 卡 + 责任任务队列 + 我的当前推进 + 治理待办 + 删除审批 + 无实质产出提醒。
 * 聚合数据等待后端交付后接入（待我处理数 / 责任队列分组 / 当前推进 / 删除审批数 / 无产出提醒名单）。
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { Alert, Card, Tag } from 'ant-design-vue';

import { useIpdAuthStore } from '../../../store/ipd-auth';
import '../_shared/ipd-theme.css';

const auth = useIpdAuthStore();
const router = useRouter();

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

interface MetricCard {
  label: string;
  note: string;
  value: number | string;
  tone: 'default' | 'danger' | 'warning' | 'primary';
}
/** ZK-IPD 工作台 4 metric 占位（待后端聚合接口 P4-3.1 接入真实值）。 */
const metrics: MetricCard[] = [
  { label: '待我处理', note: '按责任链实时投递', value: '—', tone: 'default' },
  { label: '临期 / 超期', note: '优先处理阻断项', value: '—', tone: 'danger' },
  { label: '未读通知', note: '站内提醒不依赖企微', value: '—', tone: 'warning' },
  { label: '已完成', note: '全过程可追溯', value: '—', tone: 'primary' },
];

const activeTab = ref<'completed' | 'followed' | 'initiated' | 'overdue' | 'pending'>('pending');

/** LIVE 工作台责任队列筛选 tab（待后端聚合接口接入真实计数与列表）。 */
const queueTabs = [
  { key: 'pending', label: '待我处理' },
  { key: 'initiated', label: '我发起的' },
  { key: 'overdue', label: '临期/超期' },
  { key: 'completed', label: '已完成' },
  { key: 'followed', label: '我的关注' },
] as const;

/** LIVE 工作台责任任务队列占位分组（待后端按项目聚合）。 */
interface TaskGroup {
  projectName: string;
  count: number;
  items: { kind: string; title: string; desc: string; code: string; initiator: string; time: string }[];
}
const taskGroups: TaskGroup[] = [
  {
    projectName: '如门禁测试',
    count: 2,
    items: [
      { kind: '产出资格提醒', title: '连续两个月无实质产出复核', desc: '仅提醒复核津贴资格，系统不会自动停发', code: 'pm2008', initiator: '傅志谦', time: '09/02 20:15' },
      { kind: '产出资格提醒', title: '连续两个月无实质产出复核', desc: '仅提醒复核津贴资格，系统不会自动停发', code: 'pm2008', initiator: '傅志谦', time: '09/02 20:15' },
    ],
  },
  {
    projectName: '熵基互联+智能锁',
    count: 2,
    items: [
      { kind: '产出资格提醒', title: '连续两个月无实质产出复核', desc: '仅提醒复核津贴资格，系统不会自动停发', code: 'PM00085', initiator: '傅志谦', time: '09/02 20:15' },
      { kind: '产出资格提醒', title: '连续两个月无实质产出复核', desc: '仅提醒复核津贴资格，系统不会自动停发', code: 'PM00085', initiator: '傅志谦', time: '09/02 20:15' },
    ],
  },
];

/** LIVE 无产出提醒占位名单（待后端按月度资格规则接入）。 */
interface NoOutputRow { person: string; project: string; month: string; reason: string }
const noOutputList: NoOutputRow[] = [
  { person: '杨志君', project: '熵基互联+智能锁', month: '2026-09', reason: '最近产出 两个月内无记录' },
  { person: '胡蛟露', project: '如门禁测试', month: '2026-09', reason: '最近产出 两个月内无记录' },
  { person: '上官志昌', project: '如门禁测试', month: '2026-09', reason: '最近产出 两个月内无记录' },
  { person: '文元彪', project: '熵基互联+智能锁', month: '2026-09', reason: '最近产出 两个月内无记录' },
];
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
          {{ t.label }}
        </button>
      </div>

      <div class="ipd-wb-queue-grid">
        <!-- 责任任务队列（左列） -->
        <section class="ipd-wb-queue-card">
          <header class="ipd-wb-section-header">
            <h2 class="ipd-wb-section-title">责任任务队列</h2>
            <span class="ipd-wb-section-meta">— 项</span>
          </header>
          <div v-if="activeTab !== 'pending'" class="ipd-wb-empty">
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
                  <span>{{ it.code }}</span>
                  <span> · 发起人 </span>
                  <span>{{ it.initiator }}</span>
                  <span> · </span>
                  <span>{{ it.time }}</span>
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
              <span class="ipd-wb-section-meta">—</span>
            </header>
            <div class="ipd-wb-current">
              <p class="ipd-wb-current-code">—</p>
              <h3 class="ipd-wb-current-title">尚无进行中的 IPD 动作</h3>
              <p class="ipd-wb-current-meta">待后端聚合接口接入后展示当前项目 / 阶段 / 工作项</p>
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
            <span class="ipd-wb-section-meta">0项待处理</span>
          </header>
          <div class="ipd-wb-empty ipd-wb-empty-tight">
            暂无待处理删除审批。
          </div>
        </section>

        <section class="ipd-wb-side-card">
          <header class="ipd-wb-section-header">
            <h3 class="ipd-wb-section-title">无实质产出提醒</h3>
            <span class="ipd-wb-section-meta">仅提醒，不自动停发</span>
          </header>
          <ul class="ipd-wb-nooutput">
            <li v-for="r in noOutputList" :key="r.person + r.project">
              <span class="ipd-wb-nooutput-person">{{ r.person }}</span>
              <span class="ipd-wb-nooutput-sep"> · </span>
              <span class="ipd-wb-nooutput-project">{{ r.project }}</span>
              <span class="ipd-wb-nooutput-meta">
                {{ r.month }} · {{ r.reason }}
              </span>
            </li>
          </ul>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ============================================================================
 * 工作台视觉对齐 —— 真值源：ZK-IPD LIVE URL 2026-09-06 chrome-devtools 实测
 * 关键色：--ipd-blue #245bf4 / --ipd-text #172033 / --ipd-muted #697388
 *       / --ipd-line #dfe4ed / --ipd-bg #f5f7fb
 * ============================================================================ */

/* 页面容器（原型 .page-frame：28px 32px 60px，max-width 1600px 居中） */
.ipd-workbench {
  padding: 28px 32px 60px;
  max-width: 1600px;
  margin: auto;
  display: grid;
  gap: 18px;
}


/* 标题块（greeting + continue 按钮） */
.ipd-wb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: var(--ipd-surface, #ffffff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
  padding: 20px 24px;
}
.ipd-wb-title {
  font-size: 25px;
  font-weight: 700;
  color: var(--ipd-text, #172033);
  font-family: var(--ipd-font, Inter, 'Noto Sans SC', 'Microsoft YaHei', sans-serif);
  margin: 0;
  line-height: 1.3;
}
.ipd-wb-subtitle {
  font-size: 13px;
  color: var(--ipd-muted, #697388);
  margin: 6px 0 0;
  line-height: 1.5;
}
.ipd-wb-continue {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--ipd-blue, #245bf4);
  color: #ffffff;
  border: none;
  border-radius: 6px;
  height: 38px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(36, 91, 244, 0.18);
  white-space: nowrap;
}
.ipd-wb-continue:hover {
  background: var(--ipd-blue-dark, #1747d7);
  box-shadow: 0 6px 16px rgba(36, 91, 244, 0.24);
}

/* 4 metric 卡（与 LIVE 工作台 metric 一致：白底 / 灰边 / 8px 圆角 / 17px 20px padding） */
.ipd-metric-card {
  background: var(--ipd-surface, #ffffff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
  padding: 17px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 96px;
}
.ipd-metric-label {
  font-size: 13px;
  color: var(--ipd-text, #172033);
  font-weight: 600;
}
.ipd-metric-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--ipd-text, #172033);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
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
  background: var(--ipd-surface, #ffffff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
  padding: 20px 24px;
}
.ipd-wb-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.ipd-wb-tab {
  background: transparent;
  border: 1px solid var(--ipd-line, #dfe4ed);
  color: var(--ipd-text, #172033);
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.ipd-wb-tab:hover {
  color: var(--ipd-blue, #245bf4);
  border-color: var(--ipd-blue, #245bf4);
}
.ipd-wb-tab.active {
  background: var(--ipd-blue-soft, #edf2ff);
  border-color: var(--ipd-blue, #245bf4);
  color: var(--ipd-blue, #245bf4);
  font-weight: 600;
}

.ipd-wb-queue-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 20px;
}
@media (max-width: 1100px) {
  .ipd-wb-queue-grid { grid-template-columns: 1fr; }
}

.ipd-wb-queue-card,
.ipd-wb-side-card,
.ipd-wb-governance {
  background: var(--ipd-surface, #ffffff);
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 8px;
  padding: 18px 20px;
}
.ipd-wb-queue-side,
.ipd-wb-governance-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ipd-wb-section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.ipd-wb-section-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ipd-text, #172033);
  margin: 0;
}
.ipd-wb-section-meta {
  font-size: 12px;
  color: var(--ipd-muted, #697388);
  font-weight: 500;
}
.ipd-wb-section-sub {
  font-size: 13px;
  color: var(--ipd-muted, #697388);
  margin: 0 0 12px;
}

.ipd-wb-empty {
  font-size: 13px;
  color: var(--ipd-muted, #697388);
  text-align: center;
  padding: 28px 12px;
}
.ipd-wb-empty-tight { padding: 14px 0; }

.ipd-wb-group + .ipd-wb-group { margin-top: 16px; }
.ipd-wb-group-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ipd-text, #172033);
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ipd-wb-task {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--ipd-line, #dfe4ed);
  border-radius: 6px;
  margin-bottom: 8px;
  background: var(--ipd-surface, #ffffff);
}
.ipd-wb-task-kind { flex-shrink: 0; height: 22px; line-height: 20px; }
.ipd-wb-task-body { flex: 1; min-width: 0; }
.ipd-wb-task-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ipd-text, #172033);
  margin: 0;
}
.ipd-wb-task-desc {
  font-size: 12px;
  color: var(--ipd-muted, #697388);
  margin: 4px 0 0;
}
.ipd-wb-task-meta {
  font-size: 12px;
  color: var(--ipd-muted, #697388);
  margin: 6px 0 0;
}

.ipd-wb-current-code {
  font-size: 12px;
  color: var(--ipd-muted, #697388);
  margin: 0;
  font-weight: 600;
}
.ipd-wb-current-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ipd-text, #172033);
  margin: 4px 0 6px;
}
.ipd-wb-current-meta {
  font-size: 12px;
  color: var(--ipd-muted, #697388);
  margin: 0 0 14px;
}
.ipd-wb-coach-btn {
  width: 100%;
  background: var(--ipd-blue, #245bf4);
  color: #ffffff;
  border: none;
  border-radius: 6px;
  height: 38px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(36, 91, 244, 0.18);
}
.ipd-wb-coach-btn:disabled {
  background: var(--ipd-line, #dfe4ed);
  color: var(--ipd-muted, #697388);
  cursor: not-allowed;
  box-shadow: none;
}

.ipd-wb-handoff-desc {
  font-size: 13px;
  color: var(--ipd-muted, #697388);
  margin: 0;
  line-height: 1.6;
}

.ipd-wb-nooutput {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ipd-wb-nooutput li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
  padding: 8px 0;
  border-top: 1px dashed var(--ipd-line, #dfe4ed);
  font-size: 13px;
}
.ipd-wb-nooutput li:first-child { border-top: none; }
.ipd-wb-nooutput-person { font-weight: 600; color: var(--ipd-text, #172033); }
.ipd-wb-nooutput-sep { color: var(--ipd-muted, #697388); }
.ipd-wb-nooutput-project { color: var(--ipd-text, #172033); }
.ipd-wb-nooutput-meta {
  display: block;
  width: 100%;
  font-size: 12px;
  color: var(--ipd-muted, #697388);
  margin-top: 2px;
}
</style>
