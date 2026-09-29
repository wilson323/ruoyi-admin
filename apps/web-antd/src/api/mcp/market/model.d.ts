export interface McpMarket {
  id: number;
  name: string;
  url: string;
  description: string;
  /** Write-only authentication configuration; responses intentionally omit it. */
  authConfig?: string;
  status: string;
  createTime: string;
  updateTime: string;
}

export interface McpMarketTool {
  id: number;
  marketId: number;
  toolName: string;
  toolDescription: string;
  toolVersion: string;
  isLoaded: boolean;
  localToolId: number;
  /**
   * E2-BE-1 白名单脱敏元数据（description/homepage/license/tags…）。
   * 原始 tool_metadata 后端刻意不出参（"Provider metadata is deliberately
   * excluded"）；E2-BE-1 未落地时该键缺席，前端走诚实空态。
   */
  metadataView?: Record<string, unknown> | null;
}

export interface McpMarketRefreshResult {
  success: boolean;
  message: string;
  addedCount: number;
  updatedCount: number;
}

export interface McpMarketListResult {
  success: boolean;
  data: McpMarket[];
  total: number;
}

export interface McpMarketToolListResult {
  success: boolean;
  data: McpMarketTool[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface McpMarketBatchLoadResult {
  successCount: number;
}
