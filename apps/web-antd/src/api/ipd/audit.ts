/**
 * 审计域 API（P0-5.4 / AC-AUD-04/05 + DEF-9 验链修复）。
 *
 * 端点挂在 /api/v1/audit-logs（前缀由 requestIpd 补齐）：
 * - /scope 任何已登录角色可调，范围由后端按会话角色透明解析
 *   （SUPER_ADMIN=GLOBAL 全库 / GROUP_LEADER=GROUP 本组 / PM=OWN 仅本人）；
 * - /verify 四态诊断（OK / HASH_BROKEN / GAP / BROKEN），仅超管；
 * - /export/scope 落 EXPORT 审计并返回可导出行数（流式文件待后端）；
 * - /rebuild-chain 仅超管，重算全链哈希（DEF-4），幂等；
 * - 服务端目前不支持按 entity/action 过滤，页面过滤仅作用于当前页（本地）。
 */
import { ipdGet, ipdPost } from './http';

export interface AuditLog {
  id: string;
  seq: number;
  operatorId: string;
  operatorName?: string;
  operatorRole?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  beforeData?: string;
  afterData?: string;
  reason?: string;
  prevHash?: string;
  currHash?: string;
  ipAddress?: string;
  createTime?: number | string;
}

export interface AuditScopePage {
  scope: 'GLOBAL' | 'GROUP' | 'OWN';
  operatorIds: string[];
  page: {
    records: AuditLog[];
    total: number;
    current: number;
    size: number;
    pages: number;
  };
}

// 后端 /audit-logs/scope 只收 pageNo/pageSize；曾误发的 beforeSeq 游标后端不收（静默丢参），
// 2026-09-06 契约审计后删除——增量游标待后端补收后再加回。
export function pageAuditByScope(pageNo = 1, pageSize = 20): Promise<AuditScopePage> {
  return ipdGet('/audit-logs/scope', { pageNo, pageSize });
}

export interface AuditChainVerifyResultView {
  /** 兼容出口：两类断裂合并去重升序（历史消费者语义）。 */
  broken: number;
  hashBroken: number;
  gaps: number;
  chain: 'BROKEN' | 'GAP' | 'HASH_BROKEN' | 'OK';
  total: number;
  genesis: string;
}

export function verifyAuditChain(): Promise<AuditChainVerifyResultView> {
  return ipdGet('/audit-logs/verify');
}

export function exportAuditByScope(): Promise<{ exported: number; scope: string }> {
  return ipdGet('/audit-logs/export/scope');
}

export function rebuildAuditChain(): Promise<{ fixed: number }> {
  return ipdPost('/audit-logs/rebuild-chain');
}

/** beforeData / afterData 是 JSON 字符串：合法则解析为对象，非法原文返回，空值返回 null。 */
export function parseAuditPayload(raw: null | string | undefined): Record<string, unknown> | string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : raw;
  } catch {
    return raw;
  }
}

/** 项目维度过滤（页15）：服务端 entity 过滤交付前，仅对当前页做本地过滤。 */
export function filterAuditByEntity(logs: AuditLog[], entityId: string): AuditLog[] {
  return logs.filter((log) => log.entityId === entityId);
}
