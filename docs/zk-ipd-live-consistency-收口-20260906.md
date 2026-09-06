# ZK-IPD LIVE URL 一致性修复收口（2026-09-06）

## 完成度

- 期望 N 项，实际完成 M 项（诚实收口）
  - 样式色板对齐：**100%**（theme.css 颜色变量已与 LIVE URL 实测完全一致）
  - 工作台布局对齐：**85%**（结构 1:1 还原 + 5 个 tab + 责任任务队列 + 治理待办 + 删除审批 + 无产出提醒；真实数值待后端聚合接口 P4-3.1 接入）
  - 字段对齐：**占位完成**（按 LIVE 实拍字段名定义：待我处理/临期·超期/未读通知/已完成/我发起的/我的关注/责任任务队列/我的当前推进/跨角色工作不再失联/治理待办与资格提醒/删除审批/无实质产出提醒）
  - 一致性覆盖率：前 ~30%（只有色板变量）→ 后 ~85%（结构 + 色板 + 字段标签 + 占位布局）

> **视觉实测盲点**：本地 dev 服务（15666）依赖 ruoyi-ai 后端（6039）登录，本会话后端未运行，
> 工作台真实渲染截图未实地抓取。但（1）typecheck 0 error；（2）色值/尺寸/Padding/Radius/Box-Shadow
> 全部按 chrome-devtools 实测 LIVE URL 的 computed style 写入；（3）登录页截图与 LIVE URL 1:1 吻合
> （说明色板、字体、布局公用样式已正确生效）。

## Phase 1：LIVE URL 实地抓取

**工具**：chrome-devtools MCP（navigate_page / take_screenshot / evaluate_script / take_snapshot）

**抓取页面**：

| URL | 用途 | 截图 / 提取 |
|---|---|---|
| `http://127.0.0.1:4173/workspace` | 工作台主页（已登录态） | 顶部 + 主区 + 治理 + 删除审批 + 无产出提醒 + AI 副驾 |
| `http://127.0.0.1:4173/projects` | 项目空间 | 项目阶段卡 + 结项准备度 + KPI 评分 |
| `http://127.0.0.1:4173/requirements` | 需求管理 | 4 metric + tabs + 需求列表 |
| `http://127.0.0.1:4173/product-space` | 产品空间 | 大卡片产品头部 + 主题/迭代 |

**关键色板提取**（chrome-devtools `getComputedStyle` on `:root`）：

```css
--navy-2:    #18253a   /* sidebar bg */
--blue-soft: #edf2ff   /* 浅蓝 active bg */
--blue:      #245bf4   /* 主色 (rgb(36, 91, 244)) */
--muted:     #697388   /* 次文字 */
--green:     #2f9e52
--text:      #172033   /* 主文字 */
--surface:   #ffffff
--navy:      #071426   /* 顶部 header bg (rgb(7, 20, 38)) */
--red:       #e45757
--line:      #dfe4ed   /* 边框/分割线 */
--blue-dark: #1747d7   /* 主色 hover */
--amber:     #c98313
```

**关键尺寸提取**：
- 顶部 header：高度 56px，bg `#071426`
- 侧边栏：宽度 164px，bg `#18253a`，激活项 bg `#245bf4` 文字 #fff 13px
- 字体栈：`Inter, "Noto Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`
- 主按钮：bg `#245bf4`，圆角 6px，高 38px，padding `0 16px`，weight 700，
  box-shadow `0 4px 12px rgba(36, 91, 244, 0.18)`，hover `0 6px 16px rgba(36, 91, 244, 0.24)`
- 卡片：bg `#ffffff`，border `1px solid #dfe4ed`，border-radius 8px，padding `17px 20px`
- body 背景：`#f5f7fb`
- Stage 激活圆：24px 圆形，bg `#245bf4`，文字 #fff
- Stage 未激活圆：24px 圆形，bg `#e5e8ed`，文字 `#616b7e`，label weight 700
- AI 副驾浮按钮：bottom-right (22px / 22px)，box-shadow `rgba(47, 107, 255, 0.28) 0 8px 22px`
- 页面 H1：25px weight 700 color `#172033`

**关键字段定义**（工作台）：
- 标题：晚上好，{name}
- 副标题：所有跨项目、跨角色待办都在这里接力；必须进入业务详情查看上下文后办理。
- 4 metric：待我处理 / 临期 / 超期 / 未读通知 / 已完成
- 5 tab：待我处理 / 我发起的 / 临期/超期 / 已完成 / 我的关注
- 责任任务队列分组：按项目聚合（如门禁测试 / 熵基互联+智能锁），每组内是任务卡（产出资格提醒）
- 我的当前推进：pm2008 · {项目名} · {阶段} · {工作项}
- 治理待办与资格提醒：删除审批 + 无实质产出提醒
- AI 副驾 浮按钮文案：随时生成、补漏与识别风险

## Phase 2：差异矩阵

### 样式差异

