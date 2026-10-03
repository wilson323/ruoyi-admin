import type { RouteRecordRaw } from 'vue-router';

import {
  IPD_PERMISSION_CODES,
  PAGE_PERMISSIONS,
} from '../../../views/ipd/_shared/ipd-permission-codes';

/**
 * IPD 路由（唯一登记处）。
 *
 * 规则（2026-10-01 导航收敛；路由仍全部登记，不删路径、不改 access / authority）：
 * - 侧栏常用入口只留五项，order 1–5：我的工作台、产品线、产品目录、我的项目、资料库；
 * - 产品目录仍是 authority SUPER_ADMIN，不把这项菜单扩给其他角色；
 * - 其余一级入口（含产品空间、招募、协同绩效、报表、移交、激励）hideInMenu，直链仍打开原页面；
 * - 原型 15 项路径和组件保留。原型非一级路由（审计日志/删除审核/KPI/激励）继续 hideInMenu；
 * - 后端未交付的能力在页内登记缺口（meta.ipdCard + meta.ipdBackend），不另挂占位页；
 * - 项目详情 8 个子页签、动作详情、编辑页等下钻路由 hideInMenu，用 activePath 保持菜单高亮；
 * - 游客门户（38/39）独立于后台布局，单独顶层注册。
 *
 * <p>权限码（V1 系统漂移修复）：所有页路由 meta.access 必须引用 _shared/ipd-permission-codes
 * 常量，禁止裸字面量；authority 仍为角色级（personType）门禁。
 */

