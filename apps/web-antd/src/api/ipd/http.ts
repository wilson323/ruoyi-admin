/**
 * IPD 业务接口统一入口。
 *
 * 所有 /api/v1 业务模块必须经由此文件发起请求：
 * - 自动携带会话 token 并复用 ipd-auth 的轮换/重试逻辑；
 * - code=0 包络已在 requestIpd 层校验，这里只做查询串拼装；
 * - ID 一律按字符串处理，金额保持字符串原样，不做递归转换。
 */
import { useIpdAuthStore } from '../../store/ipd-auth';

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, typeof value === 'string' ? value : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export async function ipdGet<T = unknown>(path: string, query?: Record<string, unknown>): Promise<T> {
  const auth = useIpdAuthStore();
  return (await auth.authenticatedRequest(`${path}${buildQuery(query)}`)) as T;
}

export async function ipdPost<T = unknown>(
  path: string,
  body?: object,
  query?: Record<string, unknown>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const auth = useIpdAuthStore();
  return (await auth.authenticatedRequest(`${path}${buildQuery(query)}`, {
    method: 'POST',
    body,
    timeoutMs: options?.timeoutMs,
  })) as T;
}

/** multipart 上传。不手写 Content-Type，让浏览器带 boundary。 */
export async function ipdUpload<T = unknown>(path: string, formData: FormData): Promise<T> {
  const auth = useIpdAuthStore();
  return (await auth.authenticatedRequest(path, { method: 'POST', formData })) as T;
}

export async function ipdPut<T = unknown>(path: string, body?: object): Promise<T> {
  const auth = useIpdAuthStore();
  return (await auth.authenticatedRequest(path, { method: 'PUT', body })) as T;
}

export async function ipdDelete<T = unknown>(path: string): Promise<T> {
  const auth = useIpdAuthStore();
  return (await auth.authenticatedRequest(path, { method: 'DELETE' })) as T;
}

/** 二进制下载仍复用真实 Person 会话与原有换票重试。 */
export async function ipdDownload(path: string): Promise<Blob> {
  const auth = useIpdAuthStore();
  return (await auth.authenticatedRequest(path, { responseType: 'blob' })) as Blob;
}