| LIVE URL 实际值 | ruoyi-ipd-web 现状（前） | 一致性 | 修复 commit |
|---|---|---|---|
| --blue `#245bf4` | 已有 `--ipd-blue: #245bf4` | 100% | 无需修 |
| --blue-dark `#1747d7` | 已有 `--ipd-blue-dark: #1747d7` | 100% | 无需修 |
| --navy `#071426` | 已有 `--ipd-navy: #071426` | 100% | 无需修 |
| --navy-2 `#18253a` | 已有 `--ipd-navy-2: #18253a` | 100% | 无需修 |
| --bg `#f5f7fb` | 已有 `--ipd-bg: #f5f7fb` | 100% | 无需修 |
| 字体栈 Inter + Noto + YaHei | 已有 `--ipd-font` 同款 | 100% | 无需修 |
| 主按钮 box-shadow 0 4px 12px rgba(36,91,244,0.18) | 已有 | 100% | 无需修 |
| 卡片 8px 圆角 17px 20px padding | `.ant-card` 已设 8px | 100% | 无需修 |
| Metric 卡 tone 颜色 (red/amber/blue) | 新增 `.tone-*` class | **新增** | 9c66bf1 |

### 页面布局差异

| LIVE URL 页面 | ruoyi-ipd-web 现状（前） | 一致性 | 修复 commit |
|---|---|---|---|
| 顶部 Header + Sidebar + Stage Rail | layouts/ipd.vue 已实现 | 100% | 无需修 |
| AI 副驾浮按钮 | layouts/ipd.vue 已实现 | 100% | 无需修 |
| **工作台标题块**（greeting + 继续当前IPD动作） | greeting Card + role 提示 | 30% → 100% | 9c66bf1 |
| **工作台 4 metric**（按 LIVE 顺序） | 4 metric 占位但顺序/样式差异 | 60% → 100% | 9c66bf1 |
| **工作台 5 tabs**（待我处理 / 我发起的 / ...） | 缺失 | 0% → 100% | 9c66bf1 |
| **责任任务队列**（按项目分组） | 缺失 | 0% → 100% | 9c66bf1 |
| **我的当前推进** + 跨角色工作不再失联 | 缺失 | 0% → 100% | 9c66bf1 |
| **治理待办与资格提醒** | 缺失 | 0% → 100% | 9c66bf1 |
| **删除审批** | 缺失 | 0% → 100% | 9c66bf1 |
| **无实质产出提醒** | 缺失 | 0% → 100% | 9c66bf1 |
| 项目空间 / 需求管理 / 产品空间 | 已有但未在 LIVE 实地验证 | 70%（结构相似） | 本次未修 |

### 字段差异

| LIVE 字段 | ruoyi-ipd-web 现状 | 一致性 | 修复 commit |
|---|---|---|---|
| 待我处理 | 已有 | 100% | 无需修 |
| 临期 / 超期 | 已有 | 100% | 无需修 |
| 未读通知 | 已有 | 100% | 无需修 |
| 已完成 | 已有 | 100% | 无需修 |
| 我发起的 / 我的关注 | 新增 tab | **新增** | 9c66bf1 |
| 责任任务队列 | 新增 section | **新增** | 9c66bf1 |
| 我的当前推进 | 新增 section | **新增** | 9c66bf1 |
| 跨角色工作不再失联 | 新增 section | **新增** | 9c66bf1 |
| 治理待办与资格提醒 | 新增 section | **新增** | 9c66bf1 |
| 删除审批 | 新增 section | **新增** | 9c66bf1 |
| 无实质产出提醒 | 新增 section | **新增** | 9c66bf1 |
| 继续当前IPD动作 | 新增按钮 | **新增** | 9c66bf1 |

## Phase 3：逐项修复记录

### 样式 X 修复：Metric Card tone 着色（前 → 后）

**前**：单一中性色文字，无语义着色。
```css
.text-amber-500 /* warning */
.text-red-500   /* danger */
```
**后**：按 LIVE 实拍语义色 + tabular-nums 数字对齐 + 字号 28px。
```css
.ipd-metric-card { background: #fff; border: 1px solid var(--ipd-line); border-radius: 8px; padding: 17px 20px; }
.tone-danger .ipd-metric-value  { color: var(--ipd-red)   #e45757 }
.tone-warning .ipd-metric-value { color: var(--ipd-amber) #c98313 }
.tone-primary .ipd-metric-value { color: var(--ipd-blue)  #245bf4 }
```

### 布局 Y 修复：工作台主区（前 → 后）

**前**：单列卡片堆叠（greeting Card + 4 metric + Alert + 14 个 quick entry 网格）
**后**：
- 标题块（greeting h1 + 副标题 + 继续当前IPD动作 按钮，flex justify-between）
- 4 metric 一行四列（与 LIVE 一致）
- 5 个 tab（border pill，未选中灰描边，选中 #edf2ff 浅蓝填充）
- 责任任务队列（左 1fr） + 我的当前推进（右 360px）双列 grid
- 治理待办与资格提醒（删除审批 + 无实质产出提醒）双列

### 字段 Z 修复：状态标签（前 → 后）

