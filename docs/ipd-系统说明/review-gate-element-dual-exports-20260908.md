# gate-element API 双导出冗余评估（只读探针）

- 日期：2026-09-08
- 范围：仅前端 `apps/web-antd/src/api/ipd/`，不动业务代码、不 commit/push
- 结论先抛：**保留双轨（无任何改动需要做）**。两函数名异、端点异、消费者异；drift-guard 当前不会阻断，也不需白名单。

---

## 1. 当前导出清单（grep 实测，行号带证）

### 1.1 `apps/web-antd/src/api/ipd/gate-element.ts`（84 行，管理端）

| 导出 | 行 | 端点 | 消费者 |
|---|---|---|---|
| `IpdGateCode` (type) | 15 | — | 仅类型 |
| `IPD_GATE_CODES` (const) | 16 | — | admin/gate-elements/index.vue:199, 292 |
| `IpdGateElement` (interface) | 18 | — | admin/gate-elements/index.vue:10, 60, 122 |
| `IpdGateElementCreateReq` (interface) | 32 | — | 同上 |
| `IpdGateElementUpdateReq` (interface) | 43 | — | 同上 |
| `listGateElements` (function) | **66** | `GET /api/v1/gate-elements` | **admin/gate-elements/index.vue:99** |
| `createGateElement` (function) | 72 | `POST /api/v1/gate-elements` | admin/gate-elements/index.vue:158 |
| `updateGateElement` (function) | 77 | `POST /api/v1/gate-elements/{id}/update` | admin/gate-elements/index.vue:155 |
| `disableGateElement` (function) | 82 | `POST /api/v1/gate-elements/{id}/disable` | admin/gate-elements/index.vue:176 |

### 1.2 `apps/web-antd/src/api/ipd/gate-element-result.ts`（138 行，评审页）

| 导出 | 行 | 端点 | 消费者 |
|---|---|---|---|
| `GateElementResult` (type) | 17 | — | 仅类型 |
| `IpdGateElementView` (interface) | 20 | — | review/gate-panel.vue、gate-panel-complete-render.test.ts |
| `IpdGateElementResultReq` (interface) | 34 | — | 同上 |
| `IpdGateElementResultView` (interface) | 42 | — | 同上 |
| `listGateElementViews` (function) | **51** | `GET /api/v1/gates/{gateId}/elements` | **review/gate-panel.vue:203**、gate-element-result.test.ts:26 |
| `submitGateElementResult` (function) | 56 | `POST /api/v1/gates/{gateId}/element-results` | review/gate-panel.vue:175、gate-element-result.test.ts:35 |
| `closeGateElementResult` (function) | 61 | `POST /api/v1/gates/{gateId}/element-results/{resultId}/close` | gate-element-result.test.ts:43 |
| `countVetoFailures` (function) | 69 | 纯函数 | review/gate-panel.vue:42, 114 |
| `FALLBACK_GATE_ELEMENTS` (const) | 85 | 静态回退（33 项） | review/gate-panel.vue、gate-panel-complete-render.test.ts:16 |
| `isFallbackElement` (function) | 131 | 纯函数 | review/gate-panel.vue:44, 432 |
| `getFallbackGateElements` (function) | 136 | 纯函数 | review/gate-panel.vue:43, 207, 216 |

### 1.3 测试文件存在性

| 文件 | 状态 |
|---|---|
| `apps/web-antd/src/api/ipd/gate-element.test.ts` | **不存在**（仅 `gate-element-result.test.ts`） |
| `apps/web-antd/src/api/ipd/gate-element-result.test.ts` | 67 行，存在 |

> 旁注：admin 端无单测不是本任务范围（仅记下事实）。

---

## 2. 全仓调用 grep 实证

