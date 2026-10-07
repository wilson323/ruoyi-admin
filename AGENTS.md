# ruoyi-ipd-web

## 工程任务的防复发入口

后续工程任务默认读 [.harness/skills/ipd-engineering-feedback/SKILL.md](.harness/skills/ipd-engineering-feedback/SKILL.md)，并在当前根目录运行 `python3 scripts/engineering_harness.py --root "$PWD" intake`。沿既有总画布与看板确认范围；工程机制验收用 `bash .harness/verify.sh governance <事项编号>`，前端交付用 `bash .harness/verify.sh frontend <事项编号>`。入口自动记录失败、提出待核实反思问题，同事项完整回归后只启用固定工程检查项；不自动改核心安全/权限/业务审批。输入、验证器或产物改变时旧证据失效。工具回归不代表模型行为、运行包加载或业务全量验收；本导航不保证所有 IDE 工具调用已强制拦截；提交推送按 2026-10-07 规则（任务结束必整合工作树）执行。

本目录是用户明确选定的IPD正式RuoYi Vue管理前端，固定来源与运行命令见[README-IPD.md](README-IPD.md)。实际UI库为Ant Design Vue，pnpm固定10.14.0。不得用旧React原型、AI聊天前端或框架默认admin身份代替IPD实现。

- 本项目事项登记仍以 `/Users/mac/Documents/ruoyi-ai/docs/ipd-系统说明/开发计划-看板镜像.md` 为唯一事项登记源（执行顺序以总画布为准），本机看板为 `http://127.0.0.1:62250`。复用后端项目 Ruflo / ruoyi-vibe-kanban 技能，先认领及确认allowedPaths，再实现和验收；不在本仓另建台账或发布GitHub事项。
- 业务权威是后端 `docs/ipd-系统说明/工程合同/业务决策确认-20260905.md`、DOC-01～06及49页原规格。旧原稿只读，文档中的“已实现”不能替代当前HTTP/DB/浏览器证据。
- IPD `/api/v1` 使用code0/message包络、字符串ID及真实Person会话；不复用框架code200/msg、角色快照或递归日期转换。首登和冻结不得绕过导航与后端权限。
- 本机前端只监听127.0.0.1:15666，后端只代理127.0.0.1:16039；复用已运行的本项目服务，不杀其他端口进程，不接线上业务API。凭据不打印、不入版本库。
- **vite 必须 `node node_modules/vite/bin/vite.js` 直起，不要用 pnpm 包装**（pnpm 起的 vite 在 macOS 下会卡 read syscall，主线程 event loop 锁死，HTTP 全超时，代理不响应）。`pnpm run check:type / vitest / build:antd` 三条不受此坑影响。
- **从 IDE 终端重启 vite 必须 `env -u VSCODE_INSPECTOR_OPTIONS -u NODE_OPTIONS` 前缀**（2026-10-06 D18）：IDE 调试 auto-attach 会 SIGSTOP node 子进程（状态 T/TN、flags 含 traced 位，kill -CONT 无效、KILL 才退），端口监听但零响应、代理全挂、前端 15s 超时转 ERR_ABORTED。同轮另一坑：vite 7 自研 proxy（非 http-proxy 库）的 `proxyReq.removeHeader(...)` 会让该代理所有请求挂死无响应（A/B/C 对照实证），改写 header 一律用 `setHeader`（vite.config.mts 内已留禁改注释）。
- `pnpm run check:type`、`pnpm exec vitest run --config vitest.ipd.config.mts`、`pnpm run build:antd`。构建退出0仍要检查日志内TS诊断及声明产物；曾有TS4058把scrollbarRef声明降为any。不得放宽tsconfig、跳过文件或假绿。
- 2026-10-07 owner 明令（写入规则）：每次任务执行结束必须整合工作树——本任务全部产物（代码、文档、台账、log）commit 并 push 到本仓固定远程分支（前端 `origin/teardown/incentive-removal`；后端仓为 `origin/baseline/pre-teardown`）。推送目标仍限 owner 指定私有仓；兄弟会话在途文件不卷入、保留工作树并在任务报告中列明；推送前核对远端基线。跨 Java/SQL 修改须回原卡确认范围。

