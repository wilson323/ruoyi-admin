# AI 文档助手项目列表加载 bug — 深度反思报告

**报告日期**：2026-09-11
**触发事件**：ai-docs 页面下拉选项目恒显「项目列表加载失败」
**bug 存在时长**：至少 4 天（2026-09-07 真机形态变化 → 2026-09-11 main 分支修复）
**影响范围**：仅 ai-docs 页面，不涉及后端业务逻辑
**修复状态**：main 分支已修（commit `e1b0394` + 本报告所述「立即做」三项），integrated 分支 2026-09-10 已独立修过（commit `ed92376`）

---

## 事件回顾

**症状**：「AI 文档助手」页面打开时，下拉选项目恒显「项目列表加载失败」。

**触发路径**：`GET /projects` 真机返回 `{project:{id,code,name,...}, lastActivityAt, ...}` 包裹形态；页面级 `parseProjects` 直接读 `record.id`，对包裹结构解析必错。

**关键事实**：

| 时间 | commit | 改了什么 |
|---|---|---|
| 2026-09-07 | `4d50480` | `api/ipd/project.ts#normalizeProject` 加了 `nested.project` 解包裹逻辑，注释就写「真机 2026-09-07 实证：GET /projects 列表行是 {project:{...}} 包裹（头注『裸 List』已漂移）」——但**头注释没改**，fixture 作者后来仍按「裸 List」写 |
| 2026-09-07 | `824cb87` | 抢救 ai-docs 视图域（防 untracked 灭失），parseProjects 保留旧版 |
| 2026-09-10 | `ed92376`（**integrated 分支**） | 兄弟会话修了这个 bug：改走 `listProjectItems` + fixture 改包裹形态 + 加回归测试 |
| 2026-09-11 | `e1b0394`（**main 分支**） | 在 main 上重新修了一遍：改走 `listProjects`（不带派生字段）+ fixture 改包裹形态 |
| 2026-09-11 | 本报告所属 commit | 「立即做」三项收口（修头注释、改 listProjectItems、加 fixture 形态锁定测试）|

**两处修复差异**：
- integrated 用 `listProjectItems`（带 lastActivityAt/scenarioDaysRemaining/critical 派生字段）
- main 最初用 `listProjects`（无派生字段）
- ai-docs 页面只取 id/code/name，两个都行；但 listProjectItems 更准确（与项目空间列表页同款封装）

---

## 根因分析（4 层病根）

### 第 1 层：双真源（最直接）
页面级 `parseProjects` 与 api 层 `normalizeProject` 各自实现 GET /projects 解构，没有「所有 fetch 必须走 api 层」的硬约束。
- 4d50480 加 normalizeProject 解包裹时，**没人同步改 parseProjects**——因为 review 焦点在 api 层 diff，不会主动查页面层有没有同款解析
- 同样问题存在于 `project/detail/index.vue` 的 `parseProject`（已 commit `e1b0394` 同步处理）

### 第 2 层：文档注释与真机形态漂移（最早期的信号）
`api/ipd/project.ts` 头注释原本写「GET /projects 返回裸 List<Project>，无分页」——与真机的包裹形态不符。
- 4d50480 加 normalizeProject 的「裸 → 包裹」兼容逻辑时，**只改了 normalizeProject 内部注释，没改头注释**
- 后续 fixture 作者读到头注释就会写裸平铺 fixture
- 这条注释是「假绿」的根源——单测按假形状写，全绿掩护了真机 bug

### 第 3 层：跨分支修复未同步
integrated 分支 9 月 10 日就修了，main 分支 9 月 11 日才修——**整整晚 1 天**。
- 兄弟会话在 integrated 上完成 critical fix 后，没有触发「必须同步 main」的强制流程
- main 上没人主动 `git fetch integrated` 看是否有相关修复

### 第 4 层：测试目标偏移
原测试只测「解析器逻辑正确」，不测「真机形态下页面行为」。
- fixture 按假形状写，解析器按假形状写，单测全绿
- 没有「按真机形态写 fixture」的硬约束

---

## 防御层失效分析（为什么之前没发现）

7 道防线，**全部失效**：

