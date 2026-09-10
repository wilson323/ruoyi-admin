# workbench 前端分组渲染接入点评估（只读探针）

- 日期：2026-09-08
- 评审范围：
  - `/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue`
  - `/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/timeline/index.vue`
  - `/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/api/ipd/workbench.ts`
- 评审性质：纯只读探针；不改业务代码、不动 vue/ts 源文件、不 commit/push
- 后端计划（来自任务背景）：`taskType` 从 1 类扩展到 17 类，前端按 `taskType` 分组渲染并支持过滤参数
- 结论先抛：**当前前端对 `taskType` 字段完全无感**（既不展示、也不分组、也不过滤；只在 `WorkbenchTask` 类型上声明、测试 fixture 里出现）；改造必须先在 i18n 字典 + enums 字典两端补齐"17 类 taskType 中文映射"，再决定分组维度（taskType 一级 / projectName 二级 或 反之），最后才动模板与样式。

---

## §1 当前渲染现状（带行号证据）

### 1.1 任务列表：平铺 → 按 projectName 二级分组（**不按 taskType 分组**）

`workbench/index.vue` 已有"分组"逻辑，但分组 key 是 `projectName`，**不是 taskType**：

- [`/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue#L86-L91`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue)
  ```ts
  /** 责任队列：后端 tasks 平铺 → 按项目分组（真实 stage_action）。 */
  interface TaskGroup {
    projectName: string;
    count: number;
    items: { kind: string; title: string; desc: string; code: string; initiator: string; time: string; overdue: boolean }[];
  }
  ```
- [`workbench/index.vue#L103-L127`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue) 实际分组逻辑：
  ```ts
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
    ...
  });
  ```
  - 入参 `tasks` 是后端平铺数组（来自 `summary.value.tasks`）
  - 第 1 步筛选：仅 `overdue` tab 按 `t.priority === 'high'` 过滤；其他 tab 不做服务端/客户端筛选
  - 第 2 步按 `t.projectName` 分组（fallback `'未命名项目'`）
  - `taskType` 字段在整段 computed 中**完全未读**

### 1.2 已有过滤 tab（**但不是 taskType tab**）

- [`workbench/index.vue#L62`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue)：
  ```ts
  const activeTab = ref<'completed' | 'followed' | 'initiated' | 'overdue' | 'pending'>('pending');
  ```
- [`workbench/index.vue#L68-L84`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue) 五 tab 清单：
  | key | label | 计数来源 |
  |---|---|---|
  | `pending` | 待我处理 | `stats.pending` |
  | `initiated` | 我发起的 | `null`（TODO(P4-3.1)） |
  | `overdue` | 临期/超期 | `stats.overdue` |
  | `completed` | 已完成 | `stats.completed` |
  | `followed` | 我的关注 | `null`（TODO(P4-3.1)） |
- 模板渲染位置 [`workbench/index.vue#L186-L242`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue)
  - 5 个 tab 按钮（L189-L200）
  - `pending` / `overdue` 渲染任务队列；其他 3 个渲染占位文案（L210-L212）
  - 任务队列：`<div v-for="g in taskGroups">`（L217）+ `<article v-for="it in g.items">`（L222-L239）

### 1.3 顶层 4 metric 卡（与 taskType 无关）

- [`workbench/index.vue#L52-L60`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue)：4 metric 由 `summary.stats.{pending, overdue, unread, completed}` 渲染，**与 taskType 无关**
- 模板 [`workbench/index.vue#L170-L184`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue)

### 1.4 任务条 UI 当前用到的字段

- [`workbench/index.vue#L116-L125`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue)：
  ```ts
  items: items.map((t) => ({
    kind: STATUS_TEXT[t.status] ?? t.status,                    // ← status
    title: t.title ?? t.actionCode ?? '阶段动作',                // ← title / actionCode
    desc: `责任角色 ${t.ownerRole ?? 'BOTH'} · ${t.isBlocking === '1' ? '阻断项' : '非阻断'}`,  // ← ownerRole / isBlocking
    code: t.projectCode ?? '',                                  // ← projectCode
    initiator: '',                                              // ← 留空（未接）
    time: formatDue(t.dueDate),                                 // ← dueDate
    overdue: typeof t.dueDate === 'number' && t.dueDate < Date.now(),  // ← dueDate
  })),
  ```
