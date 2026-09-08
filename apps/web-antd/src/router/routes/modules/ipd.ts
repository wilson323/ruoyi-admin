import type { RouteRecordRaw } from 'vue-router';

import {
  IPD_PERMISSION_CODES,
  PAGE_PERMISSIONS,
} from '../../../views/ipd/_shared/ipd-permission-codes';

/**
 * IPD 路由（唯一登记处）。
 *
 * 规则（2026-09-06 owner 裁决 D2 强化：菜单/页面严格对齐 ZK-IPD 原型）：
 * - 菜单结构 = 原型 App.jsx navItems 15 项（12 全员 + 3 超管）；49 页导航地图同步变更中；
 * - 已实现页面的 path/name/组件不动，只对齐 title/icon/order；原型未开工的一级入口挂 pending 占位（卡号 ZK-D2 = 原型对齐裁决）；
 * - 原型非一级路由的既有页（审计日志/AI 助手/删除审核/KPI/激励）保留路由但 hideInMenu；
 * - 后端未交付的页面统一挂 _shared/backend-pending.vue，meta 记录卡号与后端依赖（ipdCard/ipdBackend）；
 * - 项目详情 8 个子页签、动作详情、编辑页等下钻路由 hideInMenu，用 activePath 保持菜单高亮；
 * - 游客门户（38/39）独立于后台布局，单独顶层注册。
 *
 * <p>权限码（V1 系统漂移修复）：所有页路由 meta.access 必须引用 _shared/ipd-permission-codes
 * 常量，禁止裸字面量；authority 仍为角色级（personType）门禁。
 */

