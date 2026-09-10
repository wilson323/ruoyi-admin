# 整合仓收口计划 — 企业级高质量完善执行

**计划时间**：2026-09-10
**来源**：用户明确指令「紧跟工作台 / SSE 404 要修 / 后端 /menu 要补——以上都要系统性梳理企业级高质量完善执行」
**关联**：A→B→C→D 已闭环（commit `161489f` ORIGIN 接收 + `a9bca7a` AI 文档助手可见），本计划承接三个收口任务

---

## 现状摘要（事实源已现查）

| 项 | 事实 |
|---|---|
| 其他菜单 order 分布 | 1 我的工作台 / 2 项目空间 / 3 需求管理 / 4 产品空间 / 5 研发招募 / 6 变更管理 / 7 资料库 / 8 阶段确认 / 9 协同绩效 / 10 全流程轨迹 / 11 报表分析 / 12 项目移交 / 13 产品目录(SUPER_ADMIN) / 14 人员同步(SUPER_ADMIN) / 15 超级管理(SUPER_ADMIN) |
| SSE 前端消费 | `apps/web-antd/src/utils/message.ts:22`：`${apiURL}/resource/sse?clientid=...&Authorization=Bearer ${token}`；`token` 取 `useAccessStore().accessToken`（**Vben 平台 token，非 IPD 业务 token**） |
| SSE vite 代理 | `vite.config.mts:67-80`：只匹配 `/api` 前缀；`/resource/**` 不被代理 |
| SSE 后端实现 | `ruoyi-aiflow` 有 `SseEmitter`（workflow 流式），无 `/resource/sse` 端点；`/api/v1/resource/sse` 后端 0 命中 |
| 菜单接口后端 | `ruoyi-modules/ruoyi-system/.../SysMenuController.java:46-50`：`getRouters()` 走 sys_menu 表 + role_menu 关联，IPD 业务菜单**未登记**到 sys_menu 表 |
| 菜单接口前端 | `api/core/menu.ts:46` 调 `/system/menu/getRouters`（vite 去 /api 前缀 → 后端 `/system/menu/getRouters`），返回 `Menu[]` 含 name/path/component/hidden/meta/children |

---

## 任务 1：AI 文档助手菜单位置（紧跟工作台）

**目标**：AI 文档助手菜单排在「我的工作台」和「项目空间」之间

**方案选择**：
- 方案 A：AI 文档助手 `order=2`，项目空间改 `order=3`，其他菜单 order 顺延 +1（改 13 个字段）
- 方案 B：AI 文档助手 `order=1.5`，其他菜单不动（改 1 个字段） ✅ **推荐**

**理由**：方案 B 改动最小、风险最低，浮点 order 排序由 `Number()` 转换保证稳定。

**实施步骤**：
1. 改 `apps/web-antd/src/router/routes/modules/ipd.ts:352` meta 加 `order: 1.5`
2. vite HMR 自动热更
3. 浏览器实测确认侧栏顺序：我的工作台 → AI 文档助手 → 项目空间 → ...

**测试**：
- 视觉验证：浏览器登录后侧栏顺序
- 单测：visibleNav.sort 排序结果（兄弟会话已写 `integration.test.ts`，可加 case）

**风险**：0（单字段修改 + 已有排序逻辑兼容）

**工作量**：5 分钟

---

## 任务 2：SSE 404 修复

**目标**：`${apiURL}/resource/sse` 端点可达，前端登录后无 SSE 404 console 报错，通知推送可工作

**现状根因**：
1. 后端无 `/resource/sse` 或 `/api/v1/resource/sse` controller（grep 0 命中）
2. 前端用 Vben 平台 token（`accessStore.accessToken`），与 IPD 业务会话脱钩
3. vite 代理规则只匹配 `/api` 前缀，访问 `/resource/sse` 直接打前端 dev server → 404

**方案**：分两层修

### 2.1 后端：新增 SseController

**位置**：`ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller/IpdSseController.java`

**端点签名**（对齐前端 `useSseMessage` 调用）：
- `GET /api/v1/resource/sse?clientid={clientId}&Authorization=Bearer {token}` — SSE 连接
- 鉴权：URL query 的 token（与前端一致）+ sa-token 校验
- 响应：`text/event-stream`，事件名 `message` / `notice` / `task`，data 为 JSON