const ipdLayoutRoute: RouteRecordRaw = {
  // 2026-09-11 菜单/UI 统一：本路由树经 routes/index.ts 并入 Root.children，与平台路由共用
  // 同一 vben BasicLayout 外壳；ipd.vue 只在带 projectId 的项目页挂阶段轨道。
  // 顶栏/侧栏/用户区/通知由 BasicLayout 承担；菜单由守卫统一构建（后端单一菜单树，IPD 分组置顶）。
  component: () => import('#/layouts/ipd.vue'),
  meta: { hideInBreadcrumb: true, title: 'IPD 工作台' },
  name: 'Ipd',
  path: '/ipd',
  redirect: '/ipd/workbench',
  children: [
    // ① 我的工作台（原型 /workspace，页03）
    {
      component: () => import('#/views/ipd/workbench/index.vue'),
      meta: { icon: 'lucide:house', order: 1, title: '我的工作台' },
      name: 'IpdWorkbench',
      path: 'workbench',
    },
    // 审计日志（页06）—— 原型非一级路由，降为隐藏（入口后续并入全流程轨迹/超级管理）；
    // 导航地图权限矩阵 page-level 分层：超管=全局/组长=本组/PM=本人，路由保留不断链
    {
      component: () => import('#/views/ipd/audit/logs/index.vue'),
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/audit-logs'] ?? [])], hideInMenu: true, icon: 'lucide:scroll-text', title: '审计日志' },
      name: 'IpdAuditLogs',
      path: 'audit-logs',
    },
    // ② 项目空间（原型 /projects，页07-15 及下钻）
    {
      component: () => import('#/views/ipd/project/list/index.vue'),
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/projects'] ?? [])], icon: 'lucide:target', order: 4, title: '我的项目' },
      name: 'IpdProjects',
      path: 'projects',
      children: [
        // 页08 新建项目（从列表按钮进入）
        {
          component: () => import('#/views/ipd/project/create/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/projects/create'] ?? [])], activePath: '/ipd/projects', hideInMenu: true, title: '新建项目' },
          name: 'IpdProjectCreate',
          path: 'create',
        },
        // 页09 存量项目导入
        {
          component: () => import('#/views/ipd/project/legacy-import/index.vue'),
          meta: { activePath: '/ipd/projects', hideInMenu: true, title: '存量项目导入' },
          name: 'IpdProjectLegacyImport',
          path: 'legacy-import',
        },
        // 项目详情（9 个子页签互相平级）
        {
          component: () => import('#/views/ipd/project/detail/index.vue'),
          meta: { activePath: '/ipd/projects', hideChildrenInMenu: true, hideInMenu: true, title: '项目详情' },
          name: 'IpdProjectDetail',
          path: ':projectId',
          redirect: (to) => `/ipd/projects/${to.params.projectId}/overview`,
          children: [
            {
              component: () => import('#/views/ipd/project/detail/overview.vue'),
              meta: { activePath: '/ipd/projects', hideInMenu: true, title: '项目概览' },
              name: 'IpdProjectOverview',
              path: 'overview',
            },
            {
              component: () => import('#/views/ipd/project/detail/flow.vue'),
              meta: { activePath: '/ipd/projects', hideInMenu: true, title: 'IPD 流程' },
              name: 'IpdProjectFlow',
              path: 'flow',
            },
            {
              // 页23 项目详情-Gate 评审 —— 2026-09-06 接 W3-A7：后端 GateReviewController 已交付（review/sign/reopen/arbitrate/final-ruling/extend-deadline）
              //    + 前端 gate-panel.vue 真组件；项目维度 Gate 列表端点（/api/key-gates）后端未交付，页内手动 Gate 编号输入
              component: () => import('#/views/ipd/project/detail/gates.vue'),
              meta: { activePath: '/ipd/projects', hideInMenu: true, ipdBackend: 'ProjectController GET /projects/{id}/gates（R30 项目维度列表）+ GateReviewController GET /gates/{gateId}/review + POST /gates/{gateId}/{sign|reopen|extend-deadline|arbitrate|final-ruling}。', ipdCard: 'P0-10.23', title: 'Gate 评审' },
              name: 'IpdProjectGates', path: 'gates',
            },
            {
              component: () => import('#/views/ipd/project/detail/changes.vue'),
              meta: { activePath: '/ipd/projects', hideInMenu: true, title: '需求与变更' },
              name: 'IpdProjectChanges', path: 'changes',
            },
            {
              // 页26 变更单详情 —— 2026-09-06 真实现：后端 GET /requirement-changes/{id} 已交付（P2-6.1），
              //    前端 IpdChangeDetail 真组件 + getRequirementChange API 函数，五态齐全
              component: () => import('#/views/ipd/project/change-detail/index.vue'),
              meta: { activePath: '/ipd/projects', hideInMenu: true, ipdBackend: 'RequirementChangeController 已交付（P2-6.1）：GET /requirement-changes/{id}、POST /requirement-changes/{id}/submit、POST /requirement-changes/{id}/sign。', ipdCard: 'P0-10.25', title: '变更单详情' },
              name: 'IpdChangeDetail', path: 'change/:changeId',
            },
            {
              // 页32 项目详情-KPI —— 2026-09-06 接 W3-A6：后端 GET /kpi/{performance,functional,trend} 全交付
              //    + 前端 kpi.ts 3 函数封装 + 真组件 IpdProjectKpi（顶部 Alert 口径 + 三段预览卡片）
              component: () => import('#/views/ipd/project/detail/kpi.vue'),
              meta: { activePath: '/ipd/projects', hideInMenu: true, ipdBackend: 'KpiRecordController 已交付：GET /kpi/performance、GET /kpi/functional、GET /kpi/trend；PostLaunchReviewController（ORPHAN-A9）GET /post-launch-reviews/pending、POST /{id}/complete。', ipdCard: 'P0-10.32', title: 'KPI 考核' },
              name: 'IpdProjectKpi',
              path: 'kpi',
            },
            // 项目详情-激励台账 —— 2026-10-03 owner 裁决移除「回款台账 + 奖金池 + 业绩窗口」，
            //    奖金池核算组件与其路由（IpdProjectIncentive / IpdBonusPool）同批删除。
            {
              component: () => import('#/views/ipd/project/detail/documents.vue'),
              meta: { activePath: '/ipd/projects', hideInMenu: true, title: '文档与交付物' },
              name: 'IpdProjectDocuments', path: 'documents',
            },
            {
              component: () => import('#/views/ipd/project/detail/audit.vue'),
              meta: { activePath: '/ipd/projects', hideInMenu: true, title: '项目日志' },
              name: 'IpdProjectAudit',
              path: 'audit',
            },
            {
              // 项目详情-协作圈 —— 2026-09-06 真实现：ProjectCircleController /api/v1/project-circle
              //    6 端点全消费（视图/候选/加人/发动态/评论/成员），看板卡 c5254e23
              component: () => import('#/views/ipd/project/detail/circle.vue'),
              meta: { activePath: '/ipd/projects', hideInMenu: true, title: '协作圈' },
              name: 'IpdProjectCircle',
              path: 'circle',
            },
          ],
        },
        // 页12/13 深管/轻管动作详情（同一入口按管理类型分形态）
        {
          component: () => import('#/views/ipd/project/action-detail/index.vue'),
          meta: { activePath: '/ipd/projects', hideInMenu: true, title: '动作详情' },
          name: 'IpdActionDetail',
          path: ':projectId/actions/:actionId',
        },
      ],
    },
    // ③ 需求管理（原型 /requirements，页40；2026-09-06 复刻 RequirementsPage，接 DemandController）
    {
      component: () => import('#/views/ipd/demand/index.vue'),
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/requirements'] ?? [])], hideInMenu: true, icon: 'lucide:clipboard-list', title: '需求管理' },
      name: 'IpdRequirements',
      path: 'requirements',
    },
    // 需求详情（R215-E2E-C 2026-09-25 补 :id 路由缺口：此前列表下钻无路由→前端 404；
    // hideInMenu + activePath 保持「需求管理」菜单高亮；字段 1:1 对齐后端 GET /demands/{id} VO）
    {
      component: () => import('#/views/ipd/demand/detail/index.vue'),
      meta: { activePath: '/ipd/requirements', hideInMenu: true, title: '需求详情' },
      name: 'IpdRequirementDetail',
      path: 'requirements/:id',
    },
    // ④ 产品空间（原型 /product-space，页16-17；2026-09-06 换挂一比一工作台，接 ProductWorkspaceController）
    {
      component: () => import('#/views/ipd/product-lines/index.vue'),
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/product-lines'] ?? [])], icon: 'lucide:layers', order: 2, title: '产品线' },
      name: 'IpdProductLines',
      path: 'product-lines',
    },
    {
      component: () => import('#/views/ipd/product/workspace/index.vue'),
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/products'] ?? [])], hideInMenu: true, icon: 'lucide:package', title: '产品空间' },
      name: 'IpdProducts',
      path: 'products',
      children: [
        // 产品管理列表（原菜单④形态，迁移为子路由保留既有能力；入口：工作台「产品管理」）
        {
          component: () => import('#/views/ipd/product/list/index.vue'),
          meta: { activePath: '/ipd/products', hideInMenu: true, title: '产品管理' },
          name: 'IpdProductManage',
          path: 'manage',
        },
        {
          component: () => import('#/views/ipd/product/edit/index.vue'),
          meta: { activePath: '/ipd/products', hideInMenu: true, title: '新增产品' },
          name: 'IpdProductCreate',
          path: 'create',
        },
        {
          component: () => import('#/views/ipd/product/edit/index.vue'),
          meta: { activePath: '/ipd/products', hideInMenu: true, title: '编辑产品' },
          name: 'IpdProductEdit',
          path: ':productId/edit',
        },
      ],
    },
    // ⑤ 研发招募（原型 /recruitments，页19-22）—— fe-bid 整体覆盖
    {
      component: () => import('#/views/ipd/bid/list/index.vue'),
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/bids'] ?? [])], hideInMenu: true, icon: 'lucide:handshake', title: '研发招募' },
      name: 'IpdBids',
      path: 'bids',
      children: [
        {
          component: () => import('#/views/ipd/bid/create/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/bids/create'] ?? [])], activePath: '/ipd/bids', hideInMenu: true, title: '发起招标' },
          name: 'IpdBidCreate', path: 'create',
        },
        {
          component: () => import('#/views/ipd/bid/respond/index.vue'),
          meta: { activePath: '/ipd/bids', hideInMenu: true, title: '应标' },
          name: 'IpdBidRespond', path: ':bidId/respond',
        },
        {
          component: () => import('#/views/ipd/bid/select/index.vue'),
          meta: { activePath: '/ipd/bids', hideInMenu: true, title: '遴选' },
          name: 'IpdBidSelect', path: ':bidId/select',
        },
        // R215 GAP-F9 研发PM「我的应标」（GET /bid-responses/by-rd-pm/{personId}，
        //   BidController:170；rdPmId 取 /auth/me person.id string，禁 userStore.userId 数值态——
        //   store/ipd-auth.ts:135 污染点）。IDOR 三分支服务端推导；直达 URL 交付
        //   （准备包「入口按钮 F1 顺路带/本卡直达二选一」取后者），activePath 归组研发招募。
        {
          component: () => import('#/views/ipd/bid/my-responses/index.vue'),
          meta: { activePath: '/ipd/bids', hideInMenu: true, title: '我的应标' },
          name: 'IpdBidMyResponses', path: 'my-responses',
        },
      ],
    },
    // ⑥ 变更管理（原型 /changes，一级入口；2026-09-06 复刻 ChangesPage：接 RequirementChangeController
    //    P2-6.1 双签否决，创建/提交/签署真实；协作决策链（旧五节点口径已废止）后端未交付在页内如实登记）
    {
      component: () => import('#/views/ipd/change/index.vue'),
      meta: { hideInMenu: true, icon: 'lucide:arrow-left-right', title: '变更管理' },
      name: 'IpdChanges',
      path: 'changes',
    },
    // ⑦ 资料库（原型 /documents，一级入口；2026-09-06 owner 指令：IPD 资料库基于知识库管理后端对齐，
    // 与 AI 平台「知识管理」同一份数据（knowledge_info/attach/fragment），路由级复用 knowledge 现成页面。
    // 「文档管理」详情跳 /knowledge/info/detail/:id（平台动态菜单，届时切 basic 壳，左下角可回切）；
    // 按钮权限码 system:info:* 走基线 RBAC，非超管映射账号需 RBAC 授权后可见写操作（遗留登记））
    {
      component: () => import('#/views/knowledge/info/index.vue'),
      meta: { icon: 'lucide:folder-open', order: 5, title: '资料库' },
      name: 'IpdDocuments',
      path: 'documents',
    },
    // ⑧ 阶段确认（原型 /reviews；2026-09-06 复刻 StageConfirmPage：门禁清单 + advance-stage 真实推进，
    //    双PM确认链/双周评审/五大关键 Gate/豁免后端未交付在页内如实登记）
    {
      component: () => import('#/views/ipd/review/index.vue'),
      meta: { hideInMenu: true, icon: 'lucide:shield-check', title: '阶段确认' },
      name: 'IpdReviews',
      path: 'reviews',
    },
    // ⑨ 协同绩效（原型 /performance 单页）—— 2026-09-06 菜单入口改直连真 KPI 页：子页
    //    functional/project-score/allowance 等真组件已挂 /ipd/kpi|incentive 隐藏路由，原 pending
    //    占位会让菜单点进去停在占位页；津贴读端点缺已登记（W3-Backend-B1）
    {
      meta: { hideInMenu: true, icon: 'lucide:bar-chart-3', title: '协同绩效' },
      name: 'IpdPerformance',
      path: 'performance',
      redirect: '/ipd/kpi/functional',
    },
    // ⑩ 全流程轨迹（原型 /timeline；无 timeline 聚合端点，audit-logs 已交付）
    //    2026-09-06 真实现：审计日志 + 工作台待办两源融合，五态齐全（奖金池源已于 2026-10-03 摘除）。
    {
      component: () => import('#/views/ipd/timeline/index.vue'),
      meta: { hideInMenu: true, icon: 'lucide:book-open', ipdBackend: '无 timeline 聚合端点；以审计日志（GET /audit-logs/scope）+ 工作台（GET /workbench/summary）两源融合按时间倒序。', ipdCard: 'ZK-D2', title: '全流程轨迹' },
      name: 'IpdTimeline', path: 'timeline',
    },
    // ⑪ 报表分析（原型 /reports；2026-09-06 复刻：P4-4.1 月度绩效汇总+三类台账导出已交付为页面主区，
    //    原型 analytics 流程分析四卡/建议卡按原型渲染但数值区登记真缺口）
    {
      component: () => import('#/views/ipd/report/index.vue'),
      meta: { hideInMenu: true, icon: 'lucide:line-chart', title: '报表分析' },
      name: 'IpdReports',
      path: 'reports',
    },
    // ⑫ 项目移交（原型 /handoffs，页27；2026-09-06 复刻：/handovers 发起/接受/收件箱/批量/超管移交已交付，
    //    原型 scope 四卡预检/责任确认链/取消/产品续交不同构在页内登记）
    {
      component: () => import('#/views/ipd/handover/index.vue'),
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/handover'] ?? [])], hideInMenu: true, icon: 'lucide:users', title: '项目移交' },
      name: 'IpdHandover',
      path: 'handover',
    },
    // KPI 考核 + 激励管理（页29-36）：原型归入协同绩效，路由保留降为隐藏
    {
      // 纯分组/重定向父路由：省略 component（对齐同文件 IpdPerformance 无-component 约定），子页由
      // ipd.vue 的 plain <router-view> 经 vue-router depth-skip（!matched.components 则跳过）渲染。
      // 勿挂 not-found.vue（纯 <Fallback 404> 无 outlet）——会吞掉 functional/shared/project-score 子页，
      // 菜单⑨协同绩效 redirect 到此，点进去全见 404（2026-09-08 根因根除）。
      meta: { hideInMenu: true, icon: 'lucide:target', title: 'KPI 考核' },
      name: 'IpdKpi',
      path: 'kpi',
      redirect: '/ipd/kpi/functional',
      children: [
        {
          // 页29-32 KPI 考核（按月聚合） —— 2026-09-06 复刻：performance/functional/trend 三
          //    端点已交付为主区；原型 12 项 KPI 表格 + KpiDrawer 填报/共担 KPI 确认链未交付
          //    在页内登记真缺口（路由 IpdKpiShared 维持真缺口，IpdKpiScore 真组件挂在下条）
          component: () => import('#/views/ipd/kpi/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/kpi/functional'] ?? [])], activePath: '/ipd/performance', ipdBackend: 'KpiRecordController 已交付：GET /kpi/performance、GET /kpi/functional、GET /kpi/trend；KpiRulesController 已交付：GET /kpi/rules（规则快照）；功能指标量表 GET/PUT/DELETE /kpi/functional-metrics 与 GET /kpi/functional-metrics/codes 在本页。原型 12 项项目 KPI 表格写链（PUT /performance/kpis/{projectId}/{metricCode}）与 KpiDrawer 填报/证据上传/编辑均未交付。', ipdCard: 'P0-10.29', title: '功能 KPI' },
          name: 'IpdKpiFunctional',
          path: 'functional',
        },
        // 页29-30 共担 KPI 归集（按月聚合） —— 2026-09-06 真实现：SharedKpiController.listShared（W4-E）已交付，
        //    GET /api/v1/kpi/shared?projectId&period 返回 List<KpiRecord>（按 revision DESC）；
        //    前端 IpdKpiShared 真组件承载双 PM 各自归集 + revision 维度分组 + 关联奖金池列表。
        {
          component: () => import('#/views/ipd/kpi/shared/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/kpi/functional'] ?? [])], activePath: '/ipd/performance', ipdBackend: 'SharedKpiController 已交付（W4-E + ORPHAN-A7）：GET /kpi/shared、GET /kpi/shared/confirms、GET /kpi/shared/deadline-config、POST /kpi/shared/{id}/confirm。', ipdCard: 'P0-10.30', title: '共担 KPI 归集' },
          name: 'IpdKpiShared', path: 'shared',
        },
        {
          // 页31 项目绩效评定 —— 2026-09-06 复刻：ProjectScoreController（明细/结算）+ TaskController（scan）已交付为真组件
          component: () => import('#/views/ipd/kpi/project-score/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/kpi/project-score'] ?? [])], ipdBackend: 'ProjectScoreController 已交付：GET /project-scores/{projectId}/{personId}、POST /{projectId}/{personId}/settle；TaskController GET /project-score-tasks/my 补交已接入。', ipdCard: 'P0-10.31', title: '项目绩效评定' },
          name: 'IpdKpiScore',
          path: 'project-score',
        },
        {
          // R149 录入/展示：KPI 原始数据录入/展示 —— 后端 /api/v1/kpi/raw-records 待交付，
          //   前端先把录入/展示闭环；仅 GROUP_LEADER 可写，UI + 路由双闸门禁（meta.access 占位用既有 KPI_QUERY）。
          component: () => import('#/views/ipd/kpi/raw-records.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/kpi/raw-records'] ?? [])], activePath: '/ipd/performance', hideInMenu: true, title: 'KPI 原始数据' },
          name: 'IpdKpiRawRecords',
          path: 'raw-records',
        },
      ],
    },
    // ⑧ 激励管理（页33-36）：并入协同绩效，路由保留降为隐藏
    {
      // 纯分组/重定向父路由：省略 component，子页由 ipd.vue plain <router-view> depth-skip 渲染；
      // 勿挂 not-found.vue（无 outlet 会吞掉 allowance/contribution/negative-feedback 子页 → 404）。
      meta: { hideInMenu: true, icon: 'lucide:coins', title: '激励管理' },
      name: 'IpdIncentive',
      path: 'incentive',
      redirect: '/ipd/incentive/allowance',
      children: [
        {
          // 页33 津贴台账 —— 2026-09-06 W4-D 收口：AllowanceLedgerController 3 端点已交付
          //   （GET /allowance/ledger · GET /allowance/pending-stop · POST /allowance/auto-scan）；
          //   UI 接 AllowanceLedger domain 真实字段（month/lockedLevel/finalAmount/capApplied/
          //   stopReason），自动扫描按钮仅超管可见。
          component: () => import('#/views/ipd/incentive/allowance/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/incentive/allowance'] ?? [])], ipdBackend: 'AllowanceLedgerController 已交付（W4-D）：GET /allowance/ledger、GET /allowance/pending-stop、POST /allowance/auto-scan（仅超管）。', ipdCard: 'P0-10.33', title: '津贴台账' },
          name: 'IpdAllowance',
          path: 'allowance',
        },
        {
          // 页34 奖金池核算 —— 2026-10-03 owner 裁决移除「回款台账 + 奖金池 + 业绩窗口」，本路由同批删除。
          // 页35 贡献度评定 —— 2026-09-06 复刻：ContributionController 已交付为真组件，市场 PM 40-65%/
          //    研发 PM 35-60% / preview-save-confirm 端点已就位，原型 marketShare 70/30 默认已改
          component: () => import('#/views/ipd/incentive/contribution/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/incentive/contribution'] ?? [])], ipdBackend: 'ContributionController 已交付：GET /contributions/{projectId}、GET /{projectId}/versions。', ipdCard: 'P0-10.35', title: '贡献度评定' },
          name: 'IpdContribution',
          path: 'contribution',
        },
        {
          // 页36 负反馈执行 —— 2026-09-06 复刻：NegativeFeedbackController（submit/decide/lift/by-project）
          //    已交付为真组件；停发/连带减半/共同担责三档与 triggerType 枚举已接入
          component: () => import('#/views/ipd/incentive/negative-feedback/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/incentive/negative-feedback'] ?? [])], ipdBackend: 'NegativeFeedbackController 已交付：GET /negative-feedbacks?projectId&status、POST /{id}/submit、POST /{id}/decide、POST /{id}/lift。', ipdCard: 'P0-10.36', title: '负反馈执行' },
          name: 'IpdNegativeFeedback',
          path: 'negative-feedback',
        },
      ],
    },
    // AI 文档助手（页42）—— 2026-09-10 owner 拍板：升级为侧栏菜单可见；2026-09-11 菜单/UI 统一后
    // 自绘壳悬浮「AI 副驾」与「AI 管理平台」切换钮均已移除，本菜单项为 AI 能力唯一入口（便于深链与权限收敛）。
    {
      component: () => import('#/views/ipd/ai-docs/index.vue'),
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/ai-assistant'] ?? [])], hideInMenu: true, icon: 'lucide:bot', title: 'AI 文档助手' },
      name: 'IpdAiAssistant',
      path: 'ai-assistant',
    },
    // 删除审核（页04/05/43）—— 原型非一级路由（统一软删除机制），路由保留降为隐藏
    {
      // 纯分组/重定向父路由：省略 component，子页由 ipd.vue plain <router-view> depth-skip 渲染；
      // 勿挂 not-found.vue（无 outlet 会吞掉 my-requests/review/archive 子页 → 404）。
      meta: { hideInMenu: true, icon: 'lucide:trash-2', title: '删除审核' },
      name: 'IpdDeletion',
      path: 'deletion',
      redirect: '/ipd/deletion/my-requests',
      children: [
        {
          component: () => import('#/views/ipd/deletion/my-requests/index.vue'),
          meta: { /* ipdCard 待 owner 裁决 */ ipdBackend: 'DeletionRequestController 已交付（P1-1）：POST /deletion-requests、GET /deletion-requests/my-requests、POST /deletion-requests/{id}/withdraw（BR-DEL-04 24h 窗口）；摸底（0907）登记的「列表查询」缺口已闭环，2026-09-27 复核无剩余端点缺口。', title: '我的申请' },
          name: 'IpdDeletionMy',
          path: 'my-requests',
        },
        {
          component: () => import('#/views/ipd/deletion/review/index.vue'),
          meta: { /* ipdCard 待 owner 裁决 */ ipdBackend: 'DeletionRequestController 已交付（P1-1）：GET /deletion-requests/review-queue、POST /deletion-requests/{id}/leader-decision、POST /deletion-requests/{id}/admin-decision、POST /deletion-requests/escalate-overdue、GET /deletion-requests/overdue-admin-review（AC-DEL-07 超期工具）；摸底（0907）登记的「列表查询」缺口已闭环，2026-09-27 复核无剩余端点缺口。', title: '待我审核' },
          name: 'IpdDeletionReview',
          path: 'review',
        },
        {
          component: () => import('#/views/ipd/deletion/archive/index.vue'),
          meta: { authority: ['SUPER_ADMIN'], title: '归档区' },
          name: 'IpdDeletionArchive',
          path: 'archive',
        },
      ],
    },
    // ⑬ 产品目录〔超管〕（原型 /products 超管项；2026-09-06 复刻 ProductCatalogPage，主表接 GET /products；导入三步流后端未交付已在页内登记）
    {
      component: () => import('#/views/ipd/product/catalog/index.vue'),
      meta: { authority: ['SUPER_ADMIN'], icon: 'lucide:package', order: 3, title: '产品目录' },
      name: 'IpdProductCatalog',
      path: 'product-catalog',
    },
    // ⑭ 人员同步〔超管〕（原型 /identity-sync；无 identity-source Controller，P2-2.3）
    //    2026-09-06 真实现：身份 / 同步源类型 / 来源实例 / 最近同步时间三类维度如实登记真缺口，
    //    主体挂 GET /pm-directory（在职人员目录）真组件，IPD_PERMISSION_CODES.IDENTITY_SYNC_* 权限码走 _shared。
    {
      component: () => import('#/views/ipd/admin/identity-sync/index.vue'),
      meta: { authority: ['SUPER_ADMIN'], hideInMenu: true, icon: 'lucide:database', ipdBackend: 'PmDirectoryController 已交付：GET /pm-directory（在职目录只读视图）；identity-source Controller 待补（同步源类型/来源实例/最近同步时间三个维度未交付）。', ipdCard: 'P0-10.44', title: '人员同步' },
      name: 'IpdIdentitySync', path: 'identity-sync',
    },
    // ⑮ 超级管理〔超管〕（原型 /admin，页06/18/28/44-49）
    {
      // 纯分组/重定向父路由：省略 component，子页由 ipd.vue plain <router-view> depth-skip 渲染；
      // 勿挂 not-found.vue（无 outlet 会吞掉 org 等超管子页 → 404）。
      meta: { authority: ['SUPER_ADMIN'], hideInMenu: true, icon: 'lucide:settings', title: '超级管理' },
      name: 'IpdAdmin',
      path: 'admin',
      redirect: '/ipd/admin/org',
      children: [
        {
          component: () => import('#/views/ipd/admin/org/index.vue'),
          meta: { title: '组织架构' },
          name: 'IpdAdminOrg',
          path: 'org',
        },
        {
          component: () => import('#/views/ipd/admin/config/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/admin/config'] ?? [])], title: '参数配置' },
          name: 'IpdAdminConfig',
          path: 'config',
        },
        {
          // R149-A5 业务配置管理（审批人配置）：覆盖 ipd_business_config 三档 scope
          //   GLOBAL/GROUP/PROJECT；后端 /api/v1/business-config 待交付，UI + 路由双闸
          //   限定 GROUP_LEADER + SUPER_ADMIN（与 system-config 单超管写不同）。
          component: () => import('#/views/ipd/admin/business-config.vue'),
          meta: { authority: ['SUPER_ADMIN', 'GROUP_LEADER'], hideInMenu: true, title: '审批人配置' },
          name: 'IpdAdminBusinessConfig',
          path: 'business-config',
        },
        {
          // R215 权限可配置化（owner 2026-09-24）：ipd_role_permission DB 覆盖层配置页；
          //   后端 /api/v1/role-permissions 5 端点仅超管（注解+兜底三保险），路由同步单超管门禁。
          component: () => import('#/views/ipd/admin/role-permission.vue'),
          meta: { authority: ['SUPER_ADMIN'], title: '角色权限配置' },
          name: 'IpdAdminRolePermission',
          path: 'role-permission',
        },
        // 页46 SOP 模板 —— fe-admin 整体覆盖
        {
          component: () => import('#/views/ipd/admin/sop-template/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/admin/sop'] ?? [])], title: 'SOP 模板' },
          name: 'IpdAdminSop',
          path: 'sop',
        },
        // 页47 Gate 评审要素 —— fe-admin 整体覆盖
        {
          component: () => import('#/views/ipd/admin/gate-elements/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/admin/gate-elements'] ?? [])], title: 'Gate 评审要素' },
          name: 'IpdAdminGateElements',
          path: 'gate-elements',
        },
        // R177-A6 Gate 评审详情页 —— 项目级 Gate 实例详情
        //   入口：?projectId=X&gateId=Y；权限码 GATE_REVIEW_LIST（仅列表准入）；
        //   activePath 挂到 gate-elements 让菜单继续高亮。
        {
          component: () => import('#/views/ipd/admin/gate-detail/index.vue'),
          meta: {
            access: [IPD_PERMISSION_CODES.GATE_REVIEW_LIST],
            activePath: '/ipd/admin/gate-elements',
            hideInMenu: true,
            title: 'Gate 评审详情',
          },
          name: 'IpdAdminGateDetail',
          path: 'gate-detail',
        },
        {
          component: () => import('#/views/ipd/cert/templates/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/admin/cert-templates'] ?? [])], title: '国别认证清单模板库' },
          name: 'IpdAdminCertTemplates',
          path: 'cert-templates',
        },
        // 页48 AI 模型配置 —— fe-admin 整体覆盖
        {
          component: () => import('#/views/ipd/admin/ai-models/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/admin/ai-config'] ?? [])], title: 'AI 模型配置' },
          name: 'IpdAdminAiConfig',
          path: 'ai-config',
        },
        // 页06 审计日志（已提升到顶级 IpdAuditLogs；保留 admin 内同名兼容路由避免外部引用断链）
        {
          component: () => import('#/views/ipd/audit/logs/index.vue'),
          meta: { title: '审计日志（兼容路径）', hideInMenu: true },
          name: 'IpdAdminAuditLogs',
          path: 'audit-logs-old',
        },
        // 页49 超管移交 —— 2026-09-06 复刻原型 /admin SuperAdminSuccessionPanel（确认短语 +
        //    前端预检；currentPassword 差异与 replacementLeadId/readiness 端点增量已在页内登记）
        {
          component: () => import('#/views/ipd/admin/handover/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/admin/handover'] ?? [])], title: '超级管理员移交' },
          name: 'IpdAdminHandover',
          path: 'handover',
        },
        // R215 GAP-F6 合规中心（ComplianceController P2-5.1 四端点；AC-COMP-01~05）。
        //   权限码 COMPLIANCE_READ/WRITE 为既有登记（A23 reserved 注释已随视图交付解除），
        //   路由准入挂 READ，WRITE 仅按钮级 v-access（删除请求登记）。
        {
          component: () => import('#/views/ipd/admin/compliance/index.vue'),
          meta: { access: [IPD_PERMISSION_CODES.COMPLIANCE_READ], title: '合规中心' },
          name: 'IpdAdminCompliance',
          path: 'compliance',
        },
        // R215 GAP-F7 人员同步任务页（PersonSyncController 5 端点；后端为代码内 require*，
        //   无 @SaCheckPermission 注解码 → 前端零权限码登记，凭空登记=镜像污染，沿 F3 裁决）。
        //   路由双角色门禁（submit/retry 组长可用，requireLeaderOrAdmin :53/:62）；
        //   list/abnormal/retry-all 三条 requireAdmin 仅超管（:71/:82/:90）→ 页内按角色收敛，
        //   组长不渲染列表/批量回补。authority 子路由覆写先例 business-config :436。
        {
          component: () => import('#/views/ipd/admin/person-sync/index.vue'),
          meta: { authority: ['SUPER_ADMIN', 'GROUP_LEADER'], title: '同步任务' },
          name: 'IpdAdminPersonSync',
          path: 'person-sync',
        },
        // R215 GAP-F4 P0 升级链处置台（P0EscalationController 3 端点；AC-C4 双组长升级链）。
        //   后端 @SaCheckPermission(ipd:p0-escalation:read) 三端点同码 + 代码级二道门
        //   （list/resolve=requireLeaderOrAdmin :50/:72、check=requireAdmin :60 仅超管）；
        //   meta.access 挂 READ 码 + authority 显式覆写双角色——父级 IpdAdmin=SUPER_ADMIN 会经
        //   vue-router to.meta 合并被子路由继承，组长可达必须覆写（person-sync :529 先例）；
        //   触发扫描按钮页内 isSuperAdmin 收敛（requireAdmin 语义非权限码可表达）。
        {
          component: () => import('#/views/ipd/admin/p0-escalation/index.vue'),
          meta: {
            access: [...(PAGE_PERMISSIONS['/ipd/admin/p0-escalation'] ?? [])],
            authority: ['SUPER_ADMIN', 'GROUP_LEADER'],
            title: 'P0 升级链',
          },
          name: 'IpdAdminP0Escalation',
          path: 'p0-escalation',
        },
        // R215 GAP-F10 超管永久清除工作台（AdminPermanentDeleteController 2 端点；R149 batch2b C3，
        //   owner 拍板方案 A 做前端界面）。execute/audit 双端点同码 ipd:permanent-delete:execute
        //   （@SaCheckPermission :56/:75）+ 代码级 requireAdmin 仅超管（:61/:79，service :95 二次兜底）
        //   → 父级 IpdAdmin=SUPER_ADMIN authority 继承 + meta.access 挂 PAGE_PERMISSIONS 双闸；
        //   页内高危门槛：confirmCode 手工敲入字面量 + Modal 复述三元组（物理删除不可逆）。
        {
          component: () => import('#/views/ipd/admin/permanent-delete/index.vue'),
          meta: {
            access: [...(PAGE_PERMISSIONS['/ipd/admin/permanent-delete'] ?? [])],
            title: '永久清除',
          },
          name: 'IpdAdminPermanentDelete',
          path: 'permanent-delete',
        },
      ],
    },
    // R149 录入/展示：运营管理（顶层超管入口，含回款预警）。纯分组/重定向父路由：
    //   省略 component，子页由 ipd.vue plain <router-view> depth-skip 渲染；点菜单直接进
    //   recovery-warnings 子页（与 IpdKpi/Incentive/Performance 同构）。
    {
      meta: { hideInMenu: true, icon: 'mdi:alert-circle', title: '运营管理' },
      name: 'IpdOperation',
      path: 'operation',
      redirect: '/ipd/operation/recovery-warnings',
      children: [
        {
          // 90 日回款预警（R149 后端真接入：check-90d + warnings 两端点已交付）。
          //   路由 meta.access 走 PAGE_PERMISSIONS['/ipd/operation/recovery-warnings']
          //   （RECOVERY_CHECK_90D + RECOVERY_WARNINGS_QUERY），按钮 v-access:code 双闸门禁。
          component: () => import('#/views/ipd/operation/recovery-warnings.vue'),
          meta: {
            access: [...(PAGE_PERMISSIONS['/ipd/operation/recovery-warnings'] ?? [])],
            title: '回款预警',
          },
          name: 'IpdOperationRecoveryWarnings',
          path: 'recovery-warnings',
        },
        // R215 GAP-F5 月度切换验收（SwitchingAcceptanceController P3-7.1 五端点；BR-INC-12/AC-INC-50/51，
        //   A23 预留码兑现）。run/lock/unlock 写口挂 LOCK/UNLOCK 码（ADMIN_WRITE 仅超管，控制器
        //   2026-09-09 收紧注 :36-39）；get/list 读口 QUERY 码——meta.access 三码齐挂（recovery-warnings
        //   多码先例），写按钮页内 v-access 分码双闸；admin 别名 ipd:switching-acceptance:admin 是
        //   死码（注解侧已弃用），禁做前端门禁。
        {
          component: () => import('#/views/ipd/operation/switching-acceptance.vue'),
          meta: {
            access: [...(PAGE_PERMISSIONS['/ipd/operation/switching-acceptance'] ?? [])],
            title: '切换验收',
          },
          name: 'IpdOperationSwitchingAcceptance',
          path: 'switching-acceptance',
        },
      ],
    },

    // R149 录入/展示：落地场景登记 + 批量导入 —— 后端 /api/v1/scenarios/landed 待交付，
    //   前端先把登记/展示闭环；MARKET_PM / RD_PM / GROUP_LEADER / SUPER_ADMIN 可写，GUEST 走门户。
    {
      component: () => import('#/views/ipd/scenarios/landed-scenarios.vue'),
      meta: { hideInMenu: true, icon: 'lucide:map-pin', title: '落地场景登记' },
      name: 'IpdLandedScenarios',
      path: 'scenarios/landed-scenarios',
    },

    // 无权访问提示页（不在菜单）
    {
      component: () => import('#/views/ipd/_shared/no-access.vue'),
      meta: { hideInMenu: true, title: '无权访问' },
      name: 'IpdNoAccess',
      path: 'no-access',
    },
  ],
};

/** 游客门户（页38/39）路由已迁出到 ./portal.ts，由 routes/index.ts 的 import.meta.glob 自动注册。 */

// AC-PROD-09：旧通知持久化了原型地址。兼容用户直接打开历史深链，
// 新通知由后端发布正式地址；保留查询参数供需求池预筛选。
const legacyDemandPoolRoute: RouteRecordRaw = {
  meta: { hideInMenu: true, title: '需求管理' },
  name: 'IpdLegacyDemandPool',
  path: '/demands/pool',
  redirect: (to) => ({ path: '/ipd/requirements', query: to.query }),
};

export default [ipdLayoutRoute, legacyDemandPoolRoute];

/** 供守卫生成菜单使用。 */
export { ipdLayoutRoute };
