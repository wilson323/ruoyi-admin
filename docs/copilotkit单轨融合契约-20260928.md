# CopilotKit 单轨融合契约（2026-09-28）

> **SSOT 声明**：本文档是 CopilotKit 单轨生成式 UI 融合（onboarding run `8a82cca1836f`）的
> 唯一契约源。前端渲染层（本仓）与 Java AG-UI 桥（并行子代理，ruoyi-ai 仓）均以本文档为准。
> 核心映射语义已锁定（§4/§5），实现方只可补充细节字段，**不得改语义**。
>
> 前端实现落点：`apps/web-antd/src/views/ipd/_shared/ai-cards/copilotkit-render.ts`
> + `ai-assistant.vue`（P3-01 段）。单测：`copilotkit-render.test.ts`。

---

## 1. 背景与范围

既有 AI 副驾栈（`ai-assistant.vue` 宿主 + `api/ipd/ai-copilot.ts` 四帧 SSE +
`ai-cards/card-registry.ts` 卡片注册表）已稳定运行。本次融合在**既有栈上挂 CopilotKit
生成式 UI 渲染层**，使 Java 侧后续可通过 AG-UI 事件流下发结构化卡片工具调用，
前端以 `useRenderTool` 渲染既有注册表组件。

### 1.1 单轨红线（开发者硬约束，违反即失败）

| # | 红线 | 本方案落点 |
|---|------|-----------|
| 1 | 不开第二个聊天 UI | 只在 `ai-assistant.vue` 内挂 `CopilotKitProvider` + renderless 渲染宿主，无任何新聊天窗口组件 |
| 2 | 不建平行卡片体系 | 渲染器 = `card-registry.ts` 4 组件原样复用；(type, version) 查表复用 `getCardType` |
| 3 | 不删文本降级路径 | 未命中注册表/信封非法一律纯文本降级提示，四帧文本通道零回归 |
| 4 | 不加新写入端点（C08） | 渲染层 confirm 只收组件 emit 转发，零写库/请求路径 |
| 5 | 不复制校验逻辑防双轨 | R2/R3 过检仍在 `ai-assistant.vue` 四帧通道执行，渲染层不复制（见 §7 遗留项） |

---

## 2. 术语与事实源

| 术语 | 含义 | 事实源 |
|------|------|--------|
| 四帧 | 现有 SSE 帧：`meta` / `delta` / `done` / `error` | `apps/web-antd/src/api/ipd/ai-copilot.ts` |
| AiCardEnvelope | done 帧可选超集四键：`{type, version, data, sourceRefs}` | `ai-cards/types.ts` |
| 卡片注册表 | `(type, version)` → 组件唯一映射（4 卡） | `ai-cards/card-registry.ts` |
| AG-UI 事件族 | RUN_*/TEXT_MESSAGE_*/TOOL_CALL_*/STATE_DELTA | 官方文档缓存 `3d260c14/5e20b49b.txt` |
| Runtime 面 | GET /info + POST /agent/:agentId/run（多路由） | 官方文档缓存 `3d260c14/e567faa9.txt` |
| useRenderTool | Vue 生成式 UI 渲染器注册 | `@copilotkit/vue@1.74.0` `/v2` 子路径 |

---

## 3. Runtime 面契约（Java 桥实现，前端消费）

### 3.1 多路由最小面（默认形态）

Java 侧 basePath = `/copilotkit`；前端经 vite 代理以 `runtimeUrl="/api/copilotkit"` 访问
（vite 规则：`/api` 非 `/api/v1` 前缀剥 `/api` 转发 127.0.0.1:16039，故 Java 实收 `/copilotkit`）。

| 方法 | 路径（Java 实收） | 请求 | 响应 |
|------|------------------|------|------|
| GET | `/copilotkit/info` | 无 body | `200 application/json`，runtime info + agents 元数据 |
| POST | `/copilotkit/agent/ipd_copilot/run` | AG-UI `RunAgentInput`（JSON） | `200 text/event-stream`，AG-UI 事件流 |

**GET /info 响应形状**（`@copilotkit/core` 实证，最小面）：

```json
{
  "version": "1",
  "agents": {
    "ipd_copilot": {
      "description": "IPD AI 副驾（四帧桥接）",
      "capabilities": []
    }
  }
}
```