- 模板显示区 [`workbench/index.vue#L222-L239`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue)：`kind`（tag）/ `title` / `desc` / `code` / `time` + 红字 overdue

---

## §2 taskType 字段前端使用情况（grep 结果）

### 2.1 类型层：已声明，但实现层未消费

- [`/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/api/ipd/workbench.ts#L20-L35`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/api/ipd/workbench.ts)：
  ```ts
  export interface WorkbenchTask {
    id: string;
    projectId: string;
    projectName: null | string;
    projectCode: null | string;
    actionCode: null | string;
    title: null | string;
    taskType: string;          // ← 声明在此
    status: string;
    priority: 'high' | 'normal';
    ownerRole: null | string;
    dueDate: null | number | string;
    isBlocking: null | string;
    deepLink: string;
  }
  ```
- 顶栏注释 [`workbench.ts#L1-L10`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/api/ipd/workbench.ts)：当前 backend 端 `tasks` 描述为 "stage_action 平铺"（隐含 taskType=STAGE_ACTION 单类）

### 2.2 全仓 grep：taskType 仅出现在类型声明 + 测试 fixture，**无 UI 消费**

```
$ grep -rn "taskType" apps/web-antd/src --include="*.ts" --include="*.vue"
apps/web-antd/src/api/ipd/workbench.ts:27         (interface 字段声明)
apps/web-antd/src/api/ipd/workbench.test.ts:76    (fixture: STAGE_ACTION)
apps/web-antd/src/api/graph/model.d.ts:26         (GraphQL 模型，非工作台)
apps/web-antd/src/views/ipd/workbench/index.test.ts:21,27   (fixture: STAGE_ACTION)
apps/web-antd/src/views/ipd/timeline/index.test.ts:32       (fixture: STAGE_ACTION)
```

- `workbench/index.vue` 0 处引用
- `timeline/index.vue` 0 处引用
- `_shared/ipd-enums.ts` 0 处引用（**没有 `TASK_TYPE_TEXT` 映射表**）
- `locales/langs/{zh-CN,en-US}/*.json` 0 处引用（**i18n 字典里没有 taskType**）

### 2.3 其它 WorkbenchTask 字段使用情况（grep 实证）

`workbench/index.vue` 4 处使用：

| 字段 | 行号 | 用途 |
|---|---|---|
| `status` | L93 / L117 | `STATUS_TEXT` 查表，fallback 原值；`STATUS_TEXT` 来自 `WORKBENCH_TASK_STATUS_TEXT`（仅 3 个 key：`NOT_STARTED/IN_PROGRESS/DELAYED`，见 `_shared/ipd-enums.ts:295-299`） |
| `priority` | L106 | `overdue` tab 的筛选条件 `t.priority === 'high'` |
| `ownerRole` | L119 | 拼到 desc 文案，fallback `'BOTH'`；原值直接显示，未走 `ROLE_TEXT` 翻译 |
| `isBlocking` | L119 | `'1' ? '阻断项' : '非阻断'`，中文硬编码 |
| `projectName` | L110 | 分组 key（fallback `'未命名项目'`） |
| `projectCode` | L120 | 任务条元数据 `code` |
| `dueDate` | L122-L124 | `formatDue()` 渲染 + 超期判定 |
| `title` / `actionCode` | L118 | 任务标题回退 |
| `id` / `projectId` / `deepLink` / `taskType` | — | **未消费** |

`timeline/index.vue` 4 处使用：

| 字段 | 行号 | 用途 |
|---|---|---|
| `task.status` | L110 | timeline 条目的 `status` |
| `task.title` / `actionCode` / `id` | L111 | timeline summary 拼接 |
| `task.dueDate` | L104 | timeline 条目的时间戳 |
| `task.projectName` / `projectId` | L111 | 拼接项目名 |
| `task.deepLink` | L108 | timeline 详情 |
| `taskType` / `ownerRole` / `priority` / `isBlocking` | — | **未消费** |