## 当前任务范围与证据

- 2026-10-02 最新用户目标优先：AgentScope 官方能力全量启用、禁止禁用、禁止降级，以 `/Users/mac/Documents/agentscope-java` 真实源码为参考确保完整应用。此指令覆盖 ADR-0077“按需关闭”及下文历史禁开口径；业务闸门（技能 owner 拍板、审批流、权限、文档审核、动作批准与 Gate）保留并经官方扩展点挂载。能力启用不授予具体业务操作权限；源码版本差异须现核，目标不等于运行验收，禁止静默回退或空实现。


- 2026-10-06 最终分支铁律（owner 明令）：后续全部工作固定在当前分支收口，此为最终分支——本仓（前端 ruoyi-ipd-web）为 `teardown/incentive-removal`，后端仓（ruoyi-ai）为 `baseline/pre-teardown`。不新建分支、不切换分支、不向 `main` 或其他分支合并/变基作为「最终交付」；授权推送时只推各自同名远程分支（`origin/teardown/incentive-removal` / `origin/baseline/pre-teardown`）。本条落实 `CLAUDE.md` 推送铁律的分支固定；推送授权已由 2026-10-07 规则更新（任务结束必须整合工作树提交推送，见上文「任务执行结束必须整合工作树」条），等逐次授权与「不主动建议推送」口径废除；推送仍只落固定分支。ZK-IPD 不是 git 仓库，无分支约束。
- IPD 执行顺序和下一刀只认 `/Users/mac/.cursor/projects/Users-mac-Documents-ruoyi-ipd-web/canvases/ipd-execution-plan.canvas.tsx`；本地看板与镜像登记同一计划的事项、allowedPaths 和验收，分节仅作细化。冲突先核总画布，不从旧卡或分节另开执行轨。
- 开始或接续任务先明确本次目标、所属仓库、允许路径和证据来源。用户对上一段话的纠正不是新的业务需求；无关设备、登录项、软件安全调查不推导 IPD 缺陷。现有 Work Buddy 产品资料引用只证明资料来源，不证明软件运行依赖或安全关系；CodeBuddy 等开发工具名称也不证明业务依赖。用户明确扩大任务范围时按本次目标处理。
- 历史会话、记忆、画布和卡面只提供查证线索。PID、包版本、端口、数据库状态、已加载与验收结果必须现查；有时间戳也不代表当前仍有效。未回读用待验证，禁止用一个样本扩成全项目结论。
- 本规则约束工程执行，不给项目智能体追加业务提示词，不修改业务权限；没有证据不把工程助手的错误归因于产品代码。
- 计划或指令变更后运行 `python3 /Users/mac/Documents/ruoyi-ipd-web/scripts/check-ipd-plan-context.py`；它只检查这些入口的已知冲突，不能证明模型永不误判或业务已验收。

## Learned User Preferences

- 对用户输出必须说人话：用简体中文直接说明具体事项、目前做到哪里、还缺什么，以及怎样才算做完。结论先给裁决（闭环/部分闭环/未闭环），再给证据。禁止用任务编号、卡号、状态码、内部缩写或配置键代替事项说明；必要技术名称须先解释含义，编号仅可作为附带查证信息。未完成事项必须区分“还要补实现”和“代码已改但尚未实际验收”，不得只报测试数量或堆术语。

