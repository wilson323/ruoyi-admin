/**
 * 当前产物版本允许的审核动作。
 *
 * 审核通过对应 review：待审核或已退回。
 * 退回修改对应 reject：待审核或已审核；待审核必须是链头，由调用方只把链头传进来。
 * 已退回不再提供退回，避免覆盖这一版上的原意见。
 */

export interface HeadReviewActions {
  approve: boolean;
  reject: boolean;
}

/** 按版本状态给出审核通过、退回修改是否可点。 */
export function headReviewActions(status: string): HeadReviewActions {
  return {
    approve: status === 'GENERATED' || status === 'REJECTED',
    reject: status === 'GENERATED' || status === 'REVIEWED',
  };
}

const STATUS_TEXT: Record<string, string> = {
  ARCHIVED: '已归档',
  GENERATED: '待审核',
  REJECTED: '已退回',
  REVIEWED: '已审核',
};

/** 库内状态码的用户可见名。待审核对应 GENERATED。 */
export function documentStatusLabel(status: string): string {
  return STATUS_TEXT[status] ?? status;
}
