import { useAppConfig } from '@vben/hooks';

import { useEventSource, useWebSocket } from '@vueuse/core';

import { useIpdAuthStore } from '#/store/ipd-auth';

const { apiURL, clientId, sseEnable, websocketEnable } = useAppConfig(
  import.meta.env,
  import.meta.env.PROD,
);

export function useSseMessage() {
  /**
   * 未开启 不监听
   */
  if (!sseEnable) {
    console.warn('当前未开启sse.');
    return;
  }
  const ipdAuthStore = useIpdAuthStore();
  // store 暴露的字段名是 token（不是 accessToken）；取错会拼出「Bearer undefined」。
  const token = ipdAuthStore.token;
  if (!token) {
    console.warn('IPD 会话未就绪，暂不建立 SSE 连接。');
    return;
  }
  // apiURL 已含 /api/v1（VITE_GLOB_API_URL=/api/v1），此处只拼 /resource/sse；
  // 由 vite 代理原样转发到 16039 的 /api/v1/resource/sse（IpdSseController）。
  // 2026-09-11 修复：原为 `${apiURL}/v1/resource/sse` 拼出双 v1 导致 404。
  // token 走 URL query 是 EventSource 浏览器 API 的硬约束（不支持自定义 header）。
  const sseAddr = `${apiURL}/resource/sse?clientid=${clientId}&Authorization=Bearer ${token}`;

  const sseReturnData = useEventSource(sseAddr, [], {
    autoReconnect: {
      delay: 1000,
      onFailed() {
        // 重连 3 次仍未成功：多为会话过期（/api/v1/resource/sse 返回 401）或网络异常。
        // 会话过期属预期状态，由认证流程接管（重新登录后 SSE 自动恢复）——
        // 不用 console.error 打红字（2026-09-11 消除误导性噪音，配合后端 401 语义修复）。
        console.info('[SSE] 重连未成功（会话可能已过期，重新登录后自动恢复）。');
      },
      retries: 3,
    },
  });

  return sseReturnData;
}

function isUrl(path?: string) {
  return /^https?:\/\//.test(path || '');
}

export function useWebSocketMessage() {
  if (!websocketEnable) {
    console.warn('当前未开启websocket.');
    return;
  }
  // 2026-09-11 启用（C2，三层休眠项解除）：
  // ① 路径：后端 IpdWebSocketConfig 注册在 /api/v1/resource/websocket（IPD token 握手），
  //    apiURL 已含 /api/v1（VITE_GLOB_API_URL=/api/v1），此处只拼 /resource/websocket；
  //    vite 代理「/api/v1 开头不剥离」→ 原样转发到 16039 同路径。
  // ② 票源：改用 IPD 会话 token（ipdAuthStore.token），后端 IpdHandshakeInterceptor
  //    按 loginType=ipd 校验；不再用平台票（accessStore.accessToken）。
  // ③ 握手 token 参数名是 token=（非 SSE 的 Authorization=Bearer 格式）——
  //    IpdHandshakeInterceptor.QUERY_PARAM_TOKEN 只认 token 键。
  // 通道分工（与 SSE 不重叠，无需幂等去重）：
  //    SSE=聊天/AI/工作流消息（chat 模块推送）；WS=IPD 业务通知（NotificationDispatcher → WEBSOCKET 通道）。
  const ipdAuthStore = useIpdAuthStore();
  const token = ipdAuthStore.token;
  if (!token) {
    console.warn('IPD 会话未就绪，暂不建立 WebSocket 连接。');
    return;
  }
  let apiUrlStr = String(apiURL);
  /**
   * 这里可能有两种情况 兼容dev模式的proxy或者prod模式但是没有用全路径比如http://xxx/xxx
   * 1. apiUrl为https://xxx.com/xxx
   * 2. apiUrl为/xxx
   * 转换后为http链接形式
   */
  if (!isUrl(apiURL)) {
    // 协议+域名
    apiUrlStr = `${window.location.protocol}//${window.location.host}${apiURL}`;
  }
  // 这里是http链接形式
  let websocketAddr = `${apiUrlStr}/resource/websocket?token=${token}`;
  // http/https处理
  websocketAddr = window.location.protocol.includes('https')
    ? websocketAddr.replace('https://', 'wss://')
    : websocketAddr.replace('http://', 'ws://');
  // console.log('websocketUrl: ' + websocketAddr);

  const websocketResponse = useWebSocket(websocketAddr, {
    autoReconnect: {
      // 重连最大次数
      retries: 3,
      // 重连间隔
      delay: 1000,
      onFailed() {
        // 与 SSE 一致：会话过期属预期状态，由认证流程接管——不用 console.error 打红字。
        console.info('[WS] 重连未成功（会话可能已过期，重新登录后自动恢复）。');
      },
    },
    heartbeat: {
      message: JSON.stringify({ type: 'ping' }),
      // 发送心跳的间隔
      interval: 10_000,
      // 接收到心跳response的超时时间
      pongTimeout: 2000,
    },
    onConnected() {
      console.info('[WS] ipd_websocket 已连接');
    },
    onDisconnected() {
      console.warn('[WS] ipd_websocket 已断开');
    },
  });

  return websocketResponse;
}