```
$ grep -rn "listGateElements\b" --include="*.ts" --include="*.vue"
apps/web-antd/src/api/ipd/gate-element-result.ts:49  (注释，命名区分说明)
apps/web-antd/src/views/ipd/admin/gate-elements/index.vue:37,99
apps/web-antd/src/api/ipd/gate-element.ts:66

$ grep -rn "listGateElementViews\b" --include="*.ts" --include="*.vue"
apps/web-antd/src/api/ipd/gate-element-result.test.ts:6,26
apps/web-antd/src/views/ipd/review/gate-panel.vue:45,203
apps/web-antd/src/api/ipd/gate-element-result.ts:51
```

**两个函数全仓各只有 1 个业务调用方，且调用方完全不同**：
- `listGateElements` → admin 端的 `views/ipd/admin/gate-elements/index.vue`
- `listGateElementViews` → review 端的 `views/ipd/review/gate-panel.vue`

---

## 3. 是否重复？——互补，非重复

| 维度 | `listGateElements`（管理端） | `listGateElementViews`（评审页） |
|---|---|---|
| 后端端点 | `GET /api/v1/gate-elements` | `GET /api/v1/gates/{gateId}/elements` |
| 路径片段 | `/gate-elements`（平台级要素库） | `/gates/{gateId}/elements`（评审实例下的要素视图） |
| 鉴权 | 仅超管可见（GateElementController） | 评审成员可见（GateElementResultController） |
| 过滤参数 | `?gate=G1..G5`（可选，按 Gate 过滤） | `gateId` 必填（评审实例维度） |
| 返回类型 | `IpdGateElement`（`enabled`/`isVeto` 是 `'1'/'0'` 字符串） | `IpdGateElementView`（`isVeto` 是 `boolean`，多 `status`/`title`/`code`/`description`/`thresholdJson` 字段） |
| 业务目的 | 维护 33 项要素定义（CRUD + 停用） | 评审时拉取视图态要素用于勾选判定 + 命中否决项硬阻断 |
| 关联写入 | `create/update/disableGateElement` | `submit/closeGateElementResult` |

**结论**：两者同属"评审要素"语义，但**端点、参数、返回结构、鉴权、写入语义全部不同**。将其视为冗余是误判，应视为"管理域 / 评审域"两套边界清晰的契约。

---

## 4. drift-guard 钩子影响评估

> 文件：`/Users/mac/Documents/ruoyi-ai/.claude/helpers/ipd-frontend-drift-guard.cjs`（251 行）

**钩子行为**（基于源码 §172–221）：
1. 仅拦截 `Write/Edit/MultiEdit` 对 `apps/web-antd/src/api/ipd/*.ts` 的写入；
2. 对"新增"导出（出现在新内容、不在原文件已有导出集合中）做"全 `api/ipd/` 同名冲突"扫描；
3. 名称异 → 不阻断；同名 → 阻断。

**当前两函数名对比**：

```
listGateElements     ← admin
listGateElementViews ← review
```

名字已异（P4 收口轮已完成重命名）。drift-guard 的"同名导出"检查在当前状态下**不会触发**，因为它只比较导出名是否相同。

**评估结论**：
- 不需要白名单。当前状态钩子是放行的。
- 任何后续修改如果只是**修改函数体**或**追加接口字段**，不会触发"新增导出"扫描，也无需白名单。
- 唯一会触发阻断的情景：未来有人在 `gate-element-result.ts` 里新增一个名叫 `listGateElements` 的函数（重蹈覆辙），或在 `gate-element-result.ts` 里加一个名叫 `createGateElement` 的函数 —— 此时钩子会按规则阻断，**这是预期行为**，白名单反而会削弱保护。

---

## 5. 明确建议：保留双轨，无改动

### 5.1 建议：**保留双轨**