> `agents` 为 `Record<string, {description, capabilities}>` 形态；`a2ui` / `licenseStatus`
> 等可选键不需要（本融合不启用 A2UI）。agentId 必须为 **`ipd_copilot`**（锁定）。

**POST /agent/ipd_copilot/run 请求**：body = AG-UI `RunAgentInput`
（`threadId` / `runId` / `messages` / `state?` / `tools?` / `context?` / `forwardedProps?` 等，
字段面以 AG-UI 文档缓存 `e567faa9.txt` 为准）。Java 侧不需要消费 `messages` 全量语义做
多轮拼接（现有后端自持上下文三档），但必须容忍任意合法 RunAgentInput 并按 §4 产出事件流。

**请求头**（两端约定）：

```
Content-Type: application/json
Accept: text/event-stream
Authorization: Bearer <token>        # 与既有四帧同口径：token 走 header，URL 不收 token
```

### 3.2 单路由备选（探针①结论允许的切换形态）

若运行时 auto 传输探测（`useSingleEndpoint` 省略）在联调中不达预期，按官方文档切
**单路由**：单个 `POST /copilotkit`，body 为 JSON envelope `{method, params, body}`，
响应同为 `text/event-stream`。切换动作：

- Java 侧：增加单路由 POST 分发（或多路由与单路由并存）；
- 前端：`CopilotKitProvider` 加 `:use-single-endpoint="true"`（当前**省略 = auto**）。

该切换只改形态不改 §4/§5 语义，切换后须在本节补记实测结论。

### 3.3 SSE 线格式（AG-UI 标准，`@ag-ui/encoder` 实证）

```
data: {"type":"RUN_STARTED","threadId":"...","runId":"..."}\n\n
data: {"type":"TEXT_MESSAGE_START","messageId":"..."}\n\n
data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"...","delta":"..."}\n\n
...
```

- 每事件一行 `data: <event JSON>\n\n`，**无 `event:` 行**，事件 JSON 自带 `type` 字段；
- 响应头：`Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-cache`、
  `X-Accel-Buffering: no`（防代理缓冲）；
- 流末以 `RUN_FINISHED` / `RUN_ERROR` 收尾（不发 `data: [DONE]` 非标准哨兵）。

---

## 4. 四帧 → AG-UI 事件映射对账表（语义锁定）

### 4.1 帧级映射

| 四帧 | AG-UI 事件序列 | 说明 |
|------|---------------|------|
| `meta` | `RUN_STARTED` | `threadId`/`runId` 取本轮流上下文（Java 生成，唯一） |
| `delta`（首个） | `TEXT_MESSAGE_START` + `TEXT_MESSAGE_CONTENT` | `messageId` Java 生成；START 只发一次 |
| `delta`（后续） | `TEXT_MESSAGE_CONTENT` | `delta` 字段 = 帧 token 文本 |
| `delta`（收尾，即 done 前） | `TEXT_MESSAGE_END` | 本轮有 delta 才发 START/CONTENT/END；无文本跳过整组 |
| `done` + `fillPayload` | `STATE_DELTA` + `RUN_FINISHED` | STATE_DELTA 为 RFC 6902 JSON Patch（见 §4.3） |
| `done` + `card` | `TOOL_CALL_START` + `TOOL_CALL_ARGS` + `TOOL_CALL_END` + `TOOL_CALL_RESULT` | 见 §4.2 |
| `done`（纯结束） | `RUN_FINISHED` | 无 fillPayload 无 card |
| `error` | `RUN_ERROR` | 携错误信息文本 |

### 4.2 单轮完整事件序列（done 同时带 card 时）

```
RUN_STARTED
TEXT_MESSAGE_START (messageId=M1)
TEXT_MESSAGE_CONTENT xN (delta=token)
TEXT_MESSAGE_END
TOOL_CALL_START (toolCallId=T1, toolCallName=card.type)
TOOL_CALL_ARGS (toolCallId=T1, delta=JSON.stringify(card.data))
TOOL_CALL_END (toolCallId=T1)
TOOL_CALL_RESULT (toolCallId=T1, content=JSON.stringify({version, sourceRefs}))
[STATE_DELTA]        ← done 同时带 fillPayload 时
RUN_FINISHED
```

若一轮带多张 card（现协议 done 单 card；多卡为前向兼容）：TOOL_CALL_* 组按序逐卡，
每组之间不插 TEXT_MESSAGE_*。

