<script setup lang="ts">
/**
 * 页03 工作台（卡 P0-10.3，后端聚合接口 P4-3.1 未交付）。
 * 当前形态：身份问候（按时辰）+ 4 metric 占位卡 + 14 个快捷入口。
 * 聚合卡片等待后端交付后接入。
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { Alert, Card } from 'ant-design-vue';

import { useIpdAuthStore } from '../../../store/ipd-auth';
import '../_shared/ipd-theme.css';

const auth = useIpdAuthStore();
const router = useRouter();

const roleText = computed(() => {
  const type = auth.identity?.person.personType;
  if (type === 'SUPER_ADMIN') return '超级管理员';
  if (type === 'GROUP_LEADER') return '产品组长';
  if (type === 'RD_PM') return '研发PM';
  return '市场PM';
});
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

interface MetricCard { label: string; note: string; tone: 'default' | 'danger' | 'warning'; }
/** ZK-IPD 工作台 4 metric 占位（待后端聚合接口 P4-3.1 接入真实值）。 */
const metrics: MetricCard[] = [
  { label: '待我处理', note: '按责任链实时投递', tone: 'default' },
  { label: '临期 / 超期', note: '优先处理阻断项', tone: 'danger' },
  { label: '未读通知', note: '站内提醒不依赖企微', tone: 'warning' },
  { label: '已完成', note: '全过程可追溯', tone: 'default' },
];

interface QuickEntry { desc: string; path: string; ready: boolean; title: string }
const entries: QuickEntry[] = [
  { title: '我的工作台', desc: '当前页面', path: '/ipd/workbench', ready: true },
  { title: '我的项目', desc: '查看并管理参与的项目', path: '/ipd/projects', ready: true },
  { title: '产品管理', desc: '产品目录与新增/编辑', path: '/ipd/products', ready: true },
  { title: '招标组队', desc: '招标、应标与遴选', path: '/ipd/bids', ready: true },
  { title: '删除审核-我的申请', desc: '我发起的删除申请', path: '/ipd/deletion/my-requests', ready: true },
  { title: '删除审核-待我审核', desc: '组长初审 / 超管终审', path: '/ipd/deletion/review', ready: true },
  { title: '删除归档', desc: '已处理的删除存根', path: '/ipd/deletion/archive', ready: true },
  { title: '组织架构', desc: '第三方托管·禁止本地修改', path: '/ipd/admin/org', ready: true },
  { title: 'SOP 模板', desc: '深/轻管 SOP 版本与发布', path: '/ipd/admin/sop-template', ready: true },
  { title: 'AI 模型配置', desc: '大模型参数与权限', path: '/ipd/admin/ai-models', ready: true },
  { title: '阶段确认模板', desc: '阶段评审要素库', path: '/ipd/cert/templates', ready: true },
  { title: '审计日志', desc: '关键操作全程留痕', path: '/ipd/audit/logs', ready: true },
  { title: '需求门户（游客）', desc: '免登录提交需求', path: '/portal/submit', ready: true },
  { title: '需求门户查询（游客）', desc: '凭查询码查进度', path: '/portal/track', ready: true },
];

function open(entry: QuickEntry) {
  if (entry.ready) router.push(entry.path);
}
</script>

<template>
  <div class="p-4">
    <Card class="mb-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-semibold">{{ greeting }}</h2>
          <p class="text-muted-foreground mt-1 text-sm">当前角色：{{ roleText }}</p>
        </div>
      </div>
    </Card>

    <!-- ZK-IPD 工作台 4 metric 占位（等 P4-3.1 后端聚合接口接入） -->
    <div
      class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="workbench-metrics"
    >
      <Card v-for="m in metrics" :key="m.label" class="ipd-metric">
        <div class="text-muted-foreground text-xs">{{ m.label }}</div>
        <div
          class="text-2xl font-bold"
          :class="{
            'text-amber-500': m.tone === 'warning',
            'text-red-500': m.tone === 'danger',
          }"
        >—</div>
        <div class="text-muted-foreground text-xs">{{ m.note }}</div>
      </Card>
    </div>

    <Alert
      class="mb-4"
      message="任务队列、当前推进、AI 副驾与 KPI/激励概览等待后端聚合接口（P4-3.1）交付后接入。"
      show-icon
      type="info"
    />

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card
        v-for="entry in entries"
        :key="entry.path"
        :class="['cursor-pointer transition-shadow', entry.ready ? 'hover:shadow-md' : 'opacity-60']"
        @click="open(entry)"
      >
        <template #title>
          <span>{{ entry.title }}</span>
          <span v-if="!entry.ready" class="text-muted-foreground ml-2 text-xs">（等待后端）</span>
        </template>
        <Card.Meta :description="entry.desc" />
      </Card>
    </div>
  </div>
</template>
