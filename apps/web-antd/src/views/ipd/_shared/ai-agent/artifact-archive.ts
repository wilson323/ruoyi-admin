/**
 * 工作成果定档回执文案。
 *
 * 定档只调用已有 apply：库内码 GENERATED 的用户可见主状态是「待审核」（与文档列表同一词）。
 * 知识库索引以回执 indexStatus 为准；NOT_INDEXED 表示尚未审核入库，不得写成已入库或已完成。
 */
import type { ApplyAgentArtifactReceipt } from '../../../../api/ipd/project-agent';

/** 与文档列表 STATUS_META 对齐，不另起一套状态机。 */
const DOCUMENT_STATUS_TEXT: Record<string, string> = {
  ARCHIVED: '已归档',
  GENERATED: '待审核',
  REJECTED: '已拒绝',
  REVIEWED: '已审核',
};

/**
 * apply 回执的用户可见主状态。优先用后端 documentStatusLabel，否则按既有码翻译。
 *
 * @param receipt apply 回执
 * @returns 中文主状态；GENERATED 恒为「待审核」
 */
export function documentStatusText(receipt: ApplyAgentArtifactReceipt): string {
  const label = receipt.documentStatusLabel?.trim();
  if (label) return label;
  return DOCUMENT_STATUS_TEXT[receipt.documentStatus] ?? receipt.documentStatus;
}

/**
 * 把定档回执写成给用户看的一句结果。
 *
 * @param receipt apply 回执；documentId 为空时返回空串（调用方按失败处理）
 * @returns 含文档编号、待审核主状态、知识库索引说明；无法定档时为空串
 */
export function archiveResultText(receipt: ApplyAgentArtifactReceipt): string {
  if (!receipt.documentId) return '';
  const index =
    receipt.indexStatus === 'NOT_INDEXED'
      ? '知识库未入库，待审核后才索引'
      : `知识库索引：${receipt.indexStatus}`;
  return `已回填项目文档 #${receipt.documentId}，状态：${documentStatusText(receipt)}。${index}`;
}