### 4.3 字段级映射（细节补充，不改语义）

| 四帧字段 | AG-UI 事件字段 | 备注 |
|----------|---------------|------|
| meta 会话上下文 | `RUN_STARTED.threadId` / `.runId` | Java 生成唯一 id |
| delta token | `TEXT_MESSAGE_CONTENT.delta` | 字面 |
| card.type | `TOOL_CALL_START.toolCallName` | **= useRenderTool 注册 name = 注册表键** |
| card.data | `TOOL_CALL_ARGS.delta` = `JSON.stringify(card.data)` | 锁定语义「data JSON」字面采纳 |
| card.version + card.sourceRefs | `TOOL_CALL_RESULT.content` = `JSON.stringify({version, sourceRefs})` | 锁定语义的细节补充：version/sourceRefs 经 RESULT content 传递（TOOL_CALL_ARGS 只承载 data） |
| —（生成） | `TOOL_CALL_START.toolCallId` | Java 生成全局唯一（如 `card-<seq>-<uuid8>`，规则 Java 自定） |
| fillPayload | `STATE_DELTA`（RFC 6902 JSON Patch 数组） | patch 的 `path` 语义 Java 自定；前端当前不消费 state（见 §7） |
| error 文本 | `RUN_ERROR.message`（字段名以 AG-UI 文档缓存为准） | |

**（type, version) 过检不变量**：前端渲染层以 `toolCallName` 当 type、`TOOL_CALL_RESULT`
content 解析出的 `version` 过注册表检查（`getCardType(type, version)`），与四帧通道
`(type, version)` 语义完全一致。**Java 侧必须保证 version 与 card.version 字面一致。**

---

## 5. 渲染映射对账表（card envelope → useRenderTool props → 组件 props）

`useRenderTool` 渲染器 props 形态（`@copilotkit/vue@1.74.0` 实证；判别联合
`RenderToolProps` 未从包顶层导出，前端以本地等价类型 `CardToolRenderProps` 钉死，
见 `copilotkit-render.ts`）：

| useRenderTool props | 来源（AG-UI） | → 注册表组件 props | 裁决用途 |
|---------------------|---------------|-------------------|----------|
| `name` | `TOOL_CALL_START.toolCallName`（= card.type） | 不进组件 | 注册表查找键、渲染器匹配键 |
| `toolCallId` | `TOOL_CALL_START.toolCallId` | 不进组件 | 渲染 key（Vue key） |
| `status` | 生命周期推导：`inProgress`（ARGS 流中）→ `executing`（ARGS 完）→ `complete`（RESULT 达） | 不进组件 | **complete 前只出占位**（官方 guard-on-status） |
| `parameters` | `JSON.parse(TOOL_CALL_ARGS.delta)` = card.data | **→ `data` prop**（类型 `AiCardData`） | data 形态最小校验（对象判别） |
| `result` | `TOOL_CALL_RESULT.content` 串 | 不进组件 | 解析 `{version, sourceRefs}` → (type, version) 过检 |

组件侧既有契约（零改动复用）：`data: AiCardData` prop + `confirm` emit
（例 `gate-precheck-card.vue`）。`confirm` emit → 宿主 `onConfirm` 转发（C08 零直写）。

### 5.1 降级裁决（与既有降级铁律同口径）

| 条件 | 裁决 |
|------|------|
| `status !== 'complete'` | 占位文案（`ipd-cpk-card-pending`），不出卡 |
| `result` 缺失/非法（非 JSON/非对象/version 非有限数/sourceRefs 非对象） | 纯文本降级（`ipd-cpk-card-degraded`） |
| `getCardType(name, version)` 未命中（未知 type 或版本不符） | 纯文本降级 |
| `parameters` 非对象 | 纯文本降级 |
| 命中且形态合法 | 渲染注册表组件（`data`=parameters、`onConfirm`=转发） |
| tool name 不在 4 卡注册表 | `useDefaultRenderTool()` 通配兜底（内置默认卡） |

**文本路径永不删**：四帧 `delta` 文本渲染通道与 `ipd:ai-fill-payload` 回填通道零改动。

### 5.2 渲染器注册（前端落点）