**核心组件**：
- `SseEmitterManager`（参考 `ruoyi-aiflow/SSEEmitterHelper.java`，但 clientId 改为 IPD personId）
- `SseConnectionService`（连接/断开/重连）
- `NotificationPushService`（业务消息推送）

**事件类型**（与前端 `message.ts` 对齐）：
- `message`：通用消息
- `notice`：站内通知（与现有 `/api/v1/notifications` 对齐）
- `task`：任务投递（待我处理列表实时更新）

**测试计划**：
- 单测：`SseEmitterManager.connect/disconnect/send`，mock SseEmitter
- 集成测：`@SpringBootTest` 起容器，用 `WebTestClient` 测 SSE 连接 + 接收消息
- 真活测：起后端 → curl SSE 连接 → 触发通知 → 验证收到

### 2.2 前端：token 源 + vite 代理对齐

**改动 1**：`utils/message.ts:20` token 源
```typescript
// 改前
const token = accessStore.accessToken;
// 改后
const { token: ipdToken } = useIpdAuthStore();  // 业务 token
const token = ipdToken || accessStore.accessToken;  // 降级到平台 token
```

**改动 2**：`vite.config.mts:75-77` 代理规则扩展
```javascript
rewrite: (path) => /^\/api\/v1(?:\/|$)/.test(path)
  ? path
  : path.replace(/^\/api(?=\/|$)/, ''),
// 新增：/resource/** 也走代理（去前缀）
```

或更优：把 SSE 路径迁到 `/api/v1/resource/sse`，统一走 /api/v1 前缀。

**改动 3**：`utils/message.ts:22` 路径对齐
```typescript
const sseAddr = `${apiURL}/resource/sse?...`;
// apiURL='/api/v1' 时变 '/api/v1/resource/sse'（推荐）
```

**测试计划**：
- 浏览器登录后 console 无 404
- SSE 连接建立（Network 面板看 EventStream）
- 触发通知推送（改库/调接口） → 浏览器实时收到

**风险**：
- 中等：涉及后端新功能 + 前端 token 源切换
- 多会话冲突：兄弟会话可能同时在改后端

**工作量**：3-4 小时（含测试）

**SSOT 同步**：
- `docs/ipd-系统说明/工程合同/SSE契约-20260910.md`（新增）：端点签名 + 事件类型 + token 约定
- 看板新增卡片 P3-SSE-收口
- `log.md` 登记

---

## 任务 3：后端 /menu 接口补全

**目标**：accessMode='backend' 真生效；不同角色（admin/leader/market/rd）看到的菜单不同；前端 menu.ts 拿到 IPD 业务菜单

**现状根因**：
1. 后端 `SysMenuController.getRouters()` 走 sys_menu 表 + role_menu
2. IPD 业务菜单**未登记**到 sys_menu 表（19 个 IPD controller 没对应菜单项）
3. 前端访问 `/system/menu/getRouters` 拿到的是 RuoYi 通用菜单（不含 IPD 业务菜单）

**方案选择**：
- 方案 A：sys_menu 表 INSERT 18 条 IPD 业务菜单 + role_menu 关联 — 标准 RuoYi 模式
- 方案 B：在 getRouters 里硬编码合并 IPD 业务菜单（不走 sys_menu）— 简单但破坏通用模式
- 方案 C：写新 IpdMenuController 暴露 IPD 业务菜单，前端访问新端点 — 解耦但要改前端

**推荐方案 A**（端到端正确，符合 RuoYi 通用模式）

**实施步骤**：

### 3.1 DDL 登记菜单数据

**文件**：`docs/script/sql/update/ipd_business_menus_insert.sql`（人工 apply）

**菜单项设计**（18 条 IPD 业务菜单 + 3 条超管专属）：
- 一级菜单：`IPD`（menu_id=2000）
- 二级菜单（业务）：我的工作台 / AI 文档助手 / 项目空间 / 需求管理 / 产品空间 / 研发招募 / 变更管理 / 资料库 / 阶段确认 / 协同绩效 / 全流程轨迹 / 报表分析 / 项目移交
- 二级菜单（超管）：产品目录 / 人员同步 / 超级管理

**字段**：
- menu_name, parent_id, order_num, path, component, query, is_frame, is_cache, menu_type（M=目录/C=菜单/F=按钮）, visible, status, perms, icon

