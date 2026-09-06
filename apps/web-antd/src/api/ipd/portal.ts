/**
 * 游客需求门户接口（页38/39，免登录）。
 *
 * 独立于 http.ts 的会话封装：游客没有 IPD 会话，绝不携带 Authorization，
 * 仅访问 /api/v1/public/**（IpdWebSecurityConfig 对 /api/v1/public/** 匿名放行）。
 * 包络与错误处理与 api/ipd/auth.ts requestIpd 保持一致：code=0 为成功，
 * 失败映射为已登记业务码（ApiV1ErrorCode.java）的固定中文文案，
 * 不透传服务端任意字符串给游客页面。
 *
 * 自 2026-09-06 根因分析：原 PORTAL_ERROR_TEXT 内联副本已迁入 _shared/ipd-error-text.ts
 * 的 portal 域默认表，构造异常消息时改用 ipdErrorText 查表，确保与视图层展示文案同源。
 *
 * 治理依据：docs/ipd-系统说明/前端架构规约-20260906.md §3
 * 守护机制：scripts/check-ipd-frontend-drift.sh
 */
import { ipdErrorText } from '../../views/ipd/_shared/ipd-error-text';
import { IpdRequestError } from './auth';

/** 页38 三情形产品（PublicProductView；ID 后端按字符串序列化，前端不数值化）。 */
export interface PortalProduct {
  id: string;
  /** 派生三情形：ON_SALE 在售 / IN_DEV 在研 / OTHER 其他。 */
  listingStatus: 'IN_DEV' | 'ON_SALE' | 'OTHER';
  modelCode: null | string;
  productName: string;
  status: string;
}

/** 页38 提交成功视图（GuestDemandSubmittedView）：仅查询码与初始状态。 */
export interface PortalDemandSubmitted {
  code: string;
  status: string;
}

/** 页38 提交请求（GuestDemandSubmitReq 白名单字段；website 为蜜罐字段，正常用户恒为空）。 */
export interface PortalSubmitInput {
  contact?: string;
  customerName: string;
  feedbackPerson: string;
  functionalRequirement: string;
  productId: null | string;
  rawModel: null | string;
  website?: string;
}

/** 页39 进度附件（脱敏视图：仅文件名与大小）。 */
export interface PortalTraceAttachment {
  fileName: string;
  fileSize: null | number | string;
}

/** 页39 时间线条目（后端端点未交付，形状按规格 §4 约定，前端宽松解析）。 */
export interface PortalTraceTimelineEntry {
  memo?: string;
  occurredAt?: string;
  stage: string;
}

/** 页39 脱敏进度视图（规格 §4：code/status/customerName(脱敏)/timeline/attachments/…）。 */
export interface PortalDemandTrace {
  attachments: PortalTraceAttachment[];
  canSupplement: boolean;
  canWithdraw: boolean;
  code: string;
  customerName: string;
  status: string;
  timeline: PortalTraceTimelineEntry[];
  withdrawDeadlineAt: null | string;
}

/** BR-REQ-03：8 位大写字母+数字查询码（与后端 QUERY_CODE_PATTERN 一致）。 */
export const PORTAL_CODE_PATTERN = /^[A-Z0-9]{8}$/;

/** 已登记业务码 → 游客可读文案已迁入 _shared/ipd-error-text.ts IPD_DOMAIN_DEFAULTS.portal；
 *  本常量仅用于 fallback/未登记码兜底与请求构造阶段的非业务码场景。 */
const DEFAULT_ERROR_TEXT = '服务暂时不可用，请稍后重试';
const TRANSPORT_ERROR_TEXT = '无法连接服务，请检查网络后重试';
const MALFORMED_ERROR_TEXT = '服务响应格式异常，请稍后重试';

/** 探针实测：未匹配路由被 advice 兜底成 {code:404,message:null,...}——按业务码读而非 message。 */
const ROUTE_NOT_FOUND_TEXT = '未查询到对应的资源，请稍后再试';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown): null | string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;

