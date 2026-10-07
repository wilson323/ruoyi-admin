/**
 * Gate 评审详情页按钮决策（前端单一权威源；R177-A6）。
 *
 * 状态机（与后端 `GateReviewService.STATUS_*` 对齐）：
 * - status: PENDING | APPROVED | REJECTED | ABSTAINED_TIMEOUT
 *
 * 评审操作 9 个按钮决策矩阵（4 状态 × 9 按钮 = 36 决策点）：
 *
 * | 状态 \\ 按钮        | signApprove | signReject | reopen | extend | arbitrateApprove | arbitrateReject | finalRulingApprove | finalRulingReject | refresh |
 * | PENDING             |     ✓       |     ✓     |   ✗   |   ✓   |        ✗        |        ✗        |         ✗         |         ✗        |    ✓    |
 * | APPROVED            |     ✗       |     ✗     |   ✗   |   ✗   |        ✗        |        ✗        |         ✗         |         ✗        |    ✓    |
 * | REJECTED            |     ✗       |     ✗     |   ✓   |   ✗   |        ✓        |        ✓        |         ✓         |         ✓        |    ✓    |
 * | ABSTAINED_TIMEOUT   |     ✗       |     ✗     |   ✗   |   ✗   |        ✗        |        ✗        |         ✗         |         ✗        |    ✓    |
 *
 * 仲裁 / 终裁的可见状态（2026-10-07 修复，依据后端现读代码，非推测）：
 * 后端 GateReviewService.requireArbitratable 的前置断言是「操作人角色匹配 + Gate 状态
 * = REJECTED + 当轮双 PM 意见分歧（hasPmConflict）」，而 arbitrate()（组长仲裁）与
 * finalRuling()（超管终裁）两个入口都先过这条断言——即后端只在 REJECTED 受理这两个动作。
 * 此前本矩阵把 arbitrate* / finalRuling* 挂在 PENDING 上：在途时按钮可点但后端必拒，
 * 驳回后（真正该仲裁/终裁的状态）反而没有入口，形成「UI 无有效入口」死结。
 * 现改为 REJECTED 可见，与后端受理状态同语义。
 *
 * 前端不可判定的后端附加前置（不在此矩阵内，如实标注，不伪造数据源）：
 * - 仲裁：调用者须为冲突双方所在组的产品组长（角色门由 v-access:code + 后端二次校验）；
 * - 终裁：后端 finalRuling 还要求「≥2 位组长的仲裁行已落决策且意见不一致」——
 *   gate_arbitrations 只有写入端点（GateReviewController 的 POST /arbitrate、
 *   POST /final-ruling），没有任何读取端点，GateReviewService.arbitrationRows 为 private，
 *   前端拿不到「几位组长已裁」，故此处只按状态显示；未升级即提交由后端 fail-closed
 *   文案（"组长仲裁尚未形成两组对立意见，暂无需超管终裁"）兜住。
 *
 * 决策函数纯函数无副作用，便于 vitest 覆盖。权限控制（超管/组长/普通）由 v-access:code 单独控制，
 * 决策矩阵只看 Gate 状态。
 */

/** Gate 评审状态（与 GateReviewController.GateStatus 一致）。 */
export type GateDetailStatus =
  | 'ABSTAINED_TIMEOUT'
  | 'APPROVED'
  | 'PENDING'
  | 'REJECTED';

/** 评审操作 9 个按钮。 */
export type GateDetailRowButton =
  | 'arbitrateApprove'
  | 'arbitrateReject'
  | 'extend'
  | 'finalRulingApprove'
  | 'finalRulingReject'
  | 'refresh'
  | 'reopen'
  | 'signApprove'
  | 'signReject';

export interface ButtonPolicyDecision {
  /** 后端契约已禁止；前置隐藏避免无效请求。 */
  hidden: boolean;
  /** 隐藏原因（中文；前端 hover tooltip 用）。 */
  reason?: string;
  /** 显示。 */
  visible: boolean;
}

const VISIBLE: ButtonPolicyDecision = Object.freeze({ hidden: false, visible: true });
const HIDDEN = (reason: string): ButtonPolicyDecision =>
  Object.freeze({ hidden: true, visible: false, reason });

/**
 * 单一决策函数。state 必须提供 status；本决策矩阵仅基于 Gate 状态做决策。
 */
