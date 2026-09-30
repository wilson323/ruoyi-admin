# ruoyi-ipd-web

本目录是用户明确选定的IPD正式RuoYi Vue管理前端，固定来源与运行命令见[README-IPD.md](README-IPD.md)。实际UI库为Ant Design Vue，pnpm固定10.14.0。不得用旧React原型、AI聊天前端或框架默认admin身份代替IPD实现。

- 本项目任务仍以 `/Users/mac/Documents/ruoyi-ai/docs/ipd-系统说明/开发计划-看板镜像.md` 为唯一事项源，本机看板为 `http://127.0.0.1:62250`。复用后端项目 Ruflo / ruoyi-vibe-kanban 技能，先认领及确认allowedPaths，再实现和验收；不在本仓另建台账或发布GitHub事项。
- 业务权威是后端 `docs/ipd-系统说明/工程合同/业务决策确认-20260905.md`、DOC-01～06及49页原规格。旧原稿只读，文档中的“已实现”不能替代当前HTTP/DB/浏览器证据。
- IPD `/api/v1` 使用code0/message包络、字符串ID及真实Person会话；不复用框架code200/msg、角色快照或递归日期转换。首登和冻结不得绕过导航与后端权限。
- 本机前端只监听127.0.0.1:15666，后端只代理127.0.0.1:16039；复用已运行的本项目服务，不杀其他端口进程，不接线上业务API。凭据不打印、不入版本库。
- **vite 必须 `node node_modules/vite/bin/vite.js` 直起，不要用 pnpm 包装**（pnpm 起的 vite 在 macOS 下会卡 read syscall，主线程 event loop 锁死，HTTP 全超时，代理不响应）。`pnpm run check:type / vitest / build:antd` 三条不受此坑影响。
- `pnpm run check:type`、`pnpm exec vitest run --config vitest.ipd.config.mts`、`pnpm run build:antd`。构建退出0仍要检查日志内TS诊断及声明产物；曾有TS4058把scrollbarRef声明降为any。不得放宽tsconfig、跳过文件或假绿。
- 未经用户明确要求不提交、推送、创建业务分支或发布。保留同目录未提交工作；跨Java/SQL修改须回原卡确认范围。

## Learned User Preferences

- 根因与验收必须绑文件、HTTP、库或运行态证据，禁止把推断当结论；用户已多次纠正「没选项目 / 走了副驾」这类先入为主解释。
- 「项目智能体」是独立产品入口，不要按副驾问答缺陷来解释界面行为；先核独立执行口是否接线，再谈文案与模型回复。
- 项目智能体对话按用户收藏的 21st.dev 组件对齐（tool-call、loading-state、ai-prompt-input），并多次要求与收藏稿百分百一致。能力包、模型、技能、工具只放在输入框加号里；未启用模型不要进选择器。左侧历史运行和产物必须跨刷新保留且可搜索；顶部六阶段按项目实况显示且不要改掉，选中只切视图。
- 项目智能体在意图阶段要判断并渲染是否需要计划、是否需要澄清；运行一开始切到「本次运行」。思考区折叠只留一行「思考」，正文留在限高区。界面仍用现有三栏，不要另起一套布局。
- 技能和工具从市场获取，但必须与本次运行的 skillNames / toolIds 同一套编号；不要把 MCP 市场（`/mcp/market`）的编号直接提交成 toolIds。
- 缺口与治理类任务用多专业智能体并行落地，不要停在清单或方案对比；用户说「继续」即推进实现。
- 回复用简体中文；结论先给裁决（闭环/部分闭环/未闭环），再给证据，不要模糊。
- 建议区卡片须按项目实况、当前阶段与未完成步骤实时生成，并在上下文中自动补上对应技能对该卡的优化提示词；不要用与阶段脱节的静态占位卡。

## Learned Workspace Facts

- IPD 助手「项目智能体」（workspace-mode `ai`）主发送走 `ProjectAgentPanel.submitText` / `createProjectAgentRun`，不回落 `streamCopilot`；「副驾咨询」（`classic`）仍走 `streamCopilot`。切换业务模式会中止并清空另一侧会话。
- 对话项目下拉来自 `listProjects()`，不过滤 `ACTIVE`；工作台摘要 `WorkbenchService.visibleProjects` 只收 `ACTIVE`。选中 `DRAFT`/`SUSPENDED` 时请求仍可带 `projectId`，但 `【项目上下文】` 会被静默置空，模型会自述没有项目上下文。
- 项目智能体产物应用对接后端已锁定路径 `POST /api/v1/agent-runs/{runId}/artifacts/{artifactId}/apply`，走既有 `AiDocumentService`。落库状态仍是 `GENERATED`，用户可见名只显示「待审核」；不要改审核语义，不要另开文档写入轨，也不要把索引写成 `READY`。
- 项目智能体只认 `org.ruoyi.ipd.agent` / `ProjectAgentController` 单轨。技能由 `ProjectAgentRunPlanner` 合并请求 skillNames 与本次 `actionCode` 在 `ipd_action_skill_map` 的绑定，仅当 classpath `ipd-skills/<name>/SKILL.md` 可加载时注入系统提示；`AgentScopeProjectAgentKernel` 仍 `skillsEnabled(false)` / `disableDynamicSkills`。不要开 `chat.kernel.agentscope.enabled`，不要给聊天内核填 Toolkit，也不要在前端对接第二套 run/文档 API。
- 项目智能体可选 toolIds 来自能力包目录，与框架 MCP 市场 `/mcp/market` 不是同一套编号；市场上未纳入当前能力包的条目不能勾进本次运行。
- 意图是既有 `STEP` 的 `kind=INTENT`（`needsPlan` / `needsClarification` / `questions` / `steps`），不要新增事件枚举。需要澄清，或需要计划且未绑定动作时，运行迁到 `WAITING_APPROVAL` 并写 `STEP` `kind=AWAIT_USER`，不调用内核；已绑定动作的步骤来自技能「步骤」节后再执行。提示词里的「不要调工具」不是闸门。不要调用 `enablePlanMode()`，也不要写 `plans/PLAN.md`。
- 本人在该项目的运行列表是 `GET /api/v1/projects/{projectId}/agent-runs`（前端 `listProjectAgentRuns`，参数 `q` / `status` / `actionCode` / `cursor` / `limit`）。搜索只匹配动作、状态、产物标题和正文；响应不含提问原文或 `inputDigest`。空结果文案是「没有匹配的运行」。产物点赞只认事件里的字符串 `versionId`；定档仍用逻辑 artifactId。
- 附件只接规格要求的入口：深管动作交付物和 Gate 评审材料走 multipart；回款凭证走 `POST /api/v1/receipt-ledgers/projects/{projectId}/voucher`（超管上传，服务端落地址和哈希）。负反馈只有文字证据。轻管动作、报表、轨迹、P0 升级不加上传。游客需求门户还没有附件列。
- Work Buddy 产品中心 CSV（型号主档 / 分类汇总）与本机 `ipd_dev.products` 的主键、编码、型号、名称交集为 0；分类名「考勤产品」等不能别名折进 `attendance` / `access-control` / `video`，对不上就不写 `product_line_members`。
- 产品知识库种子已落入 `knowledge_info` / `knowledge_attach` / `knowledge_fragment`；方法论要求的 17 项必填元数据现表无对应列，不要加列硬塞，也不要把索引进度写成 `READY`。