### 2.4 字典现状（关键参考）

- [`/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/_shared/ipd-enums.ts#L295-L299`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/_shared/ipd-enums.ts)：
  ```ts
  /** 工作台任务状态中文（NOT_STARTED/IN_PROGRESS/DELAYED）。 */
  export const WORKBENCH_TASK_STATUS_TEXT: Record<string, string> = {
    DELAYED: '已延期',
    IN_PROGRESS: '进行中',
    NOT_STARTED: '未开始',
  };
  ```
- 同文件同段**无 `WORKBENCH_TASK_TYPE_TEXT`** 或类似映射（grep 实证 0 匹配）
- `locales/langs/zh-CN/page.json` 全文仅 16 行，只有 `auth` + `dashboard` 两个 key（`workbench` 域 0 个 i18n key）
- `locales/langs/en-US/page.json` 与 zh-CN 平行结构，同样无 workbench 域

---

## §3 改造清单（最小改动列表，每条带行号）

> 说明：以下清单按"未来真要接 taskType 分组"的最小工作面列出；本任务为只读探针，**清单不要求本轮实施**，仅作下一轮 PR 的施工图。

### 3.1 类型与 API 层（最小）

| # | 位置 | 现状 | 改造点（最小） |
|---|---|---|---|
| 3.1.1 | [`workbench.ts#L27`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/api/ipd/workbench.ts) | `taskType: string` 已是 string | **不需改**；如后端要精确枚举，可窄化为 union（`STAGE_ACTION \| ...` 等 17 项），但需等后端枚举清单 |
| 3.1.2 | [`workbench.ts#L56-L60`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/api/ipd/workbench.ts) | `fetchWorkbenchSummary(projectId?: string)` | **需要扩展**为 `fetchWorkbenchSummary(params?: { projectId?: string; taskType?: string \| string[] })`；当前实现 `projectId ? { projectId } : undefined` 仅支持单 key 查询；多过滤项时需重构。`ipdGet` 工具是否支持多 value 需查 `api/ipd/http.ts`（本轮未读） |
| 3.1.3 | [`workbench.ts#L5`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/api/ipd/workbench.ts) 注释 | `GET /workbench/summary?projectId=` | 注释需补 `&taskType=...&taskType=...`（多值）的后端约定 |

### 3.2 字典层（**最关键、最先做**）

| # | 位置 | 现状 | 改造点（最小） |
|---|---|---|---|
| 3.2.1 | [`_shared/ipd-enums.ts#L295-L299`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/_shared/ipd-enums.ts) | `WORKBENCH_TASK_STATUS_TEXT` 已存在 | **追加** `WORKBENCH_TASK_TYPE_TEXT: Record<string, string>`，枚举后端 17 类；命名与现有 `WORKBENCH_*_TEXT` 系列对齐 |
| 3.2.2 | 同上 `priorityText/roleText/severityText` 模式（L42-L121） | 已建立 `xxxText(..., fallback)` 函数模式 | 同步加 `taskTypeText(type, fallback)` 函数 |
| 3.2.3 | `locales/langs/zh-CN/page.json` | 仅 16 行 | **新增** `workbench.taskType.<KEY>` 共 17 个 key（即便字典值与 enums 重复，也提供 i18n 通道） |
| 3.2.4 | `locales/langs/en-US/page.json` | 与 zh-CN 平行 | **同步新增** 17 个英文 key |
| 3.2.5 | `_shared/ipd-enums.test.ts` L177-179 | 已测试 `WORKBENCH_TASK_STATUS_TEXT` | 同步补 `WORKBENCH_TASK_TYPE_TEXT` 的字典测试 |

### 3.3 工作台模板与脚本（**最复杂、最后做**）

> 设计选择必须在 §3.2 字典就绪后才能定型；本节列"如果决定按 taskType 一级 / projectName 二级"方案的最小改动。