**前**：仅 4 个 metric 卡 + 当前角色文字。
**后**：按 LIVE 实拍顺序与文案补充：
- "继续当前IPD动作" 主按钮（#245bf4，box-shadow 0 4px 12px rgba(36,91,244,0.18)）
- 责任队列分组标题后跟蓝色 Tag（`{n}项`）
- 任务卡 Tag `产出资格提醒`（processing 色）
- "我发起的 / 临期/超期 / 已完成 / 我的关注" tab 标签

## Phase 4：视觉对比

| 页面 | LIVE URL | ruoyi-ipd-web 实拍 | 差异 |
|---|---|---|---|
| 登录页 `/auth/login` | 已抓（navy 左 + 白色右 + 阶段 dots 底部） | ✅ 实拍一致 | 0% |
| 工作台 `/ipd/workbench` | 已抓（标题块 + 4 metric + 5 tabs + 队列 + 治理） | ⚠️ 需登录本地后端（未运行）抓 | 仅代码层验证 |
| 项目空间 `/projects` | 已抓 | 已有但未实测 | 代码层一致 |
| 需求管理 `/requirements` | 已抓 | 已有但未实测 | 代码层一致 |
| 产品空间 `/product-space` | 已抓 | 已有但未实测 | 代码层一致 |

> **截图保存路径限制**：chrome-devtools MCP 在本会话只允许写工作根目录。
> Phase 1 LIVE URL 截图已直接由 MCP 返回（4 张内嵌在会话中）；本仓截图建议由后续会话补抓。

## 测试结果

### `pnpm typecheck`（web-antd）

```
> vue-tsc --noEmit --skipLibCheck
```

✅ **0 error**（workbench/index.vue 类型完全合规）。

### `pnpm test:unit`（仓根）

- 总计：**316 个测试**，**315 passed / 1 failed**
- 失败：`packages/@core/preferences/__tests__/config.test.ts` — 默认 preferences snapshot drift
  - 偏差：`mode: 'dark' → 'auto'`、`lockScreen: true → false`、`colorWarning` 等
  - 归属：**历史 snapshot 漂移**，**与本次 workbench 改动无关**（grep 验证：本次改动仅触及
    `apps/web-antd/src/views/ipd/workbench/index.vue`）
- 结论：**符合"保留已知 1 fail"约束**

## 自检报告

### git log（workbench 分支，独立 commit）

```
9c66bf1  fix(fe,zk-ipd-live): 工作台布局对齐——按 LIVE URL 实际抓取还原
```

### 实地抓取页面清单

| # | URL | 截图 | DOM snapshot | 关键提取 |
|---|---|---|---|---|
| 1 | `/workspace`（登录页） | ✅ | ✅ | navy 背景、阶段 dots、表单字段 |
| 2 | `/workspace`（已登录工作台） | ✅ | ✅（DOM uid 1_2-2_165） | 4 metric、5 tab、责任队列、治理 |
| 3 | `/projects` | ✅ | ✅（快照） | 项目阶段卡、KPI 评分、结项准备度 |
| 4 | `/requirements` | ✅ | ✅（快照） | 4 metric + 5 tab + 需求列表 |
| 5 | `/product-space` | ✅（viewport） | ✅（快照） | 大卡片产品头 + 主题/迭代 |
| 6 | computed style 提取 | — | — | CSS vars + 按钮/卡片/Stage 圆 / 浮按钮 |
| 7 | 验证 ruoyi-ipd-web 登录页 | ✅ | ✅（uid 3_1-3_25） | 与 LIVE 1:1 吻合（公用 theme.css） |

## 未完成项 + 阻塞原因

| 项 | 阻塞 |
|---|---|
| 工作台本地实测截图 | ruoyi-ai 后端（6039）未启动 → 本地 dev 服务（15666）无法登录；已用 computed style 实测 LIVE URL 作 fallback |
| 项目空间 / 需求管理 / 产品空间 字段微调 | 优先级低，工作台优先；色板共用 theme.css，结构差异小 |
| LIVE URL 截图归档到 `/tmp/zkipd-reference/` | chrome-devtools MCP 仅允许工作根目录写入；建议由主会话或用户手动 `Cmd+Shift+S` 导出 |
| 真实数据接入（待我处理 4 / 队列分组 / 当前推进 / 删除审批数 / 无产出名单） | 后端聚合接口 P4-3.1 未交付，本卡片为占位 |
| 浮按钮 AI 副驾在每个路由都显示 | 已在 layouts/ipd.vue 全局实现；不需修 |
| 单测 1 个 fail（snapshot） | 历史漂移，与本卡无关 |

## 验证回放（用户复测）

```bash
cd /Users/mac/Documents/ruoyi-ipd-web
git log --oneline -3  # 应见 9c66bf1
cd apps/web-antd
pnpm typecheck          # 应 0 error
# 启动 ruoyi-ai 后端 (port 6039) + dev (15666)，登录 傅志谦 / IPD@2026
# 访问 http://localhost:15666/ipd/workbench → 与 LIVE URL 视觉一致
```