理由汇总：
1. **端点不同**：admin 走平台要素库 `/gate-elements`；review 走评审实例 `/gates/{id}/elements`。无法合并为一个函数。
2. **返回结构不同**：`IpdGateElement` 是字符串型 `enabled/isVeto` 的"定义态"；`IpdGateElementView` 是布尔型 `isVeto` + 视图扩展字段的"使用态"。
3. **写入语义不同**：admin 有 CRUD；review 仅消费 + 提交判定。
4. **消费者互斥**：grep 证据表明两边各只有 1 个 .vue 业务调用，无交叉。
5. **drift-guard 友好**：函数名已分异，钩子不阻断。
6. **P4 重命名已完成**：从原 `listGateElements` 重命名为 `listGateElementViews` 是为了避免误导消费者（管理端 vs 评审页），命名区分已在 `gate-element-result.ts:48-50` 的 JSDoc 显式说明。

### 5.2 不推荐的方案（已排除）

| 方案 | 否决理由 |
|---|---|
| 合并到一个文件 | 两个端点/两组类型/两套消费者，物理合并会牺牲语义边界并放大耦合面 |
| 重命名 `listGateElements` → `listAdminGateElements` 之类 | admin 调用方仅 1 处（admin/gate-elements/index.vue:37,99），改名收益 < 改名成本，且 `listGateElements` 名字本身已是"语义自洽"的最小名 |
| 在 drift-guard 加白名单 | 当前无冲突，加白名单只会被误用为"绕开保护"的口子 |

### 5.3 若未来要做的预防措施（仅在真发生冲突时启用）

- 未来若新增 `gate-element-xxx.ts` 且需要复用 `IpdGateElement` 类型，应从 `gate-element.ts` `import type` 复用，不要在新文件里 `export interface IpdGateElement`（drift-guard 会按规则阻断，这就是想要的兜底）。
- `FALLBACK_GATE_ELEMENTS`（33 项种子）当前只在 review 端使用；如果未来 admin 端也要在"无后端数据时兜底展示 33 项"，应 **复用** 这份常量而非另写一份；类型 `IpdGateElementView` 与 `IpdGateElement` 字段不完全对齐，所以这里有个待办：
  - **未来可能需要 1 项重塑**：把 `FALLBACK_GATE_ELEMENTS` 的"管理端视图版"与"评审视图版"明确分开，否则会出现"admin 也想兜底 → 复制粘贴一份" → 维护分裂。但**这不是当前任务**，仅记下。

---

## 6. 最小改动路径

**当前状态已是目标状态。无最小改动路径。**

红线确认：
- ✅ 未修改 `apps/web-antd/src/api/ipd/*` 任何文件
- ✅ 未 commit / 未 push
- ✅ 输出文档落到 `docs/ipd-系统说明/`（不污染 `apps/`）

---

## 7. 附：drift-guard 钩子关键引用（行号）

- §31 FRONTEND_ROOT：`/Users/mac/Documents/ruoyi-ipd-web`
- §63–69 `listApiFiles`：列 `api/ipd/*.ts` 排除 `.test.ts`
- §71–92 `extractExports`：扫 `function`/`const`/`interface`/`type`
- §171–221 §3 函数级/Symbol 级冲突扫描：只对"新增导出"做同名阻断
- §192–207：跨文件同 `kind`+`name` 命中即 `process.exit(2)`

读到这里足够判断当前文件不会被钩子阻断。

---

## Summary of Changes

- **探针性质**：纯只读评估，0 行代码改动。
- **核心发现**：`listGateElements`（admin 端 `/api/v1/gate-elements`）与 `listGateElementViews`（review 端 `/api/v1/gates/{gateId}/elements`）**端点异、返回类型异、消费者异**，是互补关系而非冗余；P4 收口轮已完成的"重命名 + JSDoc 命名区分说明（gate-element-result.ts:48-50）"已彻底解决同名误导问题。
- **drift-guard 评估**：当前两函数名分异，钩子不阻断，**不需白名单**；白名单反而会削弱"新增同名导出"的兜底保护。
- **旁注（非本任务范围）**：`apps/web-antd/src/api/ipd/gate-element.test.ts` 不存在，admin 端 API 单测缺失，可作下个 P 轮候选。
- **明确建议**：保留双轨，无任何改动。