- 根因与验收必须绑文件、HTTP、库或运行态证据，禁止把推断当结论；用户已多次纠正「没选项目 / 走了副驾」这类先入为主解释。工具调用成功或结构化输出不能单独证明事实正确，数字、年份、单位和引用要另验。每次改代码前先列六行缺口再读文件：仓库、入口、服务边界、表和字段、现状与目标、证据等级。A 级（源码、配置、接口回读、库查询）才写入实现；B 级（文件名、注释、说明文档）先交叉验证；命名推断和文档里的「已实现」只当假设。密钥、口令、生产地址不进上下文。架构边界、规则是否全局、能否上线仍由人裁决。
- 做完过四层再回流：编译或类型检查、需求在测试或 HTTP 或页面上发生、没有越过已有边界、上下文与代码一致且 127.0.0.1:16039 已加载这次产物。只把下一次同类需求还会用到且已有 A 级证据的事实写回本段或总计划对应节；当次临时结论不晋升。不另建知识库目录。
- 「项目智能体」是独立产品入口，不要按副驾问答缺陷来解释界面行为；先核独立执行口是否接线，再谈文案与模型回复。运行失败要标明不可用和恢复入口，不能悄悄改走副驾。
- 项目智能体对话按用户收藏的 21st.dev 组件对齐（tool-call、loading-state、ai-prompt-input、可点选问题），并多次要求与收藏稿百分百一致。点选只取选中和已答禁用的交互，不要往项目里加组件依赖。能力包、模型、技能、工具只放在输入框加号里；未启用模型不要进选择器。左侧历史运行和产物必须跨刷新保留且可搜索；顶部六阶段按项目实况显示且不要改掉，选中只切视图。
- 意图、澄清、计划和执行要在现有三栏里分开，不要再堆建议卡，也不要按阶段另做一套卡片生成器。对话列只留用户句和「思考」/正文；意图、步骤和生成预览在右侧「本次运行」，小阶段在右侧「步骤」页签选择。运行一开始切到「本次运行」。澄清点选写入「已选：…。」后仍走原来的创建运行，该题选项禁用；未绑定计划的确认是「开始执行」「先改范围」。思考区折叠只留一行「思考」，正文留在限高区，不长期保存模型原始内部推理。生成的文档和整页 HTML 在生成当时就出现在「本次运行」，不等到定档；整页 HTML 进隔离框，以标题开头的文档用纯文本，普通短回答和图片片段不出预览。左栏定档仍是事后入档。不要另起布局，不要新开第二条发送轨。运行回读不要出现空的「步骤」行、过程自述或内部编号。历史里的「已完成」只表示这次运行结束，不是小阶段做完；小阶段完成要同时生成完整文件，并且用户点了任务完成。
- 技能和工具从市场获取，但必须与本次运行的 skillNames / toolIds 同一套编号；不要把 MCP 市场（`/mcp/market`）的编号直接提交成 toolIds。
- 缺口与治理类任务用多专业智能体并行落地，不要停在清单或方案对比；用户说「继续」或授权整段计划后做到完，不要中途停住。用户已说以后不要再为执行动作回来要书面授权：出站模型调用、本地库写入和重新加载运行包按总计划直接做。授权后自己执行到生产就绪，不要只巡检，也不要把下一步排回给用户。卡住时自己分清是设计缺口、测试数据还是运行包，把根因修掉再继续；没做完不要说全部完成。工程执行授权不代替业务负责人的文档审核、动作批准和 Gate。
- 阶段轨上的项目下拉不是每个页面都要有；产品线空间、产品目录这类不按单个项目工作的页面不要放项目选择。同一业务有两套页面时，清掉路由没接上、只被测试引用的那套，不要因为拿不准就两套都留。仍挂在路由上的页面留下。
- 深管动作的交付物由项目智能体生成，不要向用户索要交付物文件来填空。面向用户的页面和说明不要写「深管动作」、`status=`、`NOT_STARTED`、门禁配置键、业务规则编号或「超管配置」；产品负责人明确说这类内部词看不懂。阻碍推进用白话，例如「还没开始」「还没完成」。
- 进度、画布和结论必须与实时代码和已加载运行包一致；源码已提交但进程仍是旧包时，不能写成已生效。执行任务只认 `/Users/mac/.cursor/projects/Users-mac-Documents-ruoyi-ipd-web/canvases/ipd-execution-plan.canvas.tsx`。`ipd-agent-execution-plan.canvas.tsx` 只细化总计划里的「项目智能体」一节。其他画布只能细化总计划对应节，禁止双轨。扣子等本项目未使用的外部产品不要写进画布或工作计划。
- 在售型号和官网目录是产品主档底账，用来补产品线并规划从迭代建议到退市的生命周期，不要漂移成当前六阶段或批量立项。归属以官网目录和《国内产品结构细化表》为准，挂到目录线；没有产品线归属的主档删掉，不要留着未归属，也不要编造型号。可销售区域按国家。没有事实的限额、销量、竞品和国家不要编。万傲瑞达 V6600、ZKTime、ZKAccess3.5、E-ZKEco Pro、熵基互联是单独的软件产品线，不并进目录「其他」。用户没有明确说之前，不要把已有项目改挂到这些线上。官网目录端点与库内产品线名称不必逐字相等；已有对应关系（例如停车设备对车行产品）按对照挂上，不要因为字符串不相等就停掉对照表。没有事实对应的端点不要模糊别名到相近产品线名称。

