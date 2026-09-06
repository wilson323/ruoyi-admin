/**
 * @deprecated 自 2026-09-06 根因分析后：本文件统一为 _shared/ipd-error-text.ts 的 re-export。
 * 历史分散的 BID_CODE_TEXTS / bidErrorText 已迁入共享表。
 * 消费方应改 import 自 '../_shared/ipd-error-text' 的 ipdErrorText 并传 domain='bid'。
 * 本文件保留仅供旧 import 兼容。
 *
 * 治理依据：docs/ipd-系统说明/前端架构规约-20260906.md §3
 * 守护机制：.claude/helpers/ipd-frontend-drift-guard.cjs + scripts/check-ipd-frontend-drift.sh
 */
import { ipdErrorText as _ipdErrorText, isTransportError as _isTransportError, withCodeTextOverrides } from '../_shared/ipd-error-text';

export interface BidErrorOptions {
  fallback?: string;
  codeTexts?: Record<number, string>;
}

export function bidErrorText(error: unknown, options: BidErrorOptions = {}): string {
  return _ipdErrorText(error, { domain: 'bid', ...options });
}

export const bidErrorTextWith = (codeTexts: Record<number, string>) =>
  withCodeTextOverrides(codeTexts, { domain: 'bid' });

export const isTransportError = _isTransportError;