| 防线 | 应能拦截 | 实际状态 |
|---|---|---|
| git 评审 | normalizeProject 加解包裹时识别「页面层同款解析要同步改」 | 失效：review 焦点在 api 层 diff |
| vitest 单测 | 真机形态 fixture 必须解析成功 | 失效：fixture 按假形状写 |
| e2e / 集成测试 | 浏览器打开页面应能看到项目下拉 | **没有 e2e** |
| 用户报错 | 打开页面应立刻看到失败提示 | 页面用得少，没暴露 |
| 生产监控 | API 错误率突增 | **无前端监控** |
| 跨分支同步 | integrated 修 critical 必须同步 main | **无门禁** |
| 文档注释校验 | 头注释与真机形态不符应被 lint 捕获 | **无** |

7 道防线全失效 = bug 长期潜伏。

---

## 改进建议（分档）

### 立即做（本周）

1. **修头注释**：`api/ipd/project.ts` 头注「裸 List」已漂移 → 改为「真机：{project:{...}} 包裹形态（2026-09-07 实证）」
2. **决策 listProjectItems vs listProjects**：ai-docs 改走 `listProjectItems`（与项目空间列表同款），避免派生字段语义漂移
3. **补回归测试**：ai-docs 项目列表加载加独立 describe，锁定包络形态（fixture 形态稳定性测试）

**本次 commit 已完成上述三项**。

### 短期（1-2 周）
1. **强制 fetch 走 api 层**：加 ESLint 规则，禁止页面级 `import { ipdGet }` 后直接 `.then((data) => map(...))` 模式（必须走 api/ipd/*.ts 的封装函数）
2. **真机形态契约测试**：在 api/ipd/*.ts 每个端点旁边加 contract.test.ts，用真机响应 dump（curl/mcp）锁定期望形态；fixture 必须从真机 dump 生成，禁手写
3. **头注释全文检索**：grep「裸 List」「裸 List<Project>」确认无残留注释

### 中期（1-2 月）
1. **e2e 关键页面覆盖**：playwright 跑 5 个关键页面（workbench / projects / ai-docs / project-detail / account），截图 + 断言下拉选项数 > 0
2. **跨分支 critical fix 同步门禁**：CI 加「integrated 与 main 关键文件差异 > N 行需人工 ack」
3. **前端错误监控**：sentry 或自建错误上报，API 错误率 / 页面加载失败率突增自动告警

### 长期
1. **api 层单一真源原则文档化**：写进 AGENTS.md / 前端架构规约
2. **定期 drift 审计**：每月跑一次「页面级 fetch vs api 层封装」对比脚本，发现未走 api 层的页面自动工单

---

## 结论

典型「**双真源 + 文档漂移 + 分支失同步 + 测试假形状**」综合 bug——4 层病根、7 道防线全失效，不是某个 commit 单独失误。

修复已完成（main + integrated 双修 + 「立即做」三项收口），但根本问题（缺 api 层单一真源硬约束、缺真机形态契约测试、缺跨分支同步门禁、缺 e2e）尚未根治。按四档分摊改进，避免再发。

---

## 附：相关 commit

| commit | 主题 | 文件 |
|---|---|---|
| `4d50480` | IPD全局前后端梳理与根源性修复（前端）—— 引入 normalizeProject 解包裹 | `api/ipd/project.ts`, `views/ipd/ai-docs/index.vue` |
| `824cb87` | 抢救 ai-docs 视图域防 untracked 灭失 | `views/ipd/ai-docs/*` |
| `ed92376` | fix: AI 文档助手项目列表加载失败（integrated 分支） | `views/ipd/ai-docs/index.{vue,test.ts}` |
| `e1b0394` | refactor(ipd): api 层归一化封装（main 分支初版，用 listProjects） | `views/ipd/ai-docs/index.{vue,test.ts}`, `views/ipd/project/detail/index.vue` |
| 本报告所属 commit | fix(ipd): ai-docs bug 反思立即收口（改 listProjectItems + 头注释 + 回归测试） | `api/ipd/project.ts`, `views/ipd/ai-docs/index.{vue,test.ts}` |
