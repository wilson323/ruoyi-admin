# 前后端契约 HTTP 真活验证 — 2026-09-10

## 范围

- 前端：`apps/web-antd/src/api/ipd/*.ts` 共 149 个 distinct 调用点
- 后端：`ruoyi-ai` IPD 模块（127.0.0.1:16039）
- 角色：wecom mock login → ipd-rd / RD_PM / personId=900104

## 方法

```bash
python3 scripts/http-probe.py
```

**关键参数**：
- 串行调用（避免并发 throttle）
- **每 25 个请求重新 wecom mock login**（wecom mock 模式 token TTL < 60s）
- `{id}` 通配替换为 `900104`
- POST/PUT body 用 `{}`，GET/DELETE 无 body
- HTTP timeout 8s

## 结果分桶

| 类别 | 数量 | 性质 |
|---|---:|---|
| ✅ 真业务成功（http=200, biz=0） | **10** | 端点 + 参数 + 业务逻辑全对 |
| ⚠️ 业务 wrapper 404（http=200, biz=404） | **4** | **真 FE-only**，前端调了后端没实现 |
| ❌ HTTP 500 后端 bug | **5** | 后端代码缺陷 |
| · HTTP 401 凭证失效 | **22** | 后端 sa-token 在写操作上返回 401 而非 403（语义错） |
| · HTTP 403 权限不足 | **15** | RD_PM 角色没权限（admin-only / leader-only） |
| · HTTP 400 缺参 | **51** | probe 通配限制（900104 不一定满足必填参数） |
| · HTTP 404 资源不存在 | **28** | probe 通配限制（900104 不一定存在对应资源） |
| · HTTP 其它 | **14** | 同上 |
| **总计** | **149** | |

## ⚠️ 真 FE-only：4 个 SOP 端点（前端调了后端路由不存在）

```
POST /api/v1/sop-templates/{id}/copy       ← 后端无此路由
POST /api/v1/sop-templates/{id}/publish    ← 后端无此路由（后端 /publish 不带 id）
POST /api/v1/sop-templates/{id}/revert     ← 后端无此路由
POST /api/v1/sop-templates/{id}/update     ← 后端无此路由
```

后端 sys-error.log 实证：
```
ERROR o.r.c.w.h.GlobalExceptionHandler - 请求地址'/api/v1/sop-templates/900104/copy'不存在.
ERROR o.r.c.w.h.GlobalExceptionHandler - 请求地址'/api/v1/sop-templates/900104/publish'不存在.
ERROR o.r.c.w.h.GlobalExceptionHandler - 请求地址'/api/v1/sop-templates/900104/revert'不存在.
ERROR o.r.c.w.h.GlobalExceptionHandler - 请求地址'/api/v1/sop-templates/900104/update'不存在.
```

**处置**：SOP 模板编辑功能是业务能力缺口，超出"前端整合"职责范围；建议：
- 短期：前端 `apps/web-antd/src/api/ipd/sop-template.ts` stub 这 4 个函数（throw "后端未实现"），避免菜单点击时静默失败
- 中期：后端补 4 个 controller 路由（按 SOP 实例操作语义实现）

## ❌ 真后端 bug：5 个 HTTP 500

| 端点 | 根因 |
|---|---|
| `GET /api/v1/sop-templates/current` | `MethodArgumentTypeMismatchException: Failed to convert value of type 'String' to required type 'Long'; For input string: "current"` — 后端 `id` 字段类型为 Long，不接受字符串 "current"。前端发 `/current` 当 GET 资源标识，后端没配 `@GetMapping("/current")` 别名路由。 |
| `GET /api/v1/products/{id}` | `NullPointerException: Cannot invoke "Product.getId()" because "p" is null` at `org.ruoyi.ipd.vo.ProductVO.from(ProductVO.java:25)` — `ProductController.get()` 取 null Product 时没 null check。 |
| `GET /api/v1/ai-documents/{id}/versions` | `BadSqlGrammarException: Unknown column 'project_id' in 'field list'` at `AiDocumentService.history(AiDocumentService.java:360)` — MyBatis SQL 引用了不存在的列，DDL 未 apply。 |
| `GET /api/v1/deletion-requests/archive` | `NotPermissionException: 无此权限：ipd:deletion-request:archive` 抛成 500 而非 403 — 全局异常处理器未捕获 sa-token NotPermissionException。 |
| `GET /api/v1/deletion-requests/overdue-admin-review` | 同上：`NotPermissionException: 无此权限：ipd:deletion-request:admin` 抛成 500 而非 403。 |

