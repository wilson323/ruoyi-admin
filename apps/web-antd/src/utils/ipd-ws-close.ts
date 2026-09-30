/**
 * IPD WebSocket 被服务端关掉之后，要不要让 vueuse 自动重连。
 *
 * 服务端 WebSocketSessionHolder 同一 userId 只留一条连接，顶替旧连接时
 * 使用 Spring CloseStatus.BAD_DATA（1007）。旧页面若继续重连，会把新连接
 * 再顶掉，两边大约每秒互踢一次，而且每次握手成功都会把重试计数清零。
 * 1007 也用于票无效，重连同样没有意义。
 */
export function shouldRetryIpdWebSocket(closeCode: number): boolean {
  return closeCode !== 1007;
}