## Learned Workspace Facts

下列条目是历史查证线索及设计约束。涉及运行包、数据状态或已生效的陈述须重新验证，不直接作为当前验收结果。

- IPD 助手「项目智能体」（workspace-mode `ai`）主发送走 `ProjectAgentPanel.submitText` / `createProjectAgentRun`，不回落 `streamCopilot`；「副驾咨询」（`classic`）仍走 `streamCopilot`。切换业务模式会中止并清空另一侧会话。浏览器断开不取消项目智能体的后台运行，前端轮询与后台运行分开；副驾请求流和 MCP 请求流各自按自己的取消约定处理。除项目智能体外，副驾、文档生成、建议、Gate 预审、招投标和向量化的出站都走 `org.ruoyi.ipd.service.ai.AiGateway`。副驾 SSE 是 `AiCopilotService#chatStream` → `AiGateway#stream`；后端没有 `streamCopilot` 方法。这些入口不要迁进 `ProjectAgent`。
- 对话项目下拉来自 `listProjects()`，不过滤 `ACTIVE`；工作台摘要 `WorkbenchService.visibleProjects` 只收 `ACTIVE`。选中 `DRAFT`/`SUSPENDED` 时请求仍可带 `projectId`，但 `【项目上下文】` 会被静默置空，模型会自述没有项目上下文。
- 项目智能体产物应用对接后端已锁定路径 `POST /api/v1/agent-runs/{runId}/artifacts/{artifactId}/apply`，走既有 `AiDocumentService`。落库状态仍是 `GENERATED`，用户可见名只显示「待审核」；待审核链头可以退回为 `REJECTED`，意见写入该行 `review_comment`。运行包若仍回答「仅 REVIEWED 行可拒绝」就是旧包。不要改审核语义，不要另开文档写入轨，也不要把索引写成 `READY`。定档的最终档案必须是原型 `ai_documents` 的同一套列和状态链，禁止用运行私有 `docType` 或第二张文档表当正文。定档必须先绑定动作；目录没有文档类型就拒绝，不用 `PROJECT_AGENT_ARTIFACT`。模型名取本次运行选中的配置，token 只累加本次模型调用，没有用量留空，不写成 0。已结束的运行不可原地返工；再做要另开关联的新尝试和产物版本，并保留原证据。
- 项目智能体只认 `org.ruoyi.ipd.agent` / `ProjectAgentController` 单轨。技能由 `ProjectAgentRunPlanner` 合并请求 skillNames 与本次 `actionCode` 在 `ipd_action_skill_map` 的绑定；classpath `ipd-skills/<name>/SKILL.md` 经 SHA-256 与清单一致后才注入系统提示。`skillsEnabled(false)` / `disableDynamicSkills` 只关掉 AgentScope 自行发现、刷新和加载，不表示技能没用。不要因此打开这两项或 `chat.kernel.agentscope.enabled`，不要给聊天内核填 Toolkit，也不要在前端对接第二套 run/文档 API。用户胶囊按 `personId` 跨该用户的项目生效，只作软先验，不授予访问权，不跨用户。技能草案写入 `ipd_action_skill_map` 须 owner 拍板，不随运行自动晋升。可选 toolIds 来自能力包目录，与框架 MCP 市场 `/mcp/market` 不是同一套编号，未纳入当前能力包的不能勾进本次运行。产线知识库 MCP 用 AgentScope 替换本项目分叉的接入：客户端按稳定 client name 登记，工具名走 listTools 的协议名。中文产品线展示名精确相等不是 AgentScope 或设计要求，展示名对不上不能当成没有知识来源。清理必须一刀做完，名称相等闸门和手写 JSON-RPC 客户端一起删，两条 MCP 路径不能并存。保留能力包服务标识和 `product_lines.mcp_service_id`。这一刀不把 AgentScope 从 2.0.3 升到 2.0.4，不引入 AgentScope Service（Vault/Sandbox/Temporal），不打开子智能体，也不把 workspace `MEMORY.md` 当业务事实源。本机对照源码在 `/Users/mac/Documents/agentscope-java`，该仓版本不能混用进本项目的 2.0.3。`disableSessionPersistence()` 在 2.0.3 是空操作，不能靠方法名判断会话是否落盘。AgentScope 状态版本不能替代数据库里的权限、版本和并发约束。
- 产品线空间由系统管理员增删改，负责人由系统管理员从该空间在职成员中指定。用户可加入多个空间，加入由该空间产品线负责人确认，系统管理员仍可代确认。新建项目必须先选产品线。侧栏「产品空间」是单产品工作台，不是产品线空间。产品目录包含各线下在售和在研产品，单个产品工作台从目录里该产品进入。空间汇总该线下全部产品的在售/在研状态、需求反馈和项目状态；一个产品可以对应多个项目。项目可以是新品或在售产品的迭代，由已加入该空间的用户创建，产品线负责人审批后才开工；没加入该项目的人看不到它。未批准前只有创建人、该线负责人和超管能看见；创建人在创建时就是项目成员。拒绝开工后停在未开工，创建人可改范围再提交，不另建项目，不复用草稿状态。该产品线负责人能看本线全部项目的列表、详情、阶段和产物，不能凭此改阶段、改产物或发起项目智能体；要操作须先成为该项目成员。退出空间或被撤职后这项查看收回。大阶段和小阶段在 AI 与传统模式下共用现有完成证据；验收通过必须提交人提交且该线负责人批准，提交人不能自批。这项批准已写进源码并已由 127.0.0.1:16039 加载：动作转到完成即提交并清空已有确认人，产线负责人写入已有确认人；没有负责人时只有超管能批，已有负责人时超管不能代批。大阶段提交写成 `PENDING_ACCEPT`，批准仍走原来的进入下一阶段。放行前复用 `GateEngine.check`，必做动作须已有确认人，未批准原因是「待产线负责人批准」；Gate 签署人未改。迭代必须选该线下在售产品；新品在负责人批准开工时才建在研产品并挂上该线。六阶段挂在项目上，在售主档不批量建项目。跨产品线或未确定产品线的项目放进「未指定产品线」空间，用户可选该空间；没有负责人时只有超管能批加入和开工。空间需求反馈用游客需求门户的现有需求单，由项目智能体结合知识绑定产品线，能明确时再绑定产品；还没有项目时，在该空间的固定分拣项目上走现有项目智能体，结果写回现有需求单。从产品线进入项目的 AI 必须与现有项目智能体同一形态、同一条 `ProjectAgentController` 运行口。产品线建空间、一对多唯一键、待开工、未指定空间和游客需求的产品线列仍未改库，产品是长期对象，项目是一次受治理的投资或变更。`products.project_id` 是首个项目指针，只表示这一含义；`uk_products_project` 只约束这一列，不能据此把产品与项目说成一对一或待证。项目全集在 `projects.product_id`，一个产品可以有多个项目。型号仍是 `products.model_code`，不另建型号表或版本表，也不要为了补缺口预先新建计划表或效果表。平台 User 与 IPD Person 不能按相同数字直接等同。
- 意图是既有 `STEP` 的 `kind=INTENT`（`needsPlan` / `needsClarification` / `questions` / `steps`），不要新增事件枚举。需要澄清，或需要计划且未绑定动作时，运行迁到 `WAITING_APPROVAL` 并写 `STEP` `kind=AWAIT_USER`，不调用内核；已绑定动作的步骤来自技能「步骤」节后再执行。提示词里的「不要调工具」不是闸门。不要调用 `enablePlanMode()`，也不要写 `plans/PLAN.md`。
- 本人在该项目的运行列表是 `GET /api/v1/projects/{projectId}/agent-runs`（前端 `listProjectAgentRuns`，参数 `q` / `status` / `actionCode` / `cursor` / `limit`）。搜索只匹配动作、状态、产物标题和正文；响应不含提问原文或 `inputDigest`。空结果文案是「没有匹配的运行」。产物点赞只认事件里的字符串 `versionId`；定档仍用逻辑 artifactId。组长、市场 PM、研发 PM、超管只能定自己发起的运行；审核仍走 `ipd:ai-document:review`。
- 附件只接规格要求的入口：深管动作交付物和 Gate 评审材料走 multipart；回款凭证走 `POST /api/v1/receipt-ledgers/projects/{projectId}/voucher`（超管上传，服务端落地址和哈希）。负反馈只有文字证据。轻管动作、报表、轨迹、P0 升级不加上传。游客需求门户还没有附件列。
- Work Buddy 历年型号在 `/Users/mac/WorkBuddy/2026-09-09-01-41-39/outputs/`，熵基官网产品中心是另一套在售目录（产品线、子品类、型号、参数），两套名称不要互相覆盖。两者都不建项目、不走 69 个动作。原空间仍是 `attendance` / `access-control` / `video`，分类名不能别名折进去。目录线用 `catalog-` 前缀另建并先写元数据，再按官网目录和《国内产品结构细化表》挂产品；没有归属的主档删除，不要编造型号写入 `product_line_members`，也不要留未归属。可销售区域按国家，中国站只记中国，区域站和城市网点不是国家，产品读回字段是 `sellableCountries`。竞品原文从已登录的 Work Buddy 桌面或其产出文件导入现有产品知识库，不另建库；健康检查口和未登录 CLI 不是对话口。`competitor-analysis-ipd` 只读本项目资料和用户输入、不联网，不要把网页搜索塞进这次运行，也不要另接搜索 API。
- 产品知识库种子在 `knowledge_info` / `knowledge_attach` / `knowledge_fragment`。方法论要求的 17 项必填元数据现表无对应列，不要加列硬塞。后灌的型号主档只是清单抽样，不是全量，缺行不要编造。唯一启用的官方对话模型是 MiniMax-M3，对话走 `api.minimax.cn`，向量两键不要写在这行上。不设月度 token 上限；没有预算行就是不限额，不要编一个数字写进去。文档嵌入与知识库嵌入共用 `BuiltinEmbeddingDefaults`：本机 Ollama `http://127.0.0.1:11434/v1`，模型名 `qwen3-embedding:0.6b`（不是展示名），维度 1024，无鉴权且不复用对话密钥。远端 `171.43.138.237:9997` 短文本会 HTTP 500，不要再当可用嵌入。不要新增 `ai_model_configs` 行，不要启用 `test-rag`，不要把索引进度写成 `READY`，也不要跑「待解析附件」解析（会清空来源备注）。项目资料检索在权限内同时读已审核文档和知识库片段；可见范围是当前项目库，或 `user_id=0` 且未挂项目的系统产品库。嵌入模型或向量库是否填写不决定正文能不能读到。向量不可用时正文仍要能读到，但正文硬搜不能代替把向量模型配成这一套；向量失败要明确报错，命中要带出处。检索要区分失败、部分成功、无结果和无权，不能把故障显示成未命中。未指定产品线时不要先让用户选知识库；按项目事实在已授权候选里选源，只有关键事实确实缺失才询问。不要另建第二套向量库。
- IPD WebSocket 同一账号只保留一条连接，新连接写入前用关闭码 1007 踢掉旧连接。前端遇到 1007（被顶替或票无效）不再自动重连；1006 仍重试。两个标签页时后打开的留下。
- ruoyi-ai 的 Glob/rg 整次失败，是因为 `.claude/skills` 跟踪了指向已不存在的 `~/.claude/ai-native-sdlc/skills` 的绝对符号链接；`rg --follow` 遇到仓库外或断掉的已跟踪链接会让整次搜索失败。技能链接只用仓库内相对路径且目标必须存在，第三方技能目录是 `~/.claude/ai-native-sdlc/baseline/skills`。
