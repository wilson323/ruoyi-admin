# BackendPending 占位页摸底（2026-09-07）

> 摸底人：A11（占位页摸底线）
> 模式：只读摸底
> 范围：`apps/web-antd/src/views/ipd/**/index.vue` + `apps/web-antd/src/router/routes/modules/ipd.ts`
> 标尺：`docs/zk-ipd-consistency-收口-20260906.md §5`（drift #3 BackendPending 14% backlog）
> 关联约束文档：`/Users/mac/Documents/ruoyi-ai/docs/ipd-系统说明/前端对接/ZK-IPD一致性约束-20260906.md §5.2`

---

## 一、口径与方法

### 1.1 "占位页" 定义（按标尺 §5.2）

约束文档原文：

> 当前：2 个 vue 文件 + 1 个 router meta 引用，共 14 个占位页中仅 2 处显式引用

判定口径：
- **占位页** = 路由已存在 + 后端接口存在缺口 + 页内需要 `BackendPending` 标注卡号与依赖
- **BackendPending 显式引用** = `.vue` 文件中 `import BackendPending` + `<BackendPending ...>` 渲染
- **meta 接入** = 路由 meta 含 `ipdCard` / `ipdBackend` / `ipdNote` 字段

### 1.2 摸底动作

1. 统计路由 meta 中带 `ipdCard`/`ipdBackend` 的 13 项
2. 统计 `.vue` 文件中 `defineOptions({ meta: { ipdCard: ... } })` 的页面（部分与路由 meta 重复）
3. 统计 `<BackendPending>` 实际渲染点（仅 2 个文件）
4. 从 `git log` 反查已知卡号（`grep -oE "P0-10\.[0-9]+"`）
5. 与 §5 提出的 14% 与 14 占位页数核对

---

## 二、占位页清单（13 个 ipdCard 元信息已挂；doc 估计 14）

> **核对结论**：实际摸底只数到 **13 个 ipdCard 占位页**；doc §5.2 估的 "14" 多出 1 个，
> 推断为 doc 落稿时的圆整估计（13+1）。**14 个数字与现实有 1 个偏差**，需后端/产品补卡号补齐到 14。

| # | 路由 path | 文件 | 路由 meta `ipdCard` | `defineOptions` `ipdCard` | `ipdBackend` | 实际用 `<BackendPending>` |
|---|---|---|---|---|---|---|
| 1 | `/ipd/projects/:projectId/gates` | `project/detail/gates.vue` | ✅ `P0-10.23` | ✅ `P0-10.23` | ✅ 真（GateReviewController 已交付说明） | ❌（真实现） |
| 2 | `/ipd/projects/:projectId/change/:changeId` | `project/change-detail/index.vue` | ✅ `P0-10.25` | ✅ `P0-10.25` | ❌（缺） | ❌（真实现） |
| 3 | `/ipd/kpi/shared` | `kpi/shared/index.vue` | ✅ `P0-10.30` | ✅ `P0-10.30` | ❌（缺） | ❌（真实现） |
| 4 | `/ipd/kpi/project-score` | `kpi/project-score/index.vue` | ✅ `P0-10.31` | ✅ `P0-10.31` | ❌（缺） | ❌（真实现） |
| 5 | `/ipd/projects/:projectId/kpi` | `project/detail/kpi.vue` | ✅ `P0-10.32` | ✅ `P0-10.32` | ❌（缺） | ❌（真实现） |
| 6 | `/ipd/incentive/allowance` | `incentive/allowance/index.vue` | ✅ `P0-10.33` | ✅ `P0-10.33` | ✅ 真（AllowanceLedgerController 3 端点） | ❌（真实现） |
| 7 | `/ipd/incentive/bonus-pool` | `incentive/bonus-pool/index.vue` | ✅ `P0-10.34` | ✅ `P0-10.34` | ✅ 真（BonusPoolController 5 端点） | ❌（真实现） |
| 8 | `/ipd/incentive/contribution` | `incentive/contribution/index.vue` | ✅ `P0-10.35` | ✅ `P0-10.35` | ❌（缺） | ❌（真实现） |
| 9 | `/ipd/incentive/negative-feedback` | `incentive/negative-feedback/index.vue` | ✅ `P0-10.36` | ✅ `P0-10.36` | ❌（缺） | ❌（真实现） |
| 10 | `/ipd/projects/:projectId/incentive` | `project/detail/incentive.vue` | ✅ `P0-10.37` | ✅ `P0-10.37` | ❌（缺） | ✅ **1 处**（`<BackendPending>` 子页签整页占位） |
| 11 | `/ipd/timeline` | `timeline/index.vue` | ✅ `ZK-D2` | ✅ `ZK-D2` | ✅ 真（三源融合说明） | ❌（真实现） |
| 12 | `/ipd/identity-sync` | `admin/identity-sync/index.vue` | ✅ `P0-10.44` | ✅ `P0-10.44` | ❌（缺） | ❌（真实现） |
| 13 | `/ipd/kpi/functional` | `kpi/functional/index.vue` | ❌（**路由 meta 缺，仅 defineOptions**） | ✅ `P0-10.29` | ❌（缺） | ❌（真实现） |