- 文件：`ai-cards/copilotkit-render.ts` → `useIpdAiCardRenderers()`：
  按 `listCardTypes()` 逐 type `useRenderTool({name: type, parameters: 宽松 record, render})`
  + `useDefaultRenderTool()` 兜底；
- 参数 schema 取 `z.record(z.string(), z.unknown())`（只约束对象层）：**不造第 4 面
  schema 镜像**，数据形态 SSOT 仍是 `types.ts`/Catalog；
- 注册不带 agentId（渲染器匹配语义：无 agentId 的渲染器匹配任意 agent 的同名调用）；
- 挂载：renderless `IpdAiCardRenderHost` 作为 `CopilotKitProvider` 子组件
  （`useRenderTool` 依赖 provider context，不可同级 setup 调用）。

---

## 6. 三探针结论（互操作取证，全部有据）

### 探针① runtimeUrl 形态 / 鉴权传递

- **多路由最小面成立**：`GET {runtimeUrl}/info` + `POST {runtimeUrl}/agent/{agentId}/run`；
  HttpAgent 请求头 `Content-Type: application/json` + `Accept: text/event-stream`
  （`@ag-ui/encoder` + `@copilotkit/core` bundle 实证）；
- **GET /info 必要**：provider 启动拉取 agents 元数据，失败报 `runtime_info_fetch_failed`
  ——Java 侧必须实现；
- **鉴权**：`CopilotKitProvider` `headers` prop 支持 `Record<string,string> | 函数`，
  函数式每次请求求值（适配 token 轮换），与既有 Bearer header 方案对齐
  （`copilotKitAuthHeaders()`：无 token 不发 Authorization 键）；
- **useSingleEndpoint**：省略 = auto 探测（1.74.0）；provider **无 agentId prop**
  （agent 选择在 run 时由调用方指定），当前挂载省略 useSingleEndpoint 走 auto，
  不达预期时按 §3.2 切换单路由；
- **auto 握手顺序（运行期实证，vitest 挂载宿主捕获，U1 部分消解）**：
  ① `GET {runtimeUrl}/info`（headers={headers prop 求值}）→ ② 失败（非 2xx/网络错）
  后回退单路由探测 `POST {runtimeUrl}` body=`{"method":"info"}`（Content-Type:
  application/json）→ ③ 均失败时报错但 provider 仍可用（渲染器注册不受影响）。
  **推论：Java 桥只要 GET /info 成功返回 §3.1 形状，auto 即锁定多路由传输，
  不会发单路由探测**；`headers` 函数在 provider setup 期即被求值一次（computed 包裹），
  故前端 `copilotKitAuthHeaders()` 对无 active pinia 边界防御性返回 `{}`（无 token
  上下文 = 不发 Authorization，与「无 token」同口径）。

### 探针② 版本兼容

- `@copilotkit/vue@1.74.0`（npm 实测最新稳定版，≥1.70.0 约束满足），peer
  `vue >= 3.3.0`，本仓 Vue 3.5.25 满足；
- 走 pnpm workspace catalog（`pnpm-workspace.yaml` catalog 键 + `apps/web-antd`
  `"@copilotkit/vue": "catalog:"`），传递依赖由 pnpm lock 锁定；
- `pnpm install` 无新增 peer 警告；`check:type` / `build:antd` 通过（见 §8 验证记录），
  Vben 5.5.9 闭包与 `/v2` 子路径导入（`exports` 实证：`.` / `./v2` / `./styles.css`）无冲突。

### 探针③ card envelope → useRenderTool props 映射

- 对账表见 §5（`name`=card.type、`parameters`→`data` prop、`result`=JSON{version,
  sourceRefs}、`status` 三态守卫）；
- 渲染器匹配语义（core bundle 实证）：按 name 过滤 → agentId 精确 → 无 agentId
  渲染器 → 任意 → 通配 `*`；
- `useRenderTool` 与 `useFrontendTool` 的渲染 props **两套不通用**（前者
  `{name,toolCallId,status,parameters,result?}`，后者 `{args,status}`）——本融合只用
  `useRenderTool` 系，不混用；
- props 形态由 `copilotkit-render.test.ts` 同名单测钉死（纯函数面）。

---

## 7. 双端职责切分 + 未证明项 + 遗留项

### 7.1 职责切分

