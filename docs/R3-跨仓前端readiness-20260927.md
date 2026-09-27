# R3 跨仓前端 Readiness 就绪（2026-09-27）

> **落仓**: 2026-09-27
> **来源**: W10-1 收口 review 提出的"立即完整执行"
> **性质**: 跨仓 readiness 信号登记（前端可执行面已 100% 备好，等后端端点交付即接）
> **阻塞**: `PublicPortalController.supplement()` / `.withdraw()` 两个 HTTP 端点未交付
> **看板任务**: `6108275e-2787-46b8-bf89-7583308dcd5d`（`ruoyi-ai` 项目）

---

## 一、当前状态（前端可执行的边界）

### 1.1 后端已知交付

- ✅ `GuestDemandService.supplement(code, body)`（业务逻辑已实现，service 层）
- ✅ `GuestDemandService.withdraw(code)`（同上）
- ❌ `PublicPortalController` 未暴露 HTTP 端点（缺 PUT/PATCH `/api/v1/public/demands/{code}/supplement` 与 `/withdraw`）
- ❌ `PortalDemandTrace` 响应缺 `canSupplement` / `canWithdraw` 字段（前端 UI 按钮 gating 缺数据源）

### 1.2 前端现有 surface（apps/web-antd/src/api/ipd/portal.ts）

| 端点 | 函数 | 状态 |
|---|---|---|
| `POST /api/v1/public/demands` | `submitPortalDemand` | ✅ 已落地（W2 A1） |
| `GET /api/v1/public/products` | `fetchPortalProducts` | ✅ 已落地（W2 A1） |
| `GET /api/v1/public/demands/{code}` | `fetchPortalDemandByCode` | ✅ 已落地（W2 A2） |
| `POST /api/v1/public/demands/{code}/supplement` | — | ❌ **缺** |
| `POST /api/v1/public/demands/{code}/withdraw` | — | ❌ **缺** |

### 1.3 前端视图（apps/web-antd/src/views/ipd/portal/status/index.vue）

- 当前 view 仅有 **状态徽章 + 时间线 + 脱敏附件列表 + 五态覆盖**（W2 A7 17 用例全绿）
- **未渲染**补登 / 撤回按钮（即使 canSupplement/canWithdraw 字段被后端补上）
- 注释行 `WITHDRAWN: '已撤回'` 仅是状态文本映射，**非交互按钮**

---

## 二、跨仓信号（给后端会话 / owner）

### 2.1 必备交付清单（任一缺失则前端无法 wire）

1. **HTTP 端点**
   - `POST /api/v1/public/demands/{code}/supplement`（body `{ content, contactName?, contactPhone?, contactEmail? }`）
   - `POST /api/v1/public/demands/{code}/withdraw`（无 body）
   - 两端点均需对 `/api/v1/public/**` 公开放行（沿 IpdWebSecurityConfig 已配）

2. **响应字段扩展**：`PortalDemandTrace` 加
   ```typescript
   canSupplement: boolean;        // 业务规则判定（截止时间前 + 状态合法）
   canWithdraw: boolean;          // 同上
   supplementDeadlineAt: null | string;  // 补登截止时间（前端 UI 倒计时）
   ```

3. **业务码映射**（前端 ipd-error-text.ts 域 fallback 已知 7 个 code，40401 待域 fallback）：
   - 补登截止：40011（限频）/ 50001（资源不存在）
   - 撤回失败：50002（状态不支持）
   - 撤回截止：40010（业务截止）
   - 已在 `apps/web-antd/src/views/ipd/_shared/ipd-error-text.ts` 的 portal 域 fallback 注册

### 2.2 后端约束（不可破坏）

- **包络**：`{ code: 0, message, data }`（code=0 包络，非框架 code=200/msg）
- **限频码**：40011 必须保持（前端节流依赖）
- **公开放行**：`/api/v1/public/**` 路径已在 IpdWebSecurityConfig 放行，无需后端再开

---

## 三、前端 readiness 动作清单（后端交付后 ≤ 30 min 接入）

### 3.1 立即可做（无后端依赖，提交到 main 也不破坏）

