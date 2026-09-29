/**
 * MCP 连接配置结构化模型（Track E5）。
 * 硬约束 #20：字段集 = 后端真实读取键（LOCAL: command+args / REMOTE: baseUrl，
 * LangChain4jMcpToolProviderService.createStdioClient/createRemoteClient 实证）。
 * env/headers 后端当前不读，E-A1 落地前**禁止**出现在任何 UI/序列化产物里。
 * 硬约束 #19：本模块只做「用户新输入」的序列化；服务端原值永不回显（@JsonIgnore），
 * 解析函数只用于高级视图的用户输入回同步，绝不用于预填服务端配置。
 */
export type McpToolType = 'BUILTIN' | 'LOCAL' | 'REMOTE';

export interface LocalConnectionDraft {
  args: string[];
  command: string;
}

export interface RemoteConnectionDraft {
  baseUrl: string;
}

export interface ConnectionDraft extends LocalConnectionDraft, RemoteConnectionDraft {}

export function emptyConnectionDraft(): ConnectionDraft {
  return { args: [], baseUrl: '', command: '' };
}

export function validateConnectionDraft(
  type: McpToolType,
  draft: ConnectionDraft,
): string[] {
  const errors: string[] = [];
  if (type === 'BUILTIN') {
    return errors;
  }
  if (type === 'LOCAL') {
    if (draft.command.trim() === '') {
      errors.push('command 必填（后端无 command 会拒绝启动本地工具）');
    }
    draft.args.forEach((arg, index) => {
      if (arg.trim() === '') errors.push(`args[${index}] 不可为空串`);
    });
    return errors;
  }
  const url = draft.baseUrl.trim();
  if (url === '') {
    errors.push('baseUrl 必填');
    return errors;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    errors.push('baseUrl 需为合法 URL（含协议，如 https://host/mcp）');
    return errors;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    errors.push('baseUrl 协议仅支持 http/https');
  }
  return errors;
}

export function buildConfigJson(type: McpToolType, draft: ConnectionDraft): string {
  if (type === 'LOCAL') {
    return JSON.stringify({
      args: draft.args.map((arg) => arg.trim()).filter((arg) => arg !== ''),
      command: draft.command.trim(),
    });
  }
  return JSON.stringify({ baseUrl: draft.baseUrl.trim() });
}

export function parseConfigJson(
  type: McpToolType,
  raw: string,
): null | ConnectionDraft {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (type === 'LOCAL') {
      const args = Array.isArray(record.args)
        ? record.args.map((arg) => String(arg))
        : null;
      if (typeof record.command !== 'string' || args === null) return null;
      return { args, baseUrl: '', command: record.command };
    }
    if (typeof record.baseUrl !== 'string') return null;
    return { args: [], baseUrl: record.baseUrl, command: '' };
  } catch {
    return null;
  }
}

export function configJsonToDraft(type: McpToolType, raw: string): ConnectionDraft {
  return parseConfigJson(type, raw) ?? emptyConnectionDraft();
}
