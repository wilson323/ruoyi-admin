<script lang="ts" setup>
/**
 * IPD 主框架 Shell —— 严格对齐 ZK-IPD 原型运行态（127.0.0.1:4173/workspace）。
 *
 * 真值源：/Users/mac/Documents/ZK-IPD/产品流程细化管理工具 2/src/App.jsx function Shell
 *         与 src/styles.css 的 .app-shell/.topbar/.sidebar/.stage-rail 段（2026-09-06 实测）。
 * 结构：topbar(56px #071426 固定) + sidebar(164px #18253a) + main-area(#f5f7fb) + AI 悬浮入口。
 * 数据：项目下拉走 GET /projects（owner 字段后端未回传，暂显示 编号）；
 *       全局搜索仍为占位壳（P4-3.1）；站内通知已接 /api/v1/notifications 消费侧 4 端点（卡 df7eba96）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';

import { useFocusTrap } from '../views/ipd/_shared/use-focus-trap';
import {
  PhArrowLeft as ArrowLeft,
  PhArrowsClockwise as ArrowsClockwise,
  PhBell as Bell,
  PhBookOpen as BookOpen,
  PhCalendarBlank as CalendarBlank,
  PhCaretDown as CaretDown,
  PhChartBar as ChartBar,
  PhClipboardText as ClipboardText,
  PhDatabase as Database,
  PhFolderOpen as FolderOpen,
  PhGear as Gear,
  PhHandshake as Handshake,
  PhHouse as House,
  PhMagnifyingGlass as MagnifyingGlass,
  PhPackage as Package,
  PhQuestion as Question,
  PhRobot as Robot,
  PhShieldCheck as ShieldCheck,
  PhSignOut as SignOut,
  PhTarget as Target,
  PhUsers as Users,
  PhX as X,
} from '@phosphor-icons/vue';

import {
  fetchUnreadCount,
  type IpdNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/ipd/notification';
import { listProjects, type Project } from '../api/ipd/project';
import { useIpdAuthStore } from '../store/ipd-auth';
import { enterPlatform } from '../router/ipd-guard';
import avatarUrl from '../assets/product-manager-avatar.png';
import ipdLogoUrl from '../assets/ipd-logo.png';
import '../views/ipd/_shared/ipd-theme.css';
import '../views/ipd/_shared/ipd-a11y.css';

const auth = useIpdAuthStore();
const route = useRoute();
const router = useRouter();

/**
 * 切换到 AI 管理平台（2026-09-06 owner 指令：左下角整体切换两套工作台，不混排菜单）：
 * 续签平台票 → 挂平台路由与菜单 → 跳首个可见叶子。失败仅提示，不离开 IPD 界面。
 * IPD 工作台内 AI 能力控制由 AI 副驾悬浮入口（下方 global-ai-entry）承担，保持不变。
 */
const switching = ref(false);
/**
 * AI 管理平台桥入口开关（2026-09-10 重新开启）。
 * 旧注释「后端 /auth/platform-token 端点尚未实现」为误报：9/9-9/10 的静态扫描只覆盖
 * ruoyi-modules/ruoyi-ipd（IpdAuthController），漏了端点实际所在的 ruoyi-admin 模块
 * IpdPlatformAuthController（@PostMapping("/platform-token")）。
 * 2026-09-10 浏览器实测（ipd-admin 登录态）：POST /api/v1/auth/platform-token →
 * HTTP 200/code 0 签发平台票 platformUser=ipd-admin；GET /api/v1/system/menu/getRouters →
 * HTTP 200/code 0 返回 9 个顶级路由（对话管理/智能体管理/MCP管理/系统监控/系统管理/
 * 系统工具/工作流/我的任务/IPD 工作台）。原注释引用的 scripts/ipd-known-gaps.json 从未存在
 * （失效引用），一并移除。goPlatform/switching/enterPlatform 保持被引用不产生未使用告警。
 */
const platformBridgeEnabled = true;
async function goPlatform() {
  if (switching.value) return;
  switching.value = true;
  try {
    const landing = await enterPlatform(router);
    await router.replace(landing);
  } catch (error) {
    message.warning(error instanceof Error ? error.message : '无法进入 AI 管理平台，请稍后再试');
  } finally {
    switching.value = false;
  }
}