| 端 | 职责 | 落点 |
|----|------|------|
| **Java AG-UI 桥**（并行子代理） | 实现 §3 Runtime 面两路由 + Bearer 校验（复用现有鉴权 filter）；把 AiCopilotService 四帧流按 §4 翻译为 AG-UI 事件 SSE；**不新增写入端点（C08）**；version 与 card.version 字面一致 | ruoyi-ai 仓（按本文档实现） |
| **前端**（本子代理） | `CopilotKitProvider` 挂载（runtimeUrl=/api/copilotkit + headers Bearer）；§5 渲染层注册 + 兜底 + 降级铁律；契约文档；四帧通道零回归 | `copilotkit-render.ts` / `ai-assistant.vue` P3-01 |

### 7.2 未证明项（探针无法静态证明，标注如实）

| # | 未证明项 | 现状 | 消解途径 |
|---|---------|------|---------|
| U1 | Provider auto 传输探测对纯 AG-UI 面的实际握手（多路由 vs 单路由） | **握手顺序已运行期实证**（§6 探针①：GET /info → 失败回退 POST {method:info}）；对**真 Java 桥**的联调未跑 | Java 桥就绪后联调（GET /info 成功即锁多路由）；失败则 §3.2 切单路由（前后端一行级改动） |
| U2 | Vue 3.5.25 + Vben 5.5.9 运行期闭包（SSR/keep-alive/多实例下 provider 行为） | check:type + build 静态证明通过 | proof 子代理 dev server（15666）round-trip 实测 |
| U3 | TOOL_CALL_* 事件流驱动渲染器三态推进的端到端行为（含 messageFilter、工具配对修复） | props 形态与匹配语义已 bundle 实证 + 单测钉死；真流未跑 | 同 U2，round-trip 时用 Inspector 看状态迁移 |

### 7.3 遗留项

| # | 遗留项 | 说明 |
|---|--------|------|
| L1 | CopilotKit 路径的 R2/R3 镜像（schema 外字段丢弃 / sourceRefs 对账）未接入渲染层 | 防双轨禁复制校验逻辑（`enforceCardRenderRules` 留在四帧通道）；待定是否抽出共享校验模块（须单独评审，不在本单） |
| L2 | 渲染面呈现接线 | 本单只挂渲染器注册（renderless），CopilotKit 消息渲染输出与既有抽屉/`ipd-ai-card-host` 的呈现接线属 round-trip proof 范畴（单轨红线：接线也必须挂既有宿主，不开新聊天 UI） |
| L3 | fillPayload → STATE_DELTA 的 RFC 6902 patch `path` 语义 | Java 侧自定；前端当前不消费 state（渲染层只读 tool call），前端消费时再补约定 |
| L4 | toolCallId 命名规则 | 唯一即可，Java 自定 |
| L5 | 多 card 单轮（前向兼容） | 现协议 done 单 card；§4.2 已给多卡序列，Java 桥按单卡实现即可 |
| L6 | text 降级路径与四帧通道 | 零改动保留（铁律）；CopilotKit 路径的文本呈现随 L2 一并接线 |

---

## 8. 验证记录（前端，2026-09-28）

见运行记录（本文档随 PR 附验证输出）：

| 命令 | 结果 |
|------|------|
| `pnpm run check:type`（根，turbo run typecheck） | EXIT 0（首跑一处 render 回调隐式 any → 显式 `CardToolRenderProps` 标注后全绿，37 包） |
| `pnpm exec vitest run --config vitest.ipd.config.mts`（**仓根**，非 apps/web-antd） | EXIT 0（135 文件 / 1535 用例；`copilotkit-render.test.ts` 14 用例新增全绿） |
| `pnpm run build:antd`（根，turbo build） | EXIT 0（11/11 tasks，36.32s，日志无 TS 诊断） |

> vitest 适配说明：① `copilotKitAuthHeaders` 首版在无 active pinia 测试边界抛错
> （Provider headers computed setup 期即求值）→ 已防御降级返回 `{}` 并补同名单测；
> ② `ai-assistant.test.ts` ⑥/⑬ 的「零任何 fetch」断言被 CopilotKit runtime 只读探测
> （§6 探针①）误伤 → 断言收窄为 C08 本义口径（零 `/api/v1` 直写 + 零 `/agent/` run
> 触发），语义更精确，卡片层零直写铁律覆盖不减。

> 本阶段不起 dev server；round-trip 证明归 proof 子代理（U2/U3/L2）。
