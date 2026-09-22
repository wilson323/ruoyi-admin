/**
 * Gate 评审详情页按钮决策（前端单一权威源；R177-A6）。
 *
 * 状态机（与后端 `GateReviewService.STATUS_*` 对齐）：
 * - status: PENDING | APPROVED | REJECTED | ABSTAINED_TIMEOUT
 *
 * 评审操作 9 个按钮决策矩阵（4 状态 × 9 按钮 = 36 决策点）：
 *
 * | 状态 \\ 按钮        | signApprove | signReject | reopen | extend | arbitrateApprove | arbitrateReject | finalRulingApprove | finalRulingReject | refresh |
 * | PENDING             |     ✓       |     ✓     |   ✗   |   ✓   |        ✓        |        ✓        |         ✓         |         ✓        |    ✓    |
 * | APPROVED            |     ✗       |     ✗     |   ✗   |   ✗   |        ✗        |        ✗        |         ✗         |         ✗        |    ✓    |
 * | REJECTED            |     ✗       |     ✗     |   ✓   |   ✗   |        ✗        |        ✗        |         ✗         |         ✗        |    ✓    |
 * | ABSTAINED_TIMEOUT   |     ✗       |     ✗     |   ✗   |   ✗   |        ✗        |        ✗        |         ✗         |         ✗        |    ✓    |
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
      // 仅 PENDING 可仲裁同意（组长权限）
      if (status === 'PENDING') return VISIBLE;
      return HIDDEN('仅流转中可仲裁');

    case 'arbitrateReject':
      // 仅 PENDING 可仲裁驳回（组长权限）
      if (status === 'PENDING') return VISIBLE;
      return HIDDEN('仅流转中可仲裁');

    case 'finalRulingApprove':
      // 仅 PENDING 可终裁通过（超管权限）
      if (status === 'PENDING') return VISIBLE;
      return HIDDEN('仅流转中可终裁');

    case 'finalRulingReject':
      // 仅 PENDING 可终裁驳回（超管权限）
      if (status === 'PENDING') return VISIBLE;
      return HIDDEN('仅流转中可终裁');

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