export function decideRowButton(
  button: GateDetailRowButton,
  state: { status: GateDetailStatus },
): ButtonPolicyDecision {
  const { status } = state;
  switch (button) {
    case 'signApprove':
      // 仅 PENDING 可签署通过
      if (status === 'PENDING') return VISIBLE;
      if (status === 'APPROVED') return HIDDEN('已通过，无需签署');
      if (status === 'REJECTED') return HIDDEN('已驳回，请走 reopen 流程');
      return HIDDEN('已超时弃权，不可签署');

    case 'signReject':
      // 仅 PENDING 可签署驳回
      if (status === 'PENDING') return VISIBLE;
      if (status === 'APPROVED') return HIDDEN('已通过，无法驳回');
      if (status === 'REJECTED') return HIDDEN('已驳回');
      return HIDDEN('已超时弃权，不可签署');

    case 'reopen':
      // 仅 REJECTED 可重新发起新一轮
      if (status === 'REJECTED') return VISIBLE;
      if (status === 'PENDING') return HIDDEN('当前在途，请先等待结果');
      if (status === 'APPROVED') return HIDDEN('已通过，无须重新发起');
      return HIDDEN('已超时弃权，不可 reopen');

    case 'extend':
      // 仅 PENDING 可延期（超管权限，权限由 v-access 控制）
      if (status === 'PENDING') return VISIBLE;
      if (status === 'APPROVED') return HIDDEN('已通过，签署期限已无意义');
      if (status === 'REJECTED') return HIDDEN('已驳回，签署期限已无意义');
      return HIDDEN('已超时弃权，期限已结束');

    case 'arbitrateApprove':
      // 仅 REJECTED 可仲裁同意（组长权限）：后端 requireArbitratable 前置 STATUS_REJECTED
      if (status === 'REJECTED') return VISIBLE;
      if (status === 'PENDING') return HIDDEN('尚未驳回，无仲裁流程（后端仅受理已驳回的 Gate）');
      if (status === 'APPROVED') return HIDDEN('已通过，无仲裁流程');
      return HIDDEN('已超时弃权，无仲裁流程');

    case 'arbitrateReject':
      // 仅 REJECTED 可仲裁驳回（组长权限）：同上，后端只在被驳回的 Gate 上受理仲裁
      if (status === 'REJECTED') return VISIBLE;
      if (status === 'PENDING') return HIDDEN('尚未驳回，无仲裁流程（后端仅受理已驳回的 Gate）');
      if (status === 'APPROVED') return HIDDEN('已通过，无仲裁流程');
      return HIDDEN('已超时弃权，无仲裁流程');

    case 'finalRulingApprove':
      // 仅 REJECTED 可终裁通过（超管权限）：后端 requireArbitratable 前置 STATUS_REJECTED。
      // 后端另需「≥2 位组长已裁且意见不一致」——前端无 gate_arbitrations 读取端点，不可判定，
      // 只按状态显示（见文件头「前端不可判定的后端附加前置」）。
      if (status === 'REJECTED') return VISIBLE;
      if (status === 'PENDING') return HIDDEN('尚未驳回，无终裁流程（后端仅受理已驳回的 Gate）');
      if (status === 'APPROVED') return HIDDEN('已通过，无终裁流程');
      return HIDDEN('已超时弃权，无终裁流程');

    case 'finalRulingReject':
      // 仅 REJECTED 可终裁驳回（超管权限）：同 finalRulingApprove，前置与数据限制一致
      if (status === 'REJECTED') return VISIBLE;
      if (status === 'PENDING') return HIDDEN('尚未驳回，无终裁流程（后端仅受理已驳回的 Gate）');
      if (status === 'APPROVED') return HIDDEN('已通过，无终裁流程');
      return HIDDEN('已超时弃权，无终裁流程');

    case 'refresh':
      // 任何状态都可刷新（重新加载评审视图）
      return VISIBLE;
  }
}

/** 行按钮顺序（操作列从左到右）。 */
export const ROW_BUTTON_ORDER: readonly GateDetailRowButton[] = Object.freeze([
  'signApprove',
  'signReject',
  'reopen',
  'extend',
  'arbitrateApprove',
  'arbitrateReject',
  'finalRulingApprove',
  'finalRulingReject',
  'refresh',
]);

/** 行按钮显示名。 */
export const ROW_BUTTON_LABEL: Readonly<Record<GateDetailRowButton, string>> = Object.freeze({
  arbitrateApprove: '仲裁同意',
  arbitrateReject: '仲裁驳回',
  extend: '延期',
  finalRulingApprove: '终裁通过',
  finalRulingReject: '终裁驳回',
  refresh: '刷新',
  reopen: '重新发起',
  signApprove: '签署通过',
  signReject: '签署驳回',
});