| # | 位置 | 现状 | 改造点（最小） |
|---|---|---|---|
| 3.3.1 | [`workbench/index.vue#L86-L91`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue) | `interface TaskGroup { projectName; count; items[] }` | **重塑**为 `interface TaskGroup { taskType; label; projectGroups: ProjectGroup[]; total; }`（二级嵌套）或平铺为 `{ taskType; projectName; items[] }`（一级二级都保留，扁平渲染） |
| 3.3.2 | [`workbench/index.vue#L103-L127`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue) `taskGroups` computed | 按 `projectName` 分组 | 改为"按 `taskType` 一级分组 → 内部按 `projectName` 二级" 或 "按 `projectName` 一级 → 内部按 `taskType` 二级" |
| 3.3.3 | [`workbench/index.vue#L62`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue) `activeTab` | 5 个状态 tab | **不需新增** tab 维度（taskType 分组独立于 5 状态 tab 存在）；可保持现状 |
| 3.3.4 | [`workbench/index.vue#L217-L241`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue) 模板 | 一级 `v-for="g in taskGroups"` + 内部 `v-for="it in g.items"` | 二级时需嵌套两层 `v-for`；一级 taskType 标题行可加 `<Tag color>` 区分类型（参考 `STAGE_TONE` / `STATUS_TONE` 配色机制） |
| 3.3.5 | [`workbench/index.vue#L119`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue) `desc` 拼字符串 | `责任角色 ${ownerRole ?? 'BOTH'} · ${isBlocking === '1' ? '阻断项' : '非阻断'}` | 不需改；如果想展示 taskType，可加到 `kind`（如 `kind: '${TASK_TYPE_TEXT[taskType]}/${STATUS_TEXT[status]}'`） |
| 3.3.6 | [`workbench/index.vue#L539`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue) `.ipd-wb-group + .ipd-wb-group` | 已有间距样式 | 二级嵌套时需新增 `.ipd-wb-subgroup` 同名 + 选择器 |
| 3.3.7 | [`workbench/index.vue#L541-L549`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/workbench/index.vue) `.ipd-wb-group-title` | 单一标题样式 | 二级时需新增 `.ipd-wb-subgroup-title`（缩进、字号更小） |

### 3.4 timeline 视图（轻）

| # | 位置 | 现状 | 改造点（最小） |
|---|---|---|---|
| 3.4.1 | [`timeline/index.vue#L103-L113`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/timeline/index.vue) `workbenchTaskToEntry` | `summary: '待办：${title} · ${projectName}'` | 如想让 taskType 进入 timeline summary，可拼 `${TASK_TYPE_TEXT[taskType]}/${title}`（**不破坏现有时间倒序语义**） |
| 3.4.2 | [`timeline/index.vue#L55`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/timeline/index.vue) `scopeFilter` | 4 类 ALL/AUDIT/WORKBENCH/BONUS | 不需新增 taskType filter（按类别过滤足够，避免爆炸） |
| 3.4.3 | [`timeline/index.vue#L174-L177`](/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/timeline/index.vue) `Promise.allSettled` 拉取 | `fetchWorkbenchSummary()` 无参 | 如果工作台按 taskType 过滤后，timeline 看到的就是该过滤后的视图；**建议 timeline 始终拉"全部 taskType"**（即不传 taskType 参数）以保持"全流程轨迹"语义 |

### 3.5 测试与回归

| # | 位置 | 现状 | 改造点（最小） |
|---|---|---|---|
| 3.5.1 | `apps/web-antd/src/api/ipd/workbench.test.ts` L107-L111 | 已断言"仅导出 fetchWorkbenchSummary" | 如 3.1.2 改签名，此处需同步；但导出名不变则断言继续成立 |
| 3.5.2 | `apps/web-antd/src/api/ipd/workbench.test.ts` L46-L58 | 测了 3 种 projectId 行为 | 需新增"传 taskType 编码进查询串"测试 |
| 3.5.3 | `apps/web-antd/src/views/ipd/workbench/index.test.ts` L16-L38 | fixture 全是 `STAGE_ACTION` | 需补 17 类至少 1-2 类 fixture；新增"按 taskType 分组渲染"的测试用例 |
| 3.5.4 | `apps/web-antd/src/views/ipd/timeline/index.test.ts` L32 | fixture 是 `STAGE_ACTION` | 视 3.4.1 决定是否需补多 taskType fixture |
| 3.5.5 | `apps/web-antd/src/views/ipd/_shared/ipd-enums.test.ts` L177-179 | 仅测 `WORKBENCH_TASK_STATUS_TEXT` | 补 `WORKBENCH_TASK_TYPE_TEXT` 测试 |