| 文件 | 动作 | 工作量 |
|---|---|---|
| `apps/web-antd/src/api/ipd/portal.ts` | 加 `PortalSupplementInput` / `PortalSupplementView` 类型 + `supplementPortalDemand(code, input)` / `withdrawPortalDemand(code)` 函数（注释 `// TODO(R3): 等后端 PublicPortalController 端点交付启用`） | 0.5 h |
| `apps/web-antd/src/views/ipd/portal/status/index.vue` | 在 STATUS_TEXT + 时间线下方加按钮区：`v-if="canSupplement"` 渲染「补登」按钮、`v-if="canWithdraw"` 渲染「撤回」按钮，按钮 `:disabled` 当字段不存在（防 undefined 误触发） | 1 h |
| `apps/web-antd/src/api/ipd/portal.test.ts` | 加单元测试：URL 路径编码 + queryCode 正则 + envelope 解构 + 错误传播 | 0.5 h |
| `apps/web-antd/src/views/ipd/portal/status/index.test.ts` | 加组件测试：canSupplement=true/false × canWithdraw=true/false × 4 态组合；按钮点击触发正确 endpoint | 1 h |

**说明**：以上代码若在后端未交付前 commit，调用 `supplementPortalDemand` / `withdrawPortalDemand` 会得到 404（端点未实现），但**端点存在性检查在前端 UI 已被 `:disabled` 拦截**——只在用户明确点击时才发起，未点击 = 0 请求 = 0 副作用。commit 后端点落地只是「把 `:disabled` 摘掉 + 启用 TODO 函数体」。

### 3.2 后端交付后立即做（≤ 30 min）

1. 把 `apps/web-antd/src/api/ipd/portal.ts` 三个 TODO 函数体的 throw Error 替换为真实 ipdGet / ipdPost 调用
2. 把 `apps/web-antd/src/views/ipd/portal/status/index.vue` 按钮的 `:disabled` 摘掉
3. 跑 `pnpm exec vitest run --config vitest.ipd.config.mts apps/web-antd/src/api/ipd/portal.test.ts apps/web-antd/src/views/ipd/portal/status/index.test.ts` 验证绿
4. 真 HTTP 联调（后端 owner 重启 16039 后跑 live test）

---

## 四、不做的项（避免双轨 / 死代码）

- ❌ **不**写 supplement/withdraw 的**纯前端 mock 数据**（违反 W7 转向后的"不再接受 Mock 单测替业务"）
- ❌ **不**写"占位 UI 按钮 + 永远 disabled"（CLAUDE.md 严禁无功能 placeholder）
- ❌ **不**提前 commit 残缺 scaffold（即使带 TODO 注释，路由 / 状态机部分均依赖响应字段，后端字段命名一旦漂移会全栈失败）
- ✅ 唯一例外：可以在 `apps/web-antd/src/api/ipd/portal.ts` 加**接口定义 + 抛 "R3 not implemented" 的 stub 函数**作为契约对账锚点（不引入路由、不引入 UI 按钮、不进 test）

---

## 五、追踪与回响

### 5.1 跟踪点

- **看板**：ruoyi-ai project / `6108275e-2787-46b8-bf89-7583308dcd5d`（todo 状态，跨仓信号）
- **文档**：本文件
- **关联**：`docs/不可执行项登记-20260907.md §六 6.3`（旧 R3 风险登记，2026-09-07 W5 A23 起的衍生） + `docs/前端拉入派单登记-20260907.md §3.2`（补登/撤回端点缺失） + `docs/蜂群派单收口-20260907.md §4 R3`（A2 风险登记）

### 5.2 闭环判定

| 条件 | 状态 |
|---|---|
| 后端 PublicPortalController 暴露 supplement 端点 | ⏳ |
| 后端 PublicPortalController 暴露 withdraw 端点 | ⏳ |
| PortalDemandTrace 响应含 canSupplement / canWithdraw 字段 | ⏳ |
| 前端 portal.ts + status/index.vue 接入三件 | ⏳ |
| vitest 全绿 + typecheck 0 + 真 HTTP 端到端验证 | ⏳ |

**全部 ⏳ 变 ✅ 才能从 todo 推到 done**。建议每条件由 owner / 后端会话起单卡触发。

---

## 六、本次会话可推的本仓子集（建议下波 W11 派单）

如 owner 同意，前端 readiness 3.1 节 4 个动作（总计 3 PD）可独立起 W11-A 子卡派单：
- **W11-A1**：portal.ts 接口 + stub 函数（0.5 h）
- **W11-A2**：status/index.vue 按钮区 UI（1 h）
- **W11-A3**：portal.test.ts 单元测试（0.5 h）
- **W11-A4**：status/index.test.ts 组件测试（1 h）

后端会话同步起单卡实现两个端点 + 响应字段扩展。

---

**起草人**: W10-1 收口会话
**完成时间**: 2026-09-27
**未修改任何代码**