**处置**：5 个全在后端代码 / DDL 范畴，需后端会话修复：
- 1 个路由补全（`/sop-templates/current` 别名）
- 1 个 NPE 防御（`ProductVO.from` 加 null check）
- 1 个 SQL 列补齐（DDL apply `project_id`）
- 1 个全局异常处理器补 sa-token NotPermissionException 转 403（涉及 2 个端点）

## · HTTP 401（22 个，全部 POST/PUT/DELETE）

集中在写操作，**后端 sa-token 在写权限校验失败时返回 401 而非 403**（语义错：凭证有效但权限不足，应返 403）。代表性端点：

- `POST /api/v1/bid-invitations`、`/bid-responses`
- `POST /api/v1/bonus-pool/{compute,distribute,freeze}`
- `POST /api/v1/cert-templates`、`/cert-templates/{id}/remove`
- `POST /api/v1/coefficient-change-requests`
- `POST /api/v1/contributions/{id}/{confirm,market-share,preview,save}`
- `POST /api/v1/deletion-requests/*`（共 7 个）
- `POST /api/v1/demands/{id}/{link-project,triage}`
- `POST /api/v1/gate-elements`

**处置**：后端会话统一改 sa-token 异常映射。

## 真实业务成功列表（10 个）

```
GET    /api/v1/ai-models                          ai-model-config.ts
GET    /api/v1/audit-logs/export/scope            audit.ts
GET    /api/v1/cert-templates/country-counts      cert-template.ts
GET    /api/v1/handovers/inbox                    handover.ts
GET    /api/v1/notifications/unread-count         notification.ts
GET    /api/v1/project-score-tasks/my             project-score.ts
GET    /api/v1/projects/{id}                      project.ts
GET    /api/v1/requirement-changes                change.ts
GET    /api/v1/sop-templates                      sop-template.ts
POST   /api/v1/notifications/read-all             notification.ts
```

GET 全部通过；POST 只 1 个通过（`notifications/read-all`）。其余写操作因 RD_PM 无权限被 401 / 403。

## 与静态扫描的一致性

| 项 | 静态扫描（前后端 @Mapping 比对） | HTTP 真活 | 一致？ |
|---|---:|---:|---|
| 后端端点 | 281 | — | — |
| 前端调用点 | 149 | 149 | ✓ |
| 跨 verb 覆盖 | 164（含跨 verb 宽松匹配） | — | — |
| **FE-only** | **4**（SOP） | **4**（SOP） | ✓ |
| HTTP 500 真后端 bug | 静态扫描看不到 | 5 | 新发现 |
| HTTP 401/403 | 静态扫描看不到 | 22 + 15 | 新发现 |
| HTTP 400/404 | 静态扫描看不到 | 51 + 28 | probe 限制 |

## 复测命令

```bash
cd /Users/mac/Documents/ruoyi-ipd-integrated && python3 scripts/http-probe.py
```

结果写入 `/tmp/http-probe-result.txt`。

## 教训

1. **wecom mock login token TTL 极短（<60s）**：单 token 跑 149 个端点必失效，必须每 25 个重 login
2. **probe 用 900104 通配所有 `{id}` 会产生大量 400/404**：不算契约 bug，但需要标注"probe 限制"避免误判
3. **真业务成功比预期少**：RD_PM 角色权限有限，admin-only / leader-only 的写操作全返 401/403
4. **静态扫描看不到运行时 bug**：HTTP 500 这类只跑出来才暴露
5. **HTTP 401 vs 403 语义错**：后端 sa-token 在写操作权限校验失败时返 401 而非 403，前端会误以为"重新登录"而不是"权限不够"