### 3.2 DDL 角色菜单关联

**文件**：`docs/script/sql/update/ipd_role_menu_relations.sql`

**关联设计**：
- SUPER_ADMIN（ipd-admin）：全部 18 + 3 = 21 项
- GROUP_LEADER（ipd-leader）：业务 18 项（不含超管专属 3 项）
- MARKET_PM（ipd-market）：业务 18 项
- RD_PM（ipd-rd）：业务 18 项

### 3.3 后端菜单返回格式对齐

**后端现有**：`SysMenuController.getRouters()` 返回 `RouterVo`，前端期望 `Menu[]`（含 component 字符串）

**改动**：
- 检查 `RouterVo` 字段是否与前端 `Menu` 接口兼容
- 不兼容则改 `RouterVo` 或加转换层
- component 路径对齐前端路由（如 `ipd/workbench/index`）

### 3.4 前端菜单接入

**改动**：`api/core/menu.ts:46` 接口确认返回类型

**接入方式**：
- IPD 工作台侧栏**保持前端路由生成**（ipd.vue 硬编码） — 已经在用
- AI 平台菜单**走后端**（accessMode='backend'）
- 在 `ipd-guard.ts buildAccessMenus` 里消费后端菜单，与前端路由合并

**测试计划**：
- 单测：SQL apply 验证（`p1-ddl-apply-check.py`）
- 单测：menuService.selectMenuTreeByUserId 按角色返回结果
- 集成测：不同角色调用 getRouters 拿到的菜单项不同
- 浏览器实测：4 个账号分别登录看菜单项数

**风险**：
- 高：DDL apply + role_menu 关联 + 菜单 component 路径对齐
- 多会话冲突：兄弟会话可能同时改 sys_menu 数据
- 权限泄露：role_menu 配错角色可能泄露菜单

**工作量**：1-2 天（含 SQL + 后端 + 测试 + 4 个角色验证）

**SSOT 同步**：
- `docs/script/sql/update/ipd_business_menus_insert.sql`（commit 但 DDL 待 owner apply）
- `docs/ipd-系统说明/工程合同/菜单权限契约-20260910.md`（新增）
- 看板新增卡片 P3-MENU-收口
- `log.md` 登记

---

## 执行顺序与依赖

```
任务 1 (5分钟) → commit 后立即可推
任务 2 (3-4小时) → 跨仓写后端，需确认兄弟会话状态
任务 3 (1-2天) → 跨仓写后端 + SQL apply
```

**依赖**：
- 任务 1 独立，可立即执行
- 任务 2、3 独立（互不依赖），可顺序或并行
- 但都需要兄弟会话不在 ruoyi-ai 在途改后端

---

## 五必现查规约核对（2026-09-10 13:30 实测）

- ✅ hash：3 个 commit 哈希现查（7e18ec0 / 8bc3d95 / 161489f / a9bca7a）
- ✅ 端口：vite 15667 + 后端 16039 现查
- ✅ 段号：ipd.ts order 行号现查（35/50/155/162/190/215/225/233/241/250/257/265/389/398/405）
- ⏸ 看板回读：本计划执行后必须回读（fresh 验证）
- ✅ 跨仓 cd：本计划涉及整合仓 + ruoyi-ai 两仓，所有命令前缀绝对路径

---

## 验收标准

每个任务完成后必须满足：
1. 代码 commit（自动，含本计划链接）
2. 真活验证（不是 mock 绿）
3. 浏览器/curl 实证（不是单元测试通过即可）
4. SSOT 镜像同步（log.md + 工程合同文档）
5. 看板卡 fresh 同步（拿真实数据翻卡）

---

## 待 owner 拍板

任务 2/3 涉及跨仓（ruoyi-ai 后端），按 OPS-09 软化纪律，需先确认：

1. **任务 1**：是否立即执行（推荐：是，单字段修改）
2. **任务 2**：是否启动（推荐：是，但需确认兄弟会话不在 ruoyi-ai 在途改 SseController）
3. **任务 3**：是否启动（推荐：是，但工作量 1-2 天，是否拆分为 P3-MENU-SQL + P3-MENU-后端 + P3-MENU-前端 三步？）

**本计划不含 commit**（仅设计），每个任务单独 commit。