---

## §4 与 timeline/index.vue 的差异

| 维度 | workbench/index.vue | timeline/index.vue |
|---|---|---|
| 入口端点 | `fetchWorkbenchSummary()` 无参（L137） | `fetchWorkbenchSummary()` 无参（L176），与 audit/bonus `Promise.allSettled` 并发 |
| 数据用途 | **任务队列是主视图**；4 metric + 任务列表 + 当前推进 + 删除审批 | **工作台仅是三源之一**；与审计日志、奖金池按 `createTime/dueDate/createTime` 时间倒序融合呈现 |
| 任务列表形态 | **分组渲染**（按 projectName，二级项目名 + 项目内 task item） | **平铺渲染**（每个 task 一个 TimelineItem） |
| 任务过滤 | 5 状态 tab（pending/initiated/overdue/completed/followed） | 1 个类别 Select（ALL/AUDIT/WORKBENCH/BONUS） + 关键词搜索 |
| taskType 使用 | **未使用**（即便类型已声明） | **未使用** |
| 文案来源 | 中文硬编码（`"继续当前IPD动作"` 等），混用 `WORKBENCH_TASK_STATUS_TEXT` / `ROLE_TEXT` 字典 | 中文硬编码（`"审计事件"`、`"奖金池"`），用 `formatDateTime` / `PENDING_TEXT` 工具 |
| 错误处理 | 失败 → `loadError` 占位文案（L209） | 失败 → `errorMsg` + `isNetwork` 区分（rejectText 处理 IpdRequestError，L75-L82） |
| currentAdvance 使用 | 主视图右侧"我的当前推进"卡片（L246-L268） | 仅作为 `bonusEntries` 的 `projectId` 推断来源（L182-L184），不在 timeline 渲染 |
| 渲染组件 | 4 metric 卡 + 自定义 div 队列 | ant-design-vue `Timeline` + `TimelineItem` + `Tag` |
| `ipd-backend` meta 注释 | 在 `.vue` 顶部 L2-L8 写明后端真值（G-04 / 2026-09-06） | 在 `defineOptions.meta` 写明三源融合（L48-L52） |
| 视觉样式 | 自定义 CSS（`.ipd-wb-*`），V12-F3 断点 768px | ant-design-vue 默认 + 工具类 `flex flex-wrap gap-3` |
| **是否需要分组改造** | **是**（这是 taskType 分组的主要消费方） | **不需分组**（timeline 语义是"全流程时间倒序"，分组破坏语义） |

**关键差异结论**：
- workbench 与 timeline 共享 `fetchWorkbenchSummary()` 同一数据源，但渲染目标完全不同；
- taskType 分组是 **workbench 单方**的需求，timeline 不应受影响（保持平铺时间线）；
- 如果 `fetchWorkbenchSummary` 签名扩展（如 §3.1.2），timeline 调用方需显式不传 taskType 参数（即"全部拉取"），避免 timeline 视图被 taskType 过滤破坏。

---

## §5 改造代价（按小→中→大排）

### 5.1 【小】P0-字典先行（建议最优先开工）

**目标**：补齐 17 类 taskType 的中文映射 + i18n key，让后续 UI 改造有数据可消费。
**改动面**：
- `apps/web-antd/src/views/ipd/_shared/ipd-enums.ts`：追加 `WORKBENCH_TASK_TYPE_TEXT` + `taskTypeText()` 函数（参考 `WORKBENCH_TASK_STATUS_TEXT` / `priorityText` 模式，~30 行）
- `apps/web-antd/src/locales/langs/zh-CN/page.json`：追加 `workbench.taskType.<17KEY>` 17 个 i18n key（~17 行）
- `apps/web-antd/src/locales/en-US/page.json`：同步 17 行
- `apps/web-antd/src/views/ipd/_shared/ipd-enums.test.ts`：补字典测试（~5 行）
- **不需要改任何 .vue 文件**
- **风险**：低，纯数据加法；后端枚举值变更再回头补即可
- **预计**：0.5 工时

