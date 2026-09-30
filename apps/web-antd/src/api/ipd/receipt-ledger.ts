/**
 * 销售回款台账 API（页34 奖金池核算·回款面板；P3-4.1 AC-INC-16b/16c/31/31b/32；
 * R212 桶表 #75-77 = ORPHAN-A5 接线，看板卡 ab1fb0bd；2026-09-25）。
 *
 * 后端真值（ReceiptLedgerController 5510f9fa [P3-4.1] done）：
 * - GET  /receipt-ledgers/by-project/{projectId}   按项目查台账（AC-INC-16b 达成率口径明细）；
 * - POST /receipt-ledgers                           月度回款录入（AC-INC-16c；凭证可空，
 *                                                   source=RECEIPT 服务端定死；窗口由上市日起算 6 自然月）；
 * - POST /receipt-ledgers/{projectId}/refunds       退款冲减（AC-INC-31/31b；窗口内当期冲减，
 *                                                   窗口外拒绝回溯）。
 * 权限：录入/冲减同 ipd:bonus-pool:compute + @IpdAudit(adminOnly) → 实际仅超管（R215-N1 口径）；
 * 查询同 ipd:bonus-pool:query。ID 一律字符串化（19 位雪花 ID 不走 JSON number）；
 * 金额经 Jackson ToStringSerializer 以字符串下发，前端按 string 原样展示。
 */
import { ipdGet, ipdPost, ipdUpload } from './http';

/** 回款台账行（后端 ReceiptLedger domain；netAmount/inWindow 为只读生成列，可能为 null）。 */
export interface ReceiptLedger {
  id: string;
  projectId: string;
  /** 关联 bonus_pools.id（核算后回填，可空）。 */
  bonusPoolId: null | string;
  /** 回款月份 YYYY-MM。 */
  receiptMonth: null | string;
  /** 回款金额（正数）。 */
  receiptAmount: null | number | string;
  /** 退款冲减金额（正数；AC-INC-31b 窗口内当期冲减）。 */
  refundAmount: null | number | string;
  /** 净回款 = receiptAmount - refundAmount（生成列，只读）。 */
  netAmount?: null | number | string;
  /** 凭证附件 URL（银行回单/对账单，AC-INC-16c）。 */
  voucherUrl: null | string;
  /** 凭证 SHA256。 */
  voucherHash: null | string;
  /** 来源 RECEIPT|SHIPMENT（AC-INC-16b 口径必须是 RECEIPT，服务端定死）。 */
  source: null | string;
  /** 6 自然月窗口起算日（上市日期，AC-INC-32）。 */
  windowStart?: null | string;
  /** 6 自然月窗口截止日。 */
  windowEnd?: null | string;
  /** 是否在窗口内（生成列，只读；AC-INC-16d 窗外不计）。 */
  inWindow?: boolean | null;
  createTime?: null | string;
}

/**
 * 月度录入入参（后端 ReceiptLedgerCreateReq 真值）：
 * receiptAmount ≥ 0.01；refundAmount 可空（≥0）；凭证可空。
 * 有凭证时 voucherUrl / voucherHash 必须来自 uploadReceiptVoucher 的服务端回读，不要手填地址。
 */
export interface CreateReceiptLedgerReq {
  projectId: string;
  /** YYYY-MM。 */
  receiptMonth: string;
  receiptAmount: number | string;
  refundAmount?: number | string;
  voucherUrl?: string;
  /** 服务端 SHA-256。未上传凭证时不传。 */
  voucherHash?: string;
}

/** 凭证上传结果（POST /receipt-ledgers/projects/{projectId}/voucher）。 */
export interface ReceiptVoucherUpload {
  fileName: string;
  voucherHash: string;
  voucherUrl: string;
}

/** 退款冲减入参（后端 ReceiptRefundReq：窗口内当期冲减，窗口外后端拒绝）。 */
export interface RefundReceiptReq {
  /** YYYY-MM。 */
  month: string;
  /** 正数 ≥ 0.01。 */
  refundAmount: number | string;
}

/** 按项目查询回款台账（GET /receipt-ledgers/by-project/{projectId}）。 */
export function listReceiptLedgersByProject(projectId: string): Promise<ReceiptLedger[]> {
  return ipdGet<ReceiptLedger[]>(`/receipt-ledgers/by-project/${encodeURIComponent(projectId)}`);
}

/** 月度回款录入（POST /receipt-ledgers；仅超管，adminOnly 审计 RECEIPT_CREATE）。 */
export function createReceiptLedger(req: CreateReceiptLedgerReq): Promise<ReceiptLedger> {
  return ipdPost<ReceiptLedger>('/receipt-ledgers', req);
}

/**
 * 上传回款凭证（AC-INC-16c）。仅超管。
 *
 * @param projectId 项目编号
 * @param file 凭证文件（pdf/jpg/jpeg/png/webp，≤20MB）
 * @returns 服务端 URL、SHA-256 与原文件名
 */
export function uploadReceiptVoucher(projectId: string, file: File): Promise<ReceiptVoucherUpload> {
  const form = new FormData();
  form.append('file', file);
  return ipdUpload<ReceiptVoucherUpload>(
    `/receipt-ledgers/projects/${encodeURIComponent(projectId)}/voucher`,
    form,
  );
}

/** 退款冲减（POST /receipt-ledgers/{projectId}/refunds；仅超管，审计 RECEIPT_REFUND）。 */
export function refundReceiptLedger(projectId: string, req: RefundReceiptReq): Promise<ReceiptLedger> {
  return ipdPost<ReceiptLedger>(`/receipt-ledgers/${encodeURIComponent(projectId)}/refunds`, req);
}