const ipdLayoutRoute: RouteRecordRaw = {
  // 2026-09-06 起改用 ipd.vue 自绘 Shell（严格 1:1 复刻 ZK-IPD 原型 topbar/sidebar/stage-rail），
  // 不再经由 Vben basic.vue；菜单/权限在 ipd.vue 内按 personType 过滤，路由结构不变。
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
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/projects'] ?? [])], icon: 'lucide:target', order: 2, title: '项目空间' },
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
              meta: { activePath: '/ipd/projects', hideInMenu: true, ipdCard: 'P0-10.23', title: 'Gate 评审' },
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
              meta: { activePath: '/ipd/projects', hideInMenu: true, ipdCard: 'P0-10.25', title: '变更单详情' },
              name: 'IpdChangeDetail', path: 'change/:changeId',
            },
            {
              // 页32 项目详情-KPI —— 2026-09-06 接 W3-A6：后端 GET /kpi/{performance,functional,trend} 全交付
              //    + 前端 kpi.ts 3 函数封装 + 真组件 IpdProjectKpi（顶部 Alert 口径 + 三段预览卡片）
              component: () => import('#/views/ipd/project/detail/kpi.vue'),
              meta: { activePath: '/ipd/projects', hideInMenu: true, ipdCard: 'P0-10.32', title: 'KPI 考核' },
              name: 'IpdProjectKpi',
              path: 'kpi',
            },
            // 项目详情-激励台账 —— 2026-09-06 复用 IpdBonusPool 真组件（/incentive/bonus-pool 同页；
            //    BonusPoolController list/compute 已交付；freeze/distribute 后端有端点页面未接在页内登记）
            {
              component: () => import('#/views/ipd/incentive/bonus-pool/index.vue'),
              meta: { activePath: '/ipd/projects', hideInMenu: true, ipdCard: 'P0-10.37', title: '激励台账' },
              name: 'IpdProjectIncentive', path: 'incentive',
            },
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
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/requirements'] ?? [])], icon: 'lucide:clipboard-list', order: 3, title: '需求管理' },
      name: 'IpdRequirements',
      path: 'requirements',
    },
    // ④ 产品空间（原型 /product-space，页16-17；2026-09-06 换挂一比一工作台，接 ProductWorkspaceController）
    {
      component: () => import('#/views/ipd/product/workspace/index.vue'),
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/products'] ?? [])], icon: 'lucide:package', order: 4, title: '产品空间' },
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
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/bids'] ?? [])], icon: 'lucide:handshake', order: 5, title: '研发招募' },
      name: 'IpdBids',
      path: 'bids',
      children: [
        {
          component: () => import('#/views/ipd/bid/create/index.vue'),
          meta: { activePath: '/ipd/bids', hideInMenu: true, title: '发起招标' },
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
      ],
    },
    // ⑥ 变更管理（原型 /changes，一级入口；2026-09-06 复刻 ChangesPage：接 RequirementChangeController
    //    P2-6.1 双签否决，创建/提交/签署真实；五节点协作链后端未交付在页内如实登记）
    {
      component: () => import('#/views/ipd/change/index.vue'),
      meta: { icon: 'lucide:arrow-left-right', order: 6, title: '变更管理' },
      name: 'IpdChanges',
      path: 'changes',
    },
    // ⑦ 资料库（原型 /documents，一级入口；2026-09-06 owner 指令：IPD 资料库基于知识库管理后端对齐，
    // 与 AI 平台「知识管理」同一份数据（knowledge_info/attach/fragment），路由级复用 knowledge 现成页面。
    // 「文档管理」详情跳 /knowledge/info/detail/:id（平台动态菜单，届时切 basic 壳，左下角可回切）；
    // 按钮权限码 system:info:* 走基线 RBAC，非超管映射账号需 RBAC 授权后可见写操作（遗留登记））
    {
      component: () => import('#/views/knowledge/info/index.vue'),
      meta: { icon: 'lucide:folder-open', order: 7, title: '资料库' },
      name: 'IpdDocuments',
      path: 'documents',
    },
    // ⑧ 阶段确认（原型 /reviews；2026-09-06 复刻 StageConfirmPage：门禁清单 + advance-stage 真实推进，
    //    双PM确认链/双周评审/五大关键 Gate/豁免后端未交付在页内如实登记）
    {
      component: () => import('#/views/ipd/review/index.vue'),
      meta: { icon: 'lucide:shield-check', order: 8, title: '阶段确认' },
      name: 'IpdReviews',
      path: 'reviews',
    },
    // ⑨ 协同绩效（原型 /performance 单页）—— 2026-09-06 菜单入口改直连真 KPI 页：子页
    //    functional/project-score/bonus-pool 等真组件已挂 /ipd/kpi|incentive 隐藏路由，原 pending
    //    占位会让菜单点进去停在占位页；V3.1 回款台账与津贴读端点缺已登记（W3-Backend-B1）
    {
      meta: { icon: 'lucide:bar-chart-3', order: 9, title: '协同绩效' },
      name: 'IpdPerformance',
      path: 'performance',
      redirect: '/ipd/kpi/functional',
    },
    // ⑩ 全流程轨迹（原型 /timeline；无 timeline 聚合端点，audit-logs 已交付）
    //    2026-09-06 真实现：审计日志 + 工作台待办 + 奖金池三源融合，五态齐全。
    {
      component: () => import('#/views/ipd/timeline/index.vue'),
      meta: { icon: 'lucide:book-open', ipdCard: 'ZK-D2', order: 10, title: '全流程轨迹' },
      name: 'IpdTimeline', path: 'timeline',
    },
    // ⑪ 报表分析（原型 /reports；2026-09-06 复刻：P4-4.1 月度绩效汇总+三类台账导出已交付为页面主区，
    //    原型 analytics 流程分析四卡/建议卡按原型渲染但数值区登记真缺口）
    {
      component: () => import('#/views/ipd/report/index.vue'),
      meta: { icon: 'lucide:line-chart', order: 11, title: '报表分析' },
      name: 'IpdReports',
      path: 'reports',
    },
    // ⑫ 项目移交（原型 /handoffs，页27；2026-09-06 复刻：/handovers 发起/接受/收件箱/批量/超管移交已交付，
    //    原型 scope 四卡预检/责任确认链/取消/产品续交不同构在页内登记）
    {
      component: () => import('#/views/ipd/handover/index.vue'),
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/handover'] ?? [])], icon: 'lucide:users', order: 12, title: '项目移交' },
      name: 'IpdHandover',
      path: 'handover',
    },
    // KPI 考核 + 激励管理（页29-36）：原型归入协同绩效，路由保留降为隐藏
    {
      component: () => import('#/views/_core/fallback/not-found.vue'),
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
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/kpi/functional'] ?? [])], activePath: '/ipd/performance', title: '功能 KPI' },
          name: 'IpdKpiFunctional',
          path: 'functional',
        },
        // 页29-30 共担 KPI 归集（按月聚合） —— 2026-09-06 真实现：SharedKpiController.listShared（W4-E）已交付，
        //    GET /api/v1/kpi/shared?projectId&period 返回 List<KpiRecord>（按 revision DESC）；
        //    前端 IpdKpiShared 真组件承载双 PM 各自归集 + revision 维度分组 + 关联奖金池列表。
        {
          component: () => import('#/views/ipd/kpi/shared/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/kpi/functional'] ?? [])], activePath: '/ipd/performance', ipdCard: 'P0-10.30', title: '共担 KPI 归集' },
          name: 'IpdKpiShared', path: 'shared',
        },
        {
          // 页31 项目绩效评定 —— 2026-09-06 复刻：ProjectScoreController（明细/结算）+ TaskController（scan）已交付为真组件
          component: () => import('#/views/ipd/kpi/project-score/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/kpi/project-score'] ?? [])], ipdCard: 'P0-10.31', title: '项目绩效评定' },
          name: 'IpdKpiScore',
          path: 'project-score',
        },
      ],
    },
    // ⑧ 激励管理（页33-36）：并入协同绩效，路由保留降为隐藏
    {
      component: () => import('#/views/_core/fallback/not-found.vue'),
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
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/incentive/allowance'] ?? [])], ipdCard: 'P0-10.33', title: '津贴台账' },
          name: 'IpdAllowance',
          path: 'allowance',
        },
        {
          component: () => import('#/views/ipd/incentive/bonus-pool/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/incentive/bonus-pool'] ?? [])], activePath: '/ipd/projects', hideInMenu: true, ipdCard: 'P0-10.34', title: '奖金池核算' },
          name: 'IpdBonusPool',
          path: 'bonus-pool',
        },
        {
          // 页35 贡献度评定 —— 2026-09-06 复刻：ContributionController 已交付为真组件，市场 PM 40-65%/
          //    研发 PM 35-60% / preview-save-confirm 端点已就位，原型 marketShare 70/30 默认已改
          component: () => import('#/views/ipd/incentive/contribution/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/incentive/contribution'] ?? [])], ipdCard: 'P0-10.35', title: '贡献度评定' },
          name: 'IpdContribution',
          path: 'contribution',
        },
        {
          // 页36 负反馈执行 —— 2026-09-06 复刻：NegativeFeedbackController（submit/decide/lift/by-project）
          //    已交付为真组件；停发/连带减半/共同担责三档与 triggerType 枚举已接入
          component: () => import('#/views/ipd/incentive/negative-feedback/index.vue'),
          meta: { access: [...(PAGE_PERMISSIONS['/ipd/incentive/negative-feedback'] ?? [])], ipdCard: 'P0-10.36', title: '负反馈执行' },
          name: 'IpdNegativeFeedback',
          path: 'negative-feedback',
        },
      ],
    },
    // AI 文档助手（页42）—— 原型为全局面板非一级路由，路由保留降为隐藏 —— fe-detail 整体覆盖
    {
      component: () => import('#/views/ipd/ai-docs/index.vue'),
      meta: { access: [...(PAGE_PERMISSIONS['/ipd/ai-assistant'] ?? [])], hideInMenu: true, icon: 'lucide:bot', title: 'AI 文档助手' },
      name: 'IpdAiAssistant',
      path: 'ai-assistant',
    },
    // 删除审核（页04/05/43）—— 原型非一级路由（统一软删除机制），路由保留降为隐藏
    {
      component: () => import('#/views/_core/fallback/not-found.vue'),
      meta: { hideInMenu: true, icon: 'lucide:trash-2', title: '删除审核' },
      name: 'IpdDeletion',
      path: 'deletion',
      redirect: '/ipd/deletion/my-requests',
      children: [
        {
          component: () => import('#/views/ipd/deletion/my-requests/index.vue'),
          meta: { title: '我的申请' },
          name: 'IpdDeletionMy',
          path: 'my-requests',
        },
        {
          component: () => import('#/views/ipd/deletion/review/index.vue'),
          meta: { title: '待我审核' },
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
      meta: { authority: ['SUPER_ADMIN'], icon: 'lucide:package', order: 13, title: '产品目录' },
      name: 'IpdProductCatalog',
      path: 'product-catalog',
    },
    // ⑭ 人员同步〔超管〕（原型 /identity-sync；无 identity-source Controller，P2-2.3）
    //    2026-09-06 真实现：身份 / 同步源类型 / 来源实例 / 最近同步时间三类维度如实登记真缺口，
    //    主体挂 GET /pm-directory（在职人员目录）真组件，IPD_PERMISSION_CODES.IDENTITY_SYNC_* 权限码走 _shared。
    {
      component: () => import('#/views/ipd/admin/identity-sync/index.vue'),
      meta: { authority: ['SUPER_ADMIN'], icon: 'lucide:database', ipdCard: 'P0-10.44', order: 14, title: '人员同步' },
      name: 'IpdIdentitySync', path: 'identity-sync',
    },
    // ⑮ 超级管理〔超管〕（原型 /admin，页06/18/28/44-49）
    {
      component: () => import('#/views/_core/fallback/not-found.vue'),
      meta: { authority: ['SUPER_ADMIN'], icon: 'lucide:settings', order: 15, title: '超级管理' },
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
        // 页46 SOP 模板 —— fe-admin 整体覆盖
        {
          component: () => import('#/views/ipd/admin/sop-template/index.vue'),
          meta: { access: [IPD_PERMISSION_CODES.SOP_TEMPLATE_EDIT], title: 'SOP 模板' },
          name: 'IpdAdminSop',
          path: 'sop',
        },
        // 页47 Gate 评审要素 —— fe-admin 整体覆盖
        {
          component: () => import('#/views/ipd/admin/gate-elements/index.vue'),
          meta: { access: [IPD_PERMISSION_CODES.GATE_ELEMENT_LIST], title: 'Gate 评审要素' },
          name: 'IpdAdminGateElements',
          path: 'gate-elements',
        },
        {
          component: () => import('#/views/ipd/cert/templates/index.vue'),
          meta: { access: [IPD_PERMISSION_CODES.CERT_TEMPLATE_LIST], title: '国别认证清单模板库' },
          name: 'IpdAdminCertTemplates',
          path: 'cert-templates',
        },
        // 页48 AI 模型配置 —— fe-admin 整体覆盖
        {
          component: () => import('#/views/ipd/admin/ai-models/index.vue'),
          meta: { access: [IPD_PERMISSION_CODES.AI_MODEL_LIST, IPD_PERMISSION_CODES.AI_MODEL_EDIT], title: 'AI 模型配置' },
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
          meta: { access: [IPD_PERMISSION_CODES.HANDOVER_CANCEL], title: '超级管理员移交' },
          name: 'IpdAdminHandover',
          path: 'handover',
        },
      ],
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

export default [ipdLayoutRoute];

/** 供守卫生成菜单使用。 */
export { ipdLayoutRoute };