### 5.2 【小】API 签名扩展

**目标**：让 `fetchWorkbenchSummary` 支持按 taskType 过滤。
**改动面**：
- `apps/web-antd/src/api/ipd/workbench.ts` L56-L60：把单 `projectId?: string` 改成 `params?: { projectId?: string; taskType?: string \| string[] }`；查询串拼装逻辑要支持多 value（如 `?taskType=STAGE_ACTION&taskType=DELAYED`）
- 需先读 `apps/web-antd/src/api/ipd/http.ts` 确认 `ipdGet` 是否支持 `Record<string, unknown>` 入参（推测支持，但本轮未读 §3.1.2 标"待确认"）
- `apps/web-antd/src/api/ipd/workbench.test.ts` L107-L111 导出名断言不变；L46-L58 三种 projectId 测试需改写为新 params 入参；补 taskType 单值/多值测试
- `apps/web-antd/src/views/ipd/workbench/index.vue` L137 调用方改 `await fetchWorkbenchSummary()` → 视分组方案决定是否传参
- `apps/web-antd/src/views/ipd/timeline/index.vue` L176 调用方保持 `await fetchWorkbenchSummary()`（不传参，保持全量）
- **预计**：0.5-1 工时（依赖 http.ts 现状）

### 5.3 【中】workbench 模板分组改造

**目标**：把 §3.3.2 的"按 projectName 分组"改为"按 taskType 一级 + projectName 二级"（或反之，由设计拍板）。
**改动面**：
- `apps/web-antd/src/views/ipd/workbench/index.vue` L86-L91（`TaskGroup` interface 重塑）
- `apps/web-antd/src/views/ipd/workbench/index.vue` L103-L127（`taskGroups` computed 重写分组逻辑）
- `apps/web-antd/src/views/ipd/workbench/index.vue` L217-L241（模板嵌套 `v-for`）
- `apps/web-antd/src/views/ipd/workbench/index.vue` L539-L549（CSS 增 `.ipd-wb-subgroup-title`）
- `apps/web-antd/src/views/ipd/workbench/index.test.ts` L16-L38 fixture 补 17 类（至少 2-3 类），新增"按 taskType 分组"的 mount 测试
- **风险**：中，模板改动会影响 DOM 结构和 a11y（tag 标题层级、focus 顺序），需视觉回归 + a11y check
- **预计**：1-1.5 工时（不含设计拍板时间）

### 5.4 【中】timeline summary 增强（可选）

**目标**：让 timeline 条目的 summary 显示 taskType 前缀，便于审计追溯。
**改动面**：
- `apps/web-antd/src/views/ipd/timeline/index.vue` L103-L113 `workbenchTaskToEntry` 改 summary 字符串
- `apps/web-antd/src/views/ipd/timeline/index.test.ts` L32 fixture 补多 taskType（如需）
- **风险**：低，仅文本增强
- **预计**：0.25-0.5 工时

### 5.5 【大】taskType 过滤 tab（如果做）

**目标**：在工作台新增 17 个 taskType 过滤 tab 或多选下拉。
**改动面**：
- 5 状态 tab + 17 taskType tab 同时存在的二维过滤结构（activeTab + activeTaskType）
- `apps/web-antd/src/views/ipd/workbench/index.vue` L62 扩展 `activeTab` 类型；L68-L84 `queueTabs` 改二维；新增 `activeTaskType` 状态
- L186-L200 模板增 17 个按钮或多选 `<Select>`
- L103-L127 computed 增加 `activeTaskType` 二次过滤
- 与后端聚合 `?taskType=...&taskType=...` 配合（无后端聚合时纯前端 filter 性能可接受）
- **风险**：高
  - 17 个 tab 视觉爆炸，需改 design（建议改"多选下拉 + 选中徽标"而非平铺 tab）
  - 与 5 状态 tab 交互复杂度上升（多选叠加、单选互斥）
  - 需要真值源明确"taskType 维度的计数"是否由后端聚合返回（当前 stats 不含）