**汇总**：
- `ipdCard` 已挂：**13/13**（100%——13 个占位页全部带 `ipdCard`）
- `ipdBackend` 已挂：**4/13**（30.77%——只 gates / timeline / allowance / bonus-pool 四页明确写了 ipdBackend 文案）
- `<BackendPending>` 渲染：**1/13**（7.69%——仅 project/detail/incentive.vue 1 处；changes.vue 也用但其 ipdCard 在 change-detail 不在本页）

### doc §5 标尺 vs 实际摸底

| 项 | doc §5.2 口径 | 摸底实测 | 偏差 |
|---|---|---|---|
| 占位页总数 | 14 个 | **13 个** | **-1**（doc 圆整 13→14） |
| BackendPending 引用 | 2 个 vue 文件 + 1 个 router meta | **3 处**（changes.vue×2 + incentive.vue×1 + 12 路由 meta 注入） | 不严格可比——doc "vue 文件" 算 **2** 是 changes.vue + incentive.vue |
| 使用率 | 14% | 详见 §三 | — |

---

## 三、使用率计算（精确数字）

> 标尺 §5.2 公式：「占位页中已通过 `BackendPending` 显式引用 / 占位页总数」

### 3.1 按 doc §5.2 字面定义

| 指标 | 计算 | 结果 |
|---|---|---|
| BackendPending 引用 vue 文件数 | `grep -l "import BackendPending" apps/web-antd/src/views/ipd/` | **2**（`project/detail/changes.vue` + `project/detail/incentive.vue`） |
| 占位页总数 | doc §5.2 估计 | **14** |
| **BackendPending 使用率（§5.2 字面）** | 2 / 14 | **14.29%**（与 doc 写的 14% 一致） |

### 3.2 按"已挂 meta"重新校准

| 指标 | 计算 | 结果 |
|---|---|---|
| 路由 meta 含 `ipdCard` 或 `ipdBackend` 的占位页 | 摸底 §二 | **13** |
| 其中用 `<BackendPending>` 的页面 | 仅 `project/detail/incentive.vue` | **1** |
| **实际使用率（meta 已挂为分母）** | 1 / 13 | **7.69%** |
| 路由 meta 含 `ipdBackend` 的占位页 | 摸底 §二 | **4**（gates / timeline / allowance / bonus-pool） |
| **ipdBackend 覆盖率** | 4 / 13 | **30.77%** |

> **校正观察**：doc 写的 14% 是 "2 vue 文件 / 14 占位页"，但 14 占位页本身是 doc 圆整估计。
> 如果以实测 13 占位页为分母，且以「真正用 `<BackendPending>` 渲染占位」为分子，
> **真实使用率只有 7.69%**——比 doc 估的 14% 更低。

### 3.3 changes.vue 与 change-detail 的关系

值得记录的歧义点：
- `project/detail/changes.vue`（路由 `IpdProjectChanges`，**无 ipdCard**）用了 2 处 `<BackendPending>`
- `project/change-detail/index.vue`（路由 `IpdChangeDetail`，`ipdCard: 'P0-10.25'`）**未用** `<BackendPending>`

doc 算 "2 个 vue 文件" 时把 changes.vue 算 1 个文件；change-detail 卡号相同但被算成 "1 个 router meta" 项。
**这两处共用 `P0-10.25` 卡号，但都没在 router meta 上挂 `ipdBackend` 标注后端依赖**。

---

## 四、卡号映射推断

### 4.1 已知卡号（13 个；占位页全数）