/** 原型 App.jsx navItems 15 项（12 全员 + 3 超管），path 映射到本仓 /ipd/* 路由。 */
const navItems = [
  { path: '/ipd/workbench', label: '我的工作台', icon: House },
  { path: '/ipd/projects', label: '项目空间', icon: Target },
  { path: '/ipd/requirements', label: '需求管理', icon: ClipboardText },
  { path: '/ipd/products', label: '产品空间', icon: Package },
  { path: '/ipd/bids', label: '研发招募', icon: Handshake },
  { path: '/ipd/changes', label: '变更管理', icon: ArrowsClockwise },
  { path: '/ipd/documents', label: '资料库', icon: FolderOpen },
  { path: '/ipd/reviews', label: '阶段确认', icon: ShieldCheck },
  { path: '/ipd/performance', label: '协同绩效', icon: ChartBar },
  { path: '/ipd/timeline', label: '全流程轨迹', icon: BookOpen },
  { path: '/ipd/reports', label: '报表分析', icon: ChartBar },
  { path: '/ipd/handover', label: '项目移交', icon: Users },
  { path: '/ipd/product-catalog', label: '产品目录', icon: Package, adminOnly: true },
  { path: '/ipd/identity-sync', label: '人员同步', icon: Database, adminOnly: true },
  { path: '/ipd/admin', label: '超级管理', icon: Gear, adminOnly: true },
];

const roleNames: Record<string, string> = {
  GROUP_LEADER: '产品组长',
  RD_PM: '研发PM',
  SUPER_ADMIN: '超级管理员',
};

const person = computed(() => auth.identity?.person);
const roleName = computed(
  () => roleNames[person.value?.personType ?? ''] ?? '市场PM',
);
const visibleNav = computed(() =>
  navItems.filter((item) => !item.adminOnly || person.value?.personType === 'SUPER_ADMIN'),
);

function isActive(path: string): boolean {
  if (route.path === path) return true;
  if (path === '/ipd/workbench') return false;
  return route.path.startsWith(`${path}/`);
}