async function requestPortal<T>(
  path: string,
  init: { body?: object; method: 'GET' | 'POST' } = { method: 'GET' },
): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15_000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body) headers['Content-Type'] = 'application/json';
    // 与 requestIpd 唯一的本职差异：游客请求不携带任何会话凭据
    const response = await fetch(`/api/v1/public${path}`, {
      body: init.body ? JSON.stringify(init.body) : undefined,
      credentials: 'omit',
      headers,
      method: init.method,
      signal: abort.signal,
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new IpdRequestError(DEFAULT_ERROR_TEXT, response.status);
    }
    const body: unknown = await response.json();
    // 探针实测：部分历史端点直接返回裸 JSON 数组（如 /products），此处按形状兼容：
    // 数组 → 原样视为业务数据；非数 envelope → 严格校验 code/message/data。
    if (Array.isArray(body)) return body as T;
    if (!record(body) || typeof body.code !== 'number' || !('data' in body)) {
      throw new IpdRequestError(MALFORMED_ERROR_TEXT, response.status);
    }
    // envelope.message 允许为 null（探针实测未匹配路由的 message 为 null），不强制字符串。
    if (!response.ok || body.code !== 0) {
      // 2026-09-06 重构：用共享表构造异常消息，避免 PORTAL_ERROR_TEXT 与视图层 ipdErrorText 双源。
      // 兜底逻辑保留：HTTP 404 优先返回 ROUTE_NOT_FOUND_TEXT（区别于业务 40401），否则 DEFAULT_ERROR_TEXT。
      const probe = new IpdRequestError('', response.status, body.code, 'http');
      const mapped = ipdErrorText(probe, {
        domain: 'portal',
        fallback: body.code === 404 ? ROUTE_NOT_FOUND_TEXT : DEFAULT_ERROR_TEXT,
      });
      throw new IpdRequestError(mapped, response.status, body.code, 'http');
    }
    return body.data as T;
  } catch (error) {
    if (error instanceof IpdRequestError) throw error;
    throw new IpdRequestError(TRANSPORT_ERROR_TEXT, 0, 0, 'transport');
  } finally {
    clearTimeout(timer);
  }
}

/** 宽松解析：仅强制 id/productName，单条畸形不拖垮整份列表。 */
function parseProducts(data: unknown): PortalProduct[] {
  if (!Array.isArray(data)) throw new IpdRequestError(MALFORMED_ERROR_TEXT);
  const items: PortalProduct[] = [];
  for (const raw of data) {
    if (!record(raw)) continue;
    const id = asString(raw.id);
    const productName = typeof raw.productName === 'string' ? raw.productName : '';
    if (!id || !productName) continue;
    items.push({
      id,
      listingStatus: raw.listingStatus === 'IN_DEV' || raw.listingStatus === 'ON_SALE' ? raw.listingStatus : 'OTHER',
      modelCode: typeof raw.modelCode === 'string' && raw.modelCode !== '' ? raw.modelCode : null,
      status: typeof raw.status === 'string' ? raw.status : '',
      productName,
    });
  }
  return items;
}

/** BR-REQ-03：响应查询码必须满足 8 位正则，否则视为响应异常而非提交成功。 */
function parseSubmitted(data: unknown): PortalDemandSubmitted {
  if (!record(data) || typeof data.code !== 'string' || !PORTAL_CODE_PATTERN.test(data.code) ||
      typeof data.status !== 'string' || data.status === '') {
    throw new IpdRequestError(MALFORMED_ERROR_TEXT);
  }
  return { code: data.code, status: data.status };
}

function parseTrace(data: unknown): PortalDemandTrace {
  if (!record(data) || typeof data.code !== 'string' || typeof data.status !== 'string' ||
      data.status === '') {
    throw new IpdRequestError(MALFORMED_ERROR_TEXT);
  }
  const timeline = Array.isArray(data.timeline)
    ? data.timeline
        .filter(record)
        .map((item) => ({
          memo: typeof item.memo === 'string' ? item.memo : undefined,
          occurredAt: typeof item.occurredAt === 'string' ? item.occurredAt : undefined,
          stage: typeof item.stage === 'string' ? item.stage : '',
        }))
        .filter((item) => item.stage !== '')
    : [];
  const attachments = Array.isArray(data.attachments)
    ? data.attachments
        .filter(record)
        .map((item) => ({
          fileName: typeof item.fileName === 'string' ? item.fileName : '',
          fileSize: typeof item.fileSize === 'number' || typeof item.fileSize === 'string' ? item.fileSize : null,
        }))
        .filter((item) => item.fileName !== '')
    : [];
  return {
    attachments,
    canSupplement: data.canSupplement === true,
    canWithdraw: data.canWithdraw === true,
    code: data.code,
    customerName: typeof data.customerName === 'string' ? data.customerName : '',
    status: data.status,
    timeline,
    withdrawDeadlineAt: typeof data.withdrawDeadlineAt === 'string' ? data.withdrawDeadlineAt : null,
  };
}

/** 页38：GET /api/v1/public/products——三情形选择源（仅 ACTIVE 产品）。 */
export function fetchPortalProducts(): Promise<PortalProduct[]> {
  return requestPortal<unknown>('/products').then(parseProducts);
}

/** 页38：POST /api/v1/public/demands——游客提交，返回 8 位查询码。 */
export function submitPortalDemand(input: PortalSubmitInput): Promise<PortalDemandSubmitted> {
  return requestPortal<unknown>('/demands', { body: { ...input }, method: 'POST' }).then(parseSubmitted);
}

/**
 * 页39：GET /api/v1/public/demands/:code——凭查询码查脱敏进度。
 * ⚠️ 后端 PublicPortalController 尚未交付该端点（规格 vs 代码差异已登记），
 * 端点落地前调用会得到服务错误态，页面五态兜底可用。
 */
export function fetchPortalDemandByCode(code: string): Promise<PortalDemandTrace> {
  return requestPortal<unknown>(`/demands/${encodeURIComponent(code)}`).then(parseTrace);
}