```
P0-10.23  Gate 评审（页23）              gates.vue                     后端已交付（GateReviewController）
P0-10.25  变更单详情（页25/26）          change-detail/index.vue       后端 GET /requirement-changes/{id} 已交付
P0-10.29  功能 KPI（页29）               kpi/functional/index.vue      后端 GET /kpi/functional 已交付
P0-10.30  共担 KPI 归集（页29-30）       kpi/shared/index.vue          后端 GET /kpi/shared 已交付
P0-10.31  项目绩效评定（页31）           kpi/project-score/index.vue   后端 ProjectScoreController 已交付
P0-10.32  项目详情-KPI（页32）           project/detail/kpi.vue        后端 GET /kpi/{performance,functional,trend} 已交付
P0-10.33  津贴台账（页33）               incentive/allowance/index.vue 后端 AllowanceLedgerController 3 端点
P0-10.34  奖金池核算（页34）             incentive/bonus-pool/index.vue 后端 BonusPoolController 5 端点
P0-10.35  贡献度评定（页35）             incentive/contribution/index.vue 后端 ContributionController 已交付
P0-10.36  负反馈执行（页36）             incentive/negative-feedback/index.vue 后端 NegativeFeedbackController 已交付
P0-10.37  项目详情-激励台账（页37）      project/detail/incentive.vue  后端部分：BonusPoolController 已；项目维聚合读端点缺
P0-10.44  人员同步（页44）               admin/identity-sync/index.vue 后端 GET /pm-directory 已；identity-source 端点缺
ZK-D2     全流程轨迹（裁决卡）           timeline/index.vue            无 timeline 聚合端点；三源融合真实现
```

来源：`git log --all --pretty=format:'%s' | grep -oE "P0-10\.[0-9]+" | sort -u` 反查 + 当前代码 `grep` 双向验证。

### 4.2 缺哪些卡号需后端/产品确认

> doc §5.2 标 14，实占 13。**差 1 个**——推断位置可能是以下三类之一：

| 推断类别 | 候选位置 | 置信度 | 依据 |
|---|---|---|---|
| **删除审核-列表** | `deletion/my-requests`、`deletion/review` | **中** | 页头注释明确写「列表查询未交付」（页04/05），实质是「已挂占位但无 ipdCard meta」 |
| **报表分析-缺口** | `report/index.vue` | **低-中** | 页头注释提到「原型 analytics 流程分析四卡/建议卡按原型渲染但数值区登记真缺口」 |
| **AI 文档助手-增强** | `ai-docs/index.vue` | **低** | 已交付控制器，但子模块（如批量解析）可能挂占位 |

**最高置信候选**：删除审核页 04/05（`my-requests/index.vue` + `deletion/review/index.vue`）——两个页头都明确写"列表端点待后端交付"，**符合占位页定义**，但路由 meta 与 defineOptions **都没挂 ipdCard**。

### 4.3 doc "14" 的来源推断

doc 写 "占位页总数 14" 大概率是把 13 个 `ipdCard` 占位页 + 1 个推断缺失页（很可能是删除审核列表）一起算。
**该缺失页的卡号需后端/产品提供**（P0-10.4 或 P0-10.5 之一，或其他未编号）。

---

## 五、达标 90% 路径评估

### 5.1 当前差距

| 维度 | 当前 | 目标 | 差距 |
|---|---|---|---|
| ipdCard 覆盖 | 13/13 = 100% | 14/14 = 100% | **需补 1 个 ipdCard**（卡号待后端/产品提供） |
| ipdBackend 覆盖 | 4/13 = 30.77% | ≥ 90% | **需补 9 个 ipdBackend** 文案（9 个占位页 meta 缺 ipdBackend） |
| `<BackendPending>` 实际渲染 | 1/13 = 7.69% | ≥ 90% | **需补 12 处 `<BackendPending>`** 渲染（12 个真实现但有缺口的占位页） |
| 后端依赖总览（meta 单源） | 部分分散 | meta 单源 | **需统一为 router meta**（目前 defineOptions 与 router meta 双写） |

### 5.2 是否具备立即提升到 90% 的条件

**条件评估**：**部分具备，立即全量达标需要外部信息输入**

| 子目标 | 是否可独立完成 | 阻塞 |
|---|---|---|
| 补 1 个占位页的 ipdCard | ❌ | 缺第 14 个占位页的卡号（候选：P0-10.4 / P0-10.5 / 其他；需产品/后端裁决） |
| 补 9 个 ipdBackend 文案 | ⚠️ 大部分可 | 4 个已知（gates / timeline / allowance / bonus-pool 有 ipdBackend 模板）；5 个需读 controller/service 真值推断（change-detail / kpi/shared / kpi/score / project/kpi / contribution / negative-feedback / identity-sync / project/incentive）——可独立推断 |
| 补 12 处 `<BackendPending>` 渲染 | ✅ 可独立完成 | 仅需复制 incentive.vue 模板模式，按页卡号挂占位区块 |
| meta 单源化（去 defineOptions 重复） | ✅ 可独立完成 | 13 个占位页全部双写，需要保留一处 |

