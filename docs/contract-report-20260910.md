# 前后端契约核对报告（2026-09-10）

整合仓 `ruoyi-ipd-integrated` 的前端（ageerle/ruoyi-admin + IPD 业务模块）
对接后端 `ruoyi-ai` IPD API 的端点一致性扫描结果。

## 扫描工具

`scripts/contract-check.py`（Python 3，无依赖）：

- 前端调用点：抓 `apps/web-antd/src/api/ipd/*.ts` 里
  - `ipdGet / ipdPost / ipdPut / ipdDelete` 字符串字面量（容许 `<T>` 泛型）
  - `requestIpd('/path', { method: 'POST'/'GET'/'PUT' })` 通用代理
- 后端端点：跨模块扫 controller 类注解
  - `ruoyi-modules/ruoyi-ipd/src/main/java/org/ruoyi/ipd/controller/`
  - `ruoyi-admin/src/main/java/org/ruoyi/ipd/controller/`（**关键**：platform-token 等端点在此模块）
- 匹配规则：`{xxx}` → `{id}` 通配符；跨 verb 宽松（POST/PUT 不严格区分）

## 数据（截至 2026-09-10）

| 维度 | 数量 |
|---|---|
| 后端端点（跨模块） | **281** |
| 前端调用点（去重） | **149** |
| 前后端覆盖 | **164** |
| ⚠️ FE-only（前端调了后端没有） | **4** |
| ℹ️ BE-only（后端有前端没调） | 117 |

> **核心结论**：145/149 前端调用都能命中后端。前端整合契约基本一致。

## ⚠️ FE-only（前端调用无后端实现，404 风险）

| verb | 路径 | 后端实际 | 性质 |
|---|---|---|---|
| POST | `/api/v1/sop-templates/{id}/copy` | 无 | 业务能力缺口 |
| POST | `/api/v1/sop-templates/{id}/update` | 无 | 业务能力缺口 |
| POST | `/api/v1/sop-templates/{id}/revert` | 无 | 业务能力缺口 |
| POST | `/api/v1/sop-templates/{id}/publish` | `/sop-templates/publish`（不带 id） | 命名风格不一致 |

**这 4 个都在 `apps/web-antd/src/api/ipd/sop-template.ts`**（SOP 编辑功能）：
- `copySopTemplate(id)` / `updateSopTemplate(id, req)` / `revertSopTemplate(id)` / `publishSopTemplate(id)`
- 前端有按钮（仅超管可见），后端 SopTemplateController 仅实现 `GET /active`、`POST /publish`（无 id）、`POST /{templateId}/instantiate`、`GET /instances`、`GET /{id}`
- **不修前端**：SOP 编辑页本身也未在整合仓里实现（路由声明但无组件），本次整合范围外
- **不修后端**：超出"前端整合"职责

## ℹ️ BE-only（后端有但前端暂未调用）

117 个，分类：
- **Admin-only / 内部 cron**：audit-logs/rebuild-chain、handovers/scan-overdue、gates/sign/scan-*
- **跨 verb 兼容**：前端用 GET/PUT，后端用 POST（如 `/api/v1/kpi/shared/{id}/confirm`）
- **未实现的业务模块**：compliance/*、person-sync/*、hr-sync/*、post-launch-reviews/*、switching-acceptance/*、receipt-ledgers/*、contributions/*
- **已实现但前端 API 文件未封装**：bonus-pool/auto-compute、coefficient-change-requests/{id}/leader-decision、projects/{id}/cert-items/*

均非 404 风险（前端不调），属于业务覆盖度问题。

## 历史教训（假绿陷阱）

本次扫描共修了 4 处扫描脚本 bug，每次都会改变结论：

1. **regex 没容许 `<T>` 泛型**：早期抓到 39 个调用点（实际 146），把整个 SOP/PM 圈都错报成 FE-only。
2. **路径没自动加 `/api/v1` 前缀**：前端代码写裸 `/auth/login`，后端 controller 拼 base 后变 `/api/v1/auth/login`，不归一化就 100% miss。
3. **`@PostMapping` 无参数**（裸路径）：regex 要求 `("...")` 才匹配，导致 HandoverController 的基本创建端点 `/handovers POST` 漏掉。
4. **后端 controller 跨模块**：只在 `ruoyi-modules/ruoyi-ipd/` 扫，漏掉 `ruoyi-admin/src/main/java/org/ruoyi/ipd/controller/IpdPlatformAuthController`（含 `POST /api/v1/auth/platform-token`），把已经实现的平台票交换端点错报成 FE-only。

## 复测命令

```bash
cd /Users/mac/Documents/ruoyi-ipd-integrated
python3 scripts/contract-check.py
```
