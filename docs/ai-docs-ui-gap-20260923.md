# AI 文档助手 UI Gap 报告（2026-09-23）

## 背景

用户给了一段 AI 文档助手（`/ipd/ai-assistant` → `apps/web-antd/src/views/ipd/ai-docs/index.vue`）的 UI 文案与空状态提示语，以为这是还没实现的新页面。本会话摸排后对照 `index.vue` 现状 805 行，输出一份"现写代码 vs 这段文案"逐项 gap 报告，作为后续需求变更对账与兄弟会话在途识别的事实源。

不漂移：本报告只描述事实差异与产品决策点，不进入代码改动。如要落地改动需另起一轮，并按 [OPS-09 单一写入者规约] 与 [R25 软化三步法] 执行。

## 结论

- 80% 文案元素已在 `index.vue` 实现，**逐字一致**的占多数
- 唯一**结构不一致**点是"风险提示 + 文档标题 + 原始资料"的归属：当前代码拆到"AI 生成"独立卡片（line 472-514），用户文案把它们合并在"选择项目与文档类型"卡片里
- 现状代码 6 项**已被实现但文案未体现**的加分项（按钮级权限、状态机守卫、内容摘要比对、状态 tag 中文化、diff 染色、拒绝 Modal 双重校验）
- **因此本报告核心交付是「决策点」而非「改动」**：等用户拍板"AB 结构归属"再起新会话。

## ✅ 一致项（核对与现状匹配，无需动）

| 文案元素 | index.vue 行号 | 校验 |
|---|---|---|
| 顶部 Alert 全文（BR-AI-03/04 + 归档状态机） | `434-438` | 逐字一致 |
| 项目下拉「请选择项目」 | `456-463` | 一致 |
| 「AI 生成（录入原始资料 → 模型润色/补齐/标准化）」卡片标题 | `472` | 一致 |
| AI 生成风险提示（BR-AI-04） | `473-478` | 逐字一致 |
| 文档标题（max=200，show-count） | `480-487` / `519-521` | 一致 |
| 原始资料（max=30000，textarea，rows=8，show-count） | `489-495` | 一致 |
| 「登记外部 AI 输出（版本链 v1 锚点）」卡片 | `517-543` | 一致 |
| 文档内容（rows=6） | `522-524` | 一致 |
| 生成模型（max=64，Input） | `525-527` | 一致 |
| Token 消耗（提示词+补全 InputNumber min=0） | `528-533` | 一致 |
| 版本链 Empty「暂无版本链。请先登记 AI 输出，或输入文档 ID 加载。」 | `571` | 逐字一致 |
| 版本对比 Empty「暂无可对比的版本。请先加载版本链。」 | `654` | 逐字一致 |

## ⚠️ 唯一结构不一致点（待用户拍板）

**用户文案把以下 4 项合并在第一个卡片「选择项目与文档类型」**：

1. 风险提示 Alert（BR-AI-04 文案）
2. 文档标题（max=200）
3. 原始资料（max=30000）

**当前代码实际把它们拆到独立的「AI 生成」卡片**（line 472-514），而第一个卡片「选择项目与文档类型」只保留项目下拉与文档类型下拉（line 441-469）。

### 三种处置方式

| 选项 | 影响 | 建议适用 |
|---|---|---|
| **A. 现状正确**（用户文案笔误） | 不动代码，收口即结束 | 与 `docs/反思-ai-docs-bug-20260911.md` 提示的"卡片语义对齐"一致 |
| **B. 把风险提示 + 标题 + 原始资料下沉到第一个卡片** | 改 `index.vue` 把卡片二的 Form 与提交按钮整段下移到卡片一；需要补 Card 标题为「录入并生成」或保留「选择项目与文档类型」并改语义 | "录入即生成"极简心智场景 |
| **C. 拆解为三卡（项目/类型、生成、外部登记）** | 改 `index.vue` 把外部登记字段挪到第三卡片（已存在同标题），结构变化最小 | 与现状最贴近，但与用户文案差异最大 |

推荐 A：当前实现的卡片语义边界清晰（选择 vs 生成 vs 登记 vs 链 vs 对比），与单测断言（`index.test.ts` 卡片存在性）与权限码（`v-access:code` 跨卡片定位）耦合关系最小。

## 🔍 现状代码已实现但用户文案未体现的加分项

1. **按钮级权限守卫**：`v-access:code="IPD_PERMISSION_CODES.AI_DOCUMENT_CREATE/REVIEW/REVISE"` 三套权限码分别贴在生成/审核/拒绝/归档按钮上（`499` `535` `604` `614` `627`）
2. **状态机守卫**：GENERATED 仅渲染「审核通过/审核拒绝」、REVIEWED 仅渲染「归档」+ 提示「归档后不可再修改内容」、REJECTED 仅渲染只读 Alert（`590-643`）
3. **拒绝 Modal 双重校验**：Form rule 报错 + OK 按钮 `:disabled` 防绕过（`307-310`、`711`、`728-731`）
4. **版本对比内容一致性提示**：sha256 相同显示 `Alert type="info"`「两个版本的内容摘要一致」（`672-678`）
5. **diff 字段染色**：added 绿 / removed 红 line-through / modified 橙 / unchanged 灰（`371-376`）
6. **状态 tag 中文化**：`ARCHIVED/已归档`、`GENERATED/待审核`、`REJECTED/已拒绝`、`REVIEWED/已审核` 四态映射 + 未知态 fallthrough 到原值（`74-79` `247`）

文案里只提到「GENERATED/REVIEWED/ARCHIVED/REJECTED」四个英文枚举，没有体现这些"超越枚举"的实现细节。后续如需沉淀为规约文档，可把这 6 项列为"AI 文档助手实现规约"。

## 📋 后续行动指引（不漂移地分段列出）

- **本会话收口** → 落档本报告 → 单文件 commit → 不动代码
- **下一轮如拍板选项 B 或 C** → 起新会话，按 brainstorming → writing-plans → 实现的脑暴/规划/落地三段执行，先改卡片标题与 Form 归属，保持 `index.test.ts` 卡片断言同步更新，避免假绿
- **下游联调** → 任何 UI 改动都需走 `apps/web-antd/scripts/check-ipd-frontend-drift.sh` + `pnpm exec vitest run --config vitest.ipd.config.mts` + `pnpm run check:type` 三道门禁
- **看板同步** → 如本报告作为某卡证据提交，需在 PUT 后立即 GET 回读核验 desc_len/marker；本会话不动看板。

## 验证基线

- HEAD = `3264ac5`（main 分支，与 origin/main 同步）
- 工作树 clean（`git status --porcelain` 无输出，兄弟会话 in-progress 文件不在本会话范围）
- `apps/web-antd/src/views/ipd/ai-docs/index.vue` 805 行（实读）
- `apps/web-antd/src/api/ipd/ai-document.ts` 282 行，含 11 个 API 封装（generate/register/revise/review/archive/reject/listVersions/listByProject/history/diff/normalize）

## 引用规约

- [OPS-09 单一写入者守则] → `docs/ipd-系统说明/并发纪律.md`
- [R25 软化三步法] → `AGENTS.md` §「范围与路由」
- [AI 文档助手实现规约（待沉淀）] → 后续如拍板选项 B/C 时补
- [前端架构规约] → `docs/ipd-系统说明/前端架构规约-20260906.md`