### 5.3 推荐后续派单

**无需起 A13-A15**——理由：
- 缺 1 个卡号是**单一外部阻塞**，不构成需多 agent 并行的工作量
- 12 处 `<BackendPending>` 渲染补全是单卡片量（约 30~60 分钟/处，按模板复制）
- 9 个 ipdBackend 文案补全是读 controller/service 推断（约 15 分钟/处）
- 整体单卡工作量 doc 估 2h，与"立即提升到 90%"目标吻合

**推荐派单路径**：
1. **A12 卡号补全派单**（同步后端/产品，1 个缺失卡号 + 9 个 ipdBackend 文案终审）→ 阻塞解除
2. **A13 实施派单**（按模板批量补 12 处 `<BackendPending>` + 9 个 ipdBackend + 1 个新 ipdCard）→ 90% 目标
3. 不需要 A14/A15

**卡号补全确认问题清单**（交给 A12 派单）：
- Q1：删除审核-我的申请（页04 P0-10.4）列表读端点是否需要 BackendPending 占位？卡号确认？
- Q2：删除审核-待我审核（页05 P0-10.5）列表读端点是否需要 BackendPending 占位？卡号确认？
- Q3：报表分析-流程分析四卡/建议卡的卡号归属（P0-10.42?）？是否计入 14 占位页？
- Q4：除上述三类外，是否还有其他占位页 doc 漏算（如 AI 文档助手批量解析）？

---

## 六、结论

| 项 | 数值 | 与 doc §5.2 一致性 |
|---|---|---|
| 占位页总数 | **13**（doc 估 14，差 1） | ⚠️ 偏差 1，需补 1 个卡号 |
| `ipdCard` 覆盖率 | **13/13 = 100%** | ✅ 已达成 |
| `ipdBackend` 覆盖率 | **4/13 = 30.77%** | ❌ 距 90% 差 59.23pp |
| `<BackendPending>` 实际渲染率 | **1/13 = 7.69%** | ❌ 距 90% 差 82.31pp |
| doc "14%" 数值 | 2 vue 文件 / 14 占位页 = 14.29% | ✅ 数值正确但分母偏差 1 |
| 真实 BackendPending 使用率 | 1 / 13 = **7.69%** | ⚠️ 远低于 doc 报数 |

**核心结论**：
1. 占位页 meta `ipdCard` 已 100% 覆盖——**drift #3 的卡号问题已部分闭环**
2. 真实缺口在 **ipdBackend 文案补全**（差 9 处）+ **`<BackendPending>` 渲染补全**（差 12 处）
3. doc §5.2 标的 14% 是「vue 文件数 / 占位页数」，真实以"实际渲染占位页"为口径的使用率仅 **7.69%**——**drift #3 未根治，backlog 仍成立**
4. **无需起 A13-A15**，单卡 2h 即可提升到 ≥90%；缺 1 个卡号建议起 A12 派单同步外部

---

## 七、产出引用

| 文件 | 路径 | 角色 |
|---|---|---|
| 标尺文档 | `/Users/mac/Documents/ruoyi-ipd-web/docs/zk-ipd-consistency-收口-20260906.md` §5 | drift #3 量化基线 |
| 约束文档 | `/Users/mac/Documents/ruoyi-ai/docs/ipd-系统说明/前端对接/ZK-IPD一致性约束-20260906.md` §5.2 | 14 占位页定义来源 |
| 路由源 | `/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/router/routes/modules/ipd.ts` | 13 处 `ipdCard` meta 真源 |
| 占位组件 | `/Users/mac/Documents/ruoyi-ipd-web/apps/web-antd/src/views/ipd/_shared/backend-pending.vue` | 唯一占位渲染组件（兼容 props + meta） |
| 卡号已知集 | `git log --all --grep="P0-10" | grep -oE "P0-10\.[0-9]+" | sort -u` | 13 个已知卡号 |

---

**摸底人**：A11（占位页摸底线）
**完成时间**：2026-09-07
**未修改任何代码**