- **预计**：2-3 工时（不含 design 拍板 + 真值源对接）

### 5.6 改造路线建议

1. **先 §5.1（小，0.5h）** → 把字典铺好，**所有后续改造都可以直接消费 `taskTypeText()`**
2. **再 §5.2（小，0.5-1h）** → API 签名扩展，让前端有能力向后端传过滤意图
3. **§5.3（中，1-1.5h）** → 工作台分组改造，**最直接回应"17 类分组渲染"**
4. **§5.4（中，0.25-0.5h）** → timeline 增强（可选，不阻塞主线）
5. **§5.5（大，2-3h）** → taskType 过滤 tab（**需设计先行**，建议 P 轮排期）
6. **完整链路**：~5-7 工时不含设计 + 回归

### 5.7 改造面统计

| 类别 | 文件数 | 行数（粗估） |
|---|---|---|
| 字典/枚举 | 3（enums.ts + 2 i18n） | ~50-70 |
| API 层 | 2（workbench.ts + workbench.test.ts） | ~30-50 |
| 模板/脚本 | 1（workbench/index.vue） | ~80-120 |
| 样式 | 1（workbench/index.vue scoped） | ~15-25 |
| 测试 | 3（workbench.test + workbench/index.test + timeline/index.test） | ~40-60 |
| timeline 增强（可选） | 1-2 | ~10-20 |
| **合计（含 timeline）** | ~9-10 | **~225-345** |
| **合计（不含 timeline）** | ~7-8 | **~215-325** |

---

## 红线确认

- ✅ 未修改 `apps/web-antd/src/views/ipd/workbench/index.vue`
- ✅ 未修改 `apps/web-antd/src/views/ipd/timeline/index.vue`
- ✅ 未修改 `apps/web-antd/src/api/ipd/workbench.ts`
- ✅ 未 commit / 未 push
- ✅ 输出文档落到 `docs/ipd-系统说明/`，文件名按约定带日期

## Summary of Changes

- **探针性质**：纯只读评估，0 行业务代码改动；本报告为下一轮 PR 的施工图。
- **核心发现**：`workbench/index.vue` 当前**已分组**渲染（按 `projectName` 二级），**但完全未消费 `taskType` 字段**（grep 实证 0 引用）；`WorkbenchTask.taskType` 虽在 `workbench.ts:27` 类型已声明，仅出现在 3 处测试 fixture（`workbench.test.ts:76`、`workbench/index.test.ts:21,27`、`timeline/index.test.ts:32`）。
- **改造最小路径**：[§5.1 字典先行] → [§5.2 API 签名扩展] → [§5.3 workbench 分组改造]；timeline 不需分组（语义破坏），仅 §5.4 文本增强可选。
- **关键阻塞**：当前 `_shared/ipd-enums.ts` **没有 `WORKBENCH_TASK_TYPE_TEXT` 映射**（只有 3 key 的 `WORKBENCH_TASK_STATUS_TEXT`），`locales/langs/{zh-CN,en-US}/page.json` 也**没有任何 workbench 域 i18n key**（仅 16 行含 auth + dashboard）；后端 17 类枚举值清单未给到之前无法开工。
- **timeline 侧注意点**：`timeline/index.vue` 与 `workbench/index.vue` 共享同一 `fetchWorkbenchSummary()` 端点，但语义完全不同（融合时间线 vs 分组任务队列）；若 §5.2 改 API 签名，timeline 调用方必须**显式不传 taskType**（保持全量），避免时间线被 taskType 过滤破坏。
- **建议**：先把 17 类 taskType 枚举值清单（来自后端）和"分组维度选择"（taskType 一级 vs projectName 一级）这两件事拍板，再决定本轮是否进入 P 轮排期。