/** 原型六阶段常量（StageRail）：code 对齐后端 Project.currentStage 枚举。 */
const stages = [
  { code: 'CONCEPT', name: '概念' },
  { code: 'PLAN', name: '计划' },
  { code: 'DEV', name: '开发' },
  { code: 'VALID', name: '验证' },
  { code: 'LAUNCH', name: '发布' },
  { code: 'LIFECYCLE', name: '生命周期' },
];
const today = new Intl.DateTimeFormat('zh-CN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}).format(new Date());

/** 顶栏项目下拉：listProjects() 拉全量；切换等价原型 refresh(projectId)。 */
const projects = ref<Project[]>([]);
const currentProjectId = ref('');
const CURRENT_PROJECT_KEY = 'ipd:current-project';

onMounted(async () => {
  try {
    projects.value = await listProjects();
    const saved = window.localStorage.getItem(CURRENT_PROJECT_KEY);
    currentProjectId.value =
      projects.value.some((p) => p.id === saved) && saved
        ? saved
        : (projects.value[0]?.id ?? '');
  } catch {
    projects.value = [];
  }
  void loadNotifications();
  notifTimer = setInterval(() => {
    fetchUnreadCount()
      .then((count) => (unreadCount.value = count))
      .catch(() => {});
  }, 60_000);
});

onUnmounted(() => {
  if (notifTimer) clearInterval(notifTimer);
});

const currentProject = computed(
  () => projects.value.find((p) => p.id === currentProjectId.value) ?? projects.value[0],
);

/** 项目选项文案：原型为「名称 · 负责人」；后端暂无负责人字段，回退项目编号。 */
function projectLabel(p: Project): string {
  return p.code ? `${p.name} · ${p.code}` : p.name;
}

/** 切换全局当前项目：持久化后整页刷新，复刻原型 bootstrap 重载语义。 */
function switchProject(id: string) {
  if (id === currentProjectId.value) return;
  window.localStorage.setItem(CURRENT_PROJECT_KEY, id);
  window.location.reload();
}

const collapsed = ref(false);

const searchOpen = ref(false);
const notificationsOpen = ref(false);
const helpOpen = ref(false);

/** V12-a11y 收口：三弹窗共享键盘陷阱（开聚焦/Tab 循环/Esc 关闭/关还焦）。
 *  陷阱对象独立避免打开态竞争（onEscape 只关自身，其他 ref 不动）。 */
const searchDialog = ref<HTMLElement | null>(null);
const notificationsDialog = ref<HTMLElement | null>(null);
const helpDialog = ref<HTMLElement | null>(null);
useFocusTrap({ target: searchDialog, active: searchOpen, onEscape: () => (searchOpen.value = false) });
useFocusTrap({ target: notificationsDialog, active: notificationsOpen, onEscape: () => (notificationsOpen.value = false) });
useFocusTrap({ target: helpDialog, active: helpOpen, onEscape: () => (helpOpen.value = false) });

/**
 * 站内通知（页03 站内信 / OPS-05，卡 df7eba96）：消费侧 4 端点；
 * receiver 恒从会话推导（SEC-API-01），readFlag "0"=未读。60s 轮询红点。
 */
const ipdNotifications = ref<IpdNotification[]>([]);
const unreadCount = ref(0);
const notifLoading = ref(false);
const notifOnlyUnread = ref(false);

async function loadNotifications() {
  notifLoading.value = true;
  try {
    ipdNotifications.value = await listNotifications(notifOnlyUnread.value);
    unreadCount.value = await fetchUnreadCount();
  } catch {
    // 拉取失败不打断 Shell：保留旧列表，红点等下轮刷新
  } finally {
    notifLoading.value = false;
  }
}

function toggleNotifications() {
  notificationsOpen.value = !notificationsOpen.value;
  searchOpen.value = false;
  if (notificationsOpen.value) void loadNotifications();
}

async function handleNotifRead(item: IpdNotification) {
  try {
    await markNotificationRead(item.id);
    await loadNotifications();
  } catch {
    message.error('标记已读失败，请稍后重试');
  }
}

async function handleNotifReadAll() {
  try {
    await markAllNotificationsRead();
    message.success('全部已读');
    await loadNotifications();
  } catch {
    message.error('操作失败，请稍后重试');
  }
}

/** 点击通知：未读则先标读；携带站内 actionUrl 且为站内路径时跳转。 */
function openNotification(n: IpdNotification) {
  if (n.readFlag !== '1') void handleNotifRead(n);
  if (n.actionUrl && n.actionUrl.startsWith('/')) {
    notificationsOpen.value = false;
    void router.push(n.actionUrl);
  }
}

let notifTimer: undefined | ReturnType<typeof setInterval>;

async function handleLogout() {
  await auth.logout();
  router.push('/auth/login');
}
</script>

<template>
  <div class="ipd-app" :class="{ 'sidebar-collapsed': collapsed }">
    <a class="ipd-skip-link" href="#main">跳到主内容</a>
    <header class="topbar">
      <div class="top-brand">
        <div class="top-logo"><img :src="ipdLogoUrl" alt="" /></div>
        <strong>IPD 工作台</strong>
      </div>
      <label class="top-project">
        项目：
        <select
          :value="currentProjectId"
          data-testid="ipd-project-select"
          @change="switchProject(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="p in projects" :key="p.id" :value="p.id">
            {{ projectLabel(p) }}
          </option>
        </select>
        <CaretDown :size="14" weight="bold" />
      </label>
      <div class="top-actions">
        <button aria-label="搜索" type="button" @click="searchOpen = !searchOpen; notificationsOpen = false">
          <MagnifyingGlass />
        </button>
        <button aria-label="通知" class="notification" type="button" @click="toggleNotifications">
          <Bell />
          <i v-if="unreadCount > 0" class="notif-dot" />
        </button>
        <button aria-label="帮助" type="button" @click="helpOpen = true">
          <Question />
        </button>
        <div class="user-chip">
          <img :src="avatarUrl" :alt="person?.name ?? ''" />
          <span>
            <strong>{{ person?.name ?? '未登录' }}</strong>
            <small>{{ roleName }}</small>
          </span>
          <CaretDown :size="13" />
        </div>
        <button aria-label="退出登录" type="button" @click="handleLogout">
          <SignOut />
        </button>
      </div>
    </header>

    <aside class="sidebar">
      <nav id="ipd-sidebar-nav" data-testid="ipd-sidebar-nav">
        <router-link
          v-for="item in visibleNav"
          :key="item.path"
          :aria-current="isActive(item.path) ? 'page' : undefined"
          :class="{ active: isActive(item.path) }"
          :title="collapsed ? item.label : undefined"
          :to="item.path"
        >
          <component :is="item.icon" :size="19" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
      <button
        aria-controls="ipd-sidebar-nav"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? '展开侧栏' : '收起侧栏'"
        class="collapse"
        type="button"
        @click="collapsed = !collapsed"
      >
        <ArrowLeft :size="16" />
        {{ collapsed ? '展开' : '收起' }}
      </button>
    </aside>

    <main id="main" class="main-area" tabindex="-1">
      <div class="stage-rail" data-testid="ipd-stage-rail">
        <div
          v-for="(stage, index) in stages"
          :key="stage.code"
          :class="{ active: currentProject?.currentStage === stage.code }"
          class="stage-node"
        >
          <span>{{ index + 1 }}</span>
          <strong>{{ stage.name }}</strong>
          <i v-if="index < stages.length - 1" />
        </div>
        <div class="today">
          <CalendarBlank :size="16" />
          今天 {{ today }}
          <small>时区：Asia/Shanghai</small>
        </div>
      </div>
      <router-view />
    </main>

    <button
      v-if="platformBridgeEnabled"
      aria-label="切换到 AI 管理平台"
      class="global-ai-entry platform-switch"
      data-testid="ipd-platform-switch"
      :disabled="switching"
      type="button"
      @click="goPlatform"
    >
      <Gear weight="fill" />
      <span>
        <strong>AI 管理平台</strong>
        <small>对话 · 智能体 · 知识库 · 系统管理</small>
      </span>
    </button>

    <button
      aria-label="打开 AI 副驾"
      class="global-ai-entry"
      data-testid="ipd-ai-entry"
      type="button"
      @click="router.push('/ipd/ai-assistant')"
    >
      <Robot weight="fill" />
      <span>
        <strong>AI 副驾</strong>
        <small>随时生成、补漏与识别风险</small>
      </span>
    </button>

    <!-- 帮助弹窗：文案与原型 help-modal 1:1 -->
    <div v-if="helpOpen" class="modal-backdrop" @click.self="helpOpen = false">
      <div
        ref="helpDialog"
        aria-label="当前页面帮助"
        aria-modal="true"
        class="create-modal help-modal"
        role="dialog"
        tabindex="-1"
      >
        <div class="modal-head">
          <div>
            <Question />
            <span>
              <strong>当前页面帮助</strong>
              <small>系统按“产品 → 项目 → 阶段 → 动作 → 跨角色任务”组织工作</small>
            </span>
          </div>
          <button aria-label="关闭" type="button" @click="helpOpen = false"><X /></button>
        </div>
        <div class="create-form">
          <p>“我的工作台”汇总所有角色待办；进入项目动作时，左侧展示SOP、中央填写产物、右侧执行质量与AI检查。</p>
          <p>审批、移交、变更、绩效和结项都会投递给下一责任人，并同步生成通知和审计记录。</p>
        </div>
      </div>
    </div>

    <!-- 全局搜索 / 站内通知：壳与原型一致，数据等待 P4-3.1 聚合接口 -->
    <div v-if="searchOpen" class="modal-backdrop" @click.self="searchOpen = false">
      <div
        ref="searchDialog"
        aria-label="全局搜索"
        aria-modal="true"
        class="create-modal help-modal"
        role="dialog"
        tabindex="-1"
      >
        <div class="modal-head">
          <div>
            <MagnifyingGlass />
            <span>
              <strong>全局搜索</strong>
              <small>项目 / 产品 / 需求 / 文档统一入口</small>
            </span>
          </div>
          <button aria-label="关闭" type="button" @click="searchOpen = false"><X /></button>
        </div>
        <div class="create-form">
          <p>全局搜索等待后端聚合接口（P4-3.1）交付后接入。</p>
        </div>
      </div>
    </div>
    <div v-if="notificationsOpen" class="modal-backdrop" @click.self="notificationsOpen = false">
      <div
        ref="notificationsDialog"
        aria-label="站内通知"
        aria-modal="true"
        class="create-modal help-modal"
        role="dialog"
        tabindex="-1"
      >
        <div class="modal-head">
          <div>
            <Bell />
            <span>
              <strong>站内通知</strong>
              <small>未读 {{ unreadCount }} 条 · 站内提醒不依赖企微</small>
            </span>
          </div>
          <button aria-label="关闭" type="button" @click="notificationsOpen = false"><X /></button>
        </div>
        <div class="create-form">
          <div class="mb-2 flex items-center justify-between">
            <label class="flex items-center gap-1 text-sm">
              <input v-model="notifOnlyUnread" type="checkbox" @change="loadNotifications" />
              仅看未读
            </label>
            <button
              :disabled="unreadCount === 0"
              class="ipd-link-btn"
              type="button"
              @click="handleNotifReadAll"
            >
              全部已读
            </button>
          </div>
          <p v-if="notifLoading" class="text-sm text-gray-400">正在加载通知……</p>
          <p v-else-if="ipdNotifications.length === 0" class="text-sm text-gray-400">
            {{ notifOnlyUnread ? '没有未读通知' : '暂无通知' }}
          </p>
          <ul v-else class="notif-list">
            <li
              v-for="n in ipdNotifications"
              :key="n.id"
              :class="{ 'is-unread': n.readFlag !== '1' }"
              class="notif-item"
              @click="openNotification(n)"
            >
              <div class="notif-title">
                <em v-if="n.kind === 'ACTION'" class="notif-badge">待办</em>
                {{ n.title ?? '(无标题)' }}
              </div>
              <p v-if="n.content" class="notif-content">{{ n.content }}</p>
              <small class="text-gray-400">{{ n.createTime ?? '' }}</small>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* ==== 站内通知（卡 df7eba96）：铃铛红点 + 面板列表 ==== */
.ipd-app .topbar .notification {
  position: relative;
}
.ipd-app .notif-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--red);
  border: 1px solid var(--navy);
}
.ipd-app .notif-list {
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.ipd-app .notif-item {
  padding: 8px 6px;
  cursor: pointer;
  border-bottom: 1px solid var(--line);
}
.ipd-app .notif-item.is-unread .notif-title {
  font-weight: 700;
}
.ipd-app .notif-item:hover {
  background: var(--blue-soft);
}
.ipd-app .notif-title {
  font-size: 14px;
}
.ipd-app .notif-badge {
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  font-size: 11px;
  font-style: normal;
  color: var(--blue);
  background: var(--blue-soft);
  border-radius: 8px;
}
.ipd-app .notif-content {
  margin: 2px 0;
  font-size: 12px;
  color: var(--muted);
}
.ipd-app .ipd-link-btn {
  font-size: 13px;
  color: var(--blue);
  cursor: pointer;
  background: none;
  border: none;
}
.ipd-app .ipd-link-btn:disabled {
  color: var(--muted);
  cursor: not-allowed;
}

/* ==== ZK-IPD Shell（1:1 搬运自原型 styles.css，作用域限定 .ipd-app）==== */
/* V12-F2 暗色补全：局部色板别名改挂 ipd-theme.css 的 --ipd-* 全局 token，
 * html.dark 下自动翻转（--navy #071426→#0d1b2a 等），浅色渲染值与原型 1:1 一致。 */
.ipd-app {
  --navy: var(--ipd-navy);
  --navy-2: var(--ipd-navy-2);
  --blue: var(--ipd-blue);
  --blue-dark: var(--ipd-blue-dark);
  --blue-soft: var(--ipd-blue-soft);
  --green: var(--ipd-green);
  --red: var(--ipd-red);
  --amber: var(--ipd-amber);
  --text: var(--ipd-text);
  --muted: var(--ipd-muted);
  --line: var(--ipd-line);
  min-height: 100vh;
  background: var(--ipd-bg);
  color: var(--text);
}
.ipd-app .topbar {
  position: fixed;
  inset: 0 0 auto 0;
  height: 56px;
  display: flex;
  align-items: center;
  z-index: 50;
  color: white;
  background: var(--navy);
  border-bottom: 1px solid #1e2b3d;
}
.ipd-app .top-brand {
  width: 180px;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 0 19px;
  border-right: 1px solid #273246;
}
.ipd-app .top-logo { width: 32px; height: 34px; overflow: hidden; flex: 0 0 auto; }
.ipd-app .top-brand strong { font-size: 17px; white-space: nowrap; }
.ipd-app .top-project {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 22px;
  color: #cdd5e2;
  font-size: 13px;
}
.ipd-app .top-project select {
  max-width: 340px;
  color: white;
  background: transparent;
  border: 0;
  outline: none;
  appearance: none;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
/* V12-F1：outline:none 的替代——键盘聚焦时显式 token 焦点环（同特异性压过上方 none） */
.ipd-app .top-project select:focus-visible {
  outline: var(--ipd-focus-ring-width) solid var(--ipd-focus-ring-color);
  outline-offset: var(--ipd-focus-ring-offset);
}
.ipd-app .top-project select option { color: #253044; background: white; }
.ipd-app .top-actions {
  margin-left: auto;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 3px;
  padding-right: 12px;
}
.ipd-app .top-actions > button {
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #d9e0ea;
  display: grid;
  place-items: center;
  cursor: pointer;
  font-size: 19px;
  position: relative;
}
.ipd-app .top-actions > button:hover { background: #18263a; }
.ipd-app .user-chip {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
}
.ipd-app .user-chip img {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #354258;
}
.ipd-app .user-chip span { display: grid; line-height: 1.25; min-width: 70px; }
.ipd-app .user-chip strong { font-size: 12px; }
.ipd-app .user-chip small { color: #aeb9ca; font-size: 10px; }

.ipd-app .sidebar {
  position: fixed;
  top: 56px;
  bottom: 0;
  left: 0;
  width: 164px;
  z-index: 40;
  background: var(--navy-2);
  color: #d6deeb;
  display: flex;
  flex-direction: column;
}
.ipd-app .sidebar nav { padding: 10px 7px; overflow-y: auto; }
.ipd-app .sidebar a {
  height: 43px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 13px;
  color: #dbe3ee;
  text-decoration: none;
  border-radius: 5px;
  font-size: 13px;
  margin-bottom: 3px;
}
.ipd-app .sidebar a:hover { background: rgb(255 255 255 / 5.5%); }
.ipd-app .sidebar a.active {
  background: var(--blue);
  color: white;
  box-shadow: 0 4px 13px rgb(26 77 221 / 35%);
}
.ipd-app .collapse {
  margin: auto 10px 14px;
  height: 38px;
  border: 0;
  color: #a9b5c7;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
}
.ipd-app .main-area { min-height: 100vh; margin-left: 164px; padding-top: 56px; padding-bottom: 96px; }
.ipd-app.sidebar-collapsed .sidebar { width: 70px; }
.ipd-app.sidebar-collapsed .sidebar a span,
.ipd-app.sidebar-collapsed .collapse { display: none; }
.ipd-app.sidebar-collapsed .sidebar a { justify-content: center; padding: 0; }
.ipd-app.sidebar-collapsed .main-area { margin-left: 70px; }

.ipd-app .stage-rail {
  height: 72px;
  background: var(--ipd-surface);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: stretch;
  padding-left: 42px;
  position: sticky;
  top: 56px;
  z-index: 30;
}
.ipd-app .stage-node {
  min-width: 145px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: #616b7e;
  position: relative;
  padding: 0 13px;
}
.ipd-app .stage-node > span {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #e5e8ed;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  z-index: 1;
}
.ipd-app .stage-node strong { font-size: 13px; white-space: nowrap; z-index: 1; }
.ipd-app .stage-node i {
  position: absolute;
  height: 2px;
  width: 44px;
  background: #dfe3ea;
  right: -22px;
  top: 35px;
}
.ipd-app .stage-node.active {
  color: var(--blue);
  border-bottom: 3px solid var(--blue);
}
.ipd-app .stage-node.active > span { background: var(--blue); color: white; }
.ipd-app .stage-node.active i { background: var(--blue); }
.ipd-app .today {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #4e586d;
  padding: 0 28px;
  font-size: 12px;
  white-space: nowrap;
}
.ipd-app .today small { display: block; margin-left: 4px; color: #8b94a4; }

.ipd-app .global-ai-entry {
  position: fixed;
  z-index: 45;
  right: 22px;
  bottom: 22px;
  min-width: 190px;
  min-height: 54px;
  padding: 9px 14px;
  border: 0;
  border-radius: 12px;
  color: white;
  background: linear-gradient(135deg, #2f6bff, #6b5cff);
  cursor: pointer;
  box-shadow: 0 8px 22px rgb(47 107 255 / 28%);
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  font-size: 16px;
}
.ipd-app .global-ai-entry svg { font-size: 25px; }
.ipd-app .global-ai-entry span { display: grid; gap: 2px; }
.ipd-app .global-ai-entry strong { font-size: 14px; }
.ipd-app .global-ai-entry small { opacity: 0.82; font-size: 10px; }
/* AI 管理平台切换（2026-09-06 owner 指令：移至左下角，AI 副驾留右下角）；深蓝区分管理平台身份 */
.ipd-app .global-ai-entry.platform-switch {
  right: auto;
  bottom: 22px;
  left: 22px;
  background: linear-gradient(135deg, #0f3a66, #1d5c8f);
  box-shadow: 0 8px 22px rgb(15 58 102 / 30%);
}
.ipd-app .global-ai-entry:disabled { cursor: default; opacity: 0.72; }

.ipd-app .modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgb(10 18 32 / 55%);
  display: grid;
  place-items: center;
  padding: 20px;
}
.ipd-app .create-modal {
  width: min(560px, 100%);
  background: var(--ipd-surface);
  border-radius: 12px;
  box-shadow: 0 24px 60px rgb(9 18 33 / 0.3);
  overflow: hidden;
}
.ipd-app .modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--line);
}
.ipd-app .modal-head > div { display: flex; align-items: center; gap: 12px; }
.ipd-app .modal-head svg { font-size: 24px; color: var(--blue); }
.ipd-app .modal-head span { display: grid; }
.ipd-app .modal-head strong { font-size: 16px; }
.ipd-app .modal-head small { color: var(--muted); font-size: 11px; }
.ipd-app .modal-head > button {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  color: var(--muted);
  display: grid;
  place-items: center;
}
.ipd-app .create-form { padding: 20px; display: grid; gap: 12px; }
.ipd-app .create-form p { margin: 0; color: #4d586c; line-height: 1.7; font-size: 13px; }

/* ==== V12-F2 暗色模式布局层补全 ====
 * 浅色硬编码值保留 ZK-IPD 原型 1:1（真理源不暗色）；以下仅在 html.dark 下
 * 把依附浅色表面的配套色（边线 / 文字 / 圆点 / 选项弹层）切到 --ipd-* token 体系。
 * 容器 / 卡片 / 分隔线本体已在上方改挂 token（--ipd-bg / --ipd-surface / --line）。 */
html.dark .ipd-app .topbar { border-bottom-color: #223049; }
html.dark .ipd-app .top-brand { border-right-color: #223049; }
html.dark .ipd-app .top-actions > button:hover { background: var(--ipd-navy-2); }
html.dark .ipd-app .top-project select option {
  color: var(--ipd-text);
  background: var(--ipd-surface);
}
html.dark .ipd-app .stage-node { color: var(--ipd-muted); }
html.dark .ipd-app .stage-node > span { background: #223049; }
html.dark .ipd-app .stage-node i { background: var(--ipd-line); }
html.dark .ipd-app .today { color: var(--ipd-muted); }
html.dark .ipd-app .today small { color: var(--ipd-muted); }
html.dark .ipd-app .create-form p { color: var(--ipd-muted); }
</style>
