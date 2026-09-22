import type { NotificationItem } from '@vben/layouts';

import { computed, ref, watch } from 'vue';

import { SvgMessageUrl } from '@vben/icons';
import { $t } from '@vben/locales';
import { useUserStore } from '@vben/stores';

import { Modal, notification } from 'ant-design-vue';
import dayjs from 'dayjs';
import { defineStore } from 'pinia';

import { useSseMessage, useWebSocketMessage } from '#/utils/message';

export const useNotifyStore = defineStore(
  'app-notify',
  () => {
    /**
     * return才会被持久化 存储全部消息
     */
    const notificationList = ref<NotificationItem[]>([]);

    const userStore = useUserStore();
    const userId = computed(() => {
      return userStore.userInfo?.userId || '0';
    });

    const notifications = computed(() => {
      return notificationList.value.filter(
        (item) => item.userId === userId.value,
      );
    });

    /**
     * 通知入列 + 弹窗（SSE / WS 两通道共用）。
     *
     * @param text  通知正文（列表 message 字段）
     * @param title 通知标题（WS JSON 载荷带 title；SSE 纯文本时缺省）
     */
    function pushNotification(text: string, title?: string) {
      notification.success({
        description: text,
        duration: 3,
        message: $t('component.notice.received'),
      });

      notificationList.value.unshift({
        // avatar: `https://api.multiavatar.com/${random(0, 10_000)}.png`, 随机头像
        avatar: SvgMessageUrl,
        date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        isRead: false,
        message: text,
        title: title || $t('component.notice.title'),
        userId: userId.value,
      });
    }

    /**
     * 开始监听消息（SSE + WS 双通道）。
     *
     * <p>通道分工（2026-09-11 C2 启用 WS 后）：</p>
     * <ul>
     *   <li>SSE（useSseMessage）：聊天/AI/工作流消息，纯文本帧</li>
     *   <li>WS（useWebSocketMessage）：IPD 业务通知（NotificationDispatcher → WEBSOCKET 通道），
     *       JSON 帧 {eventId,eventType,kind,title,content,actionUrl,sourceType,sourceId,locale,ts}</li>
     * </ul>
     * <p>两通道消息源不重叠，无需幂等去重；各自消费各自置空防 watch 不触发。</p>
     */
    // SSE/WS 连接句柄（store 单例级，跨 basic.vue 重挂载/HMR/登出登入复用同一套连接）。
    // 2026-09-22 修复 WS 抖动：原 startListeningMessage 每次调用都新建连接且无幂等 guard，
    // basic.vue 重挂载（dev HMR / 登出登入）泄漏多条同 userId 连接，后端 WebSocketSessionHolder
    // 单例按 userId 互踢（close BAD_DATA）→ 连接/断开风暴。句柄提到 store 级 + 幂等 guard 根治。
    let sseHandle: ReturnType<typeof useSseMessage> | undefined;
    let wsHandle: ReturnType<typeof useWebSocketMessage> | undefined;
    let stopSseWatch: (() => void) | undefined;
    let stopWsWatch: (() => void) | undefined;

    function isChannelLive(status?: { value: string }) {
      return status?.value === 'OPEN' || status?.value === 'CONNECTING';
    }

    function startListeningMessage() {
      // 幂等 guard：已有活动连接直接复用，杜绝重复新建导致的后端会话互踢（抖动根因）。
      if (isChannelLive(wsHandle?.status) || isChannelLive(sseHandle?.status)) {
        return;
      }
      // ---------- SSE 通道 ----------
      sseHandle = useSseMessage();
      if (sseHandle) {
        const { data: sseData } = sseHandle;
        stopSseWatch = watch(sseData, (message) => {
          if (!message) return;
          console.log(`[SSE] 接收到消息: ${message}`);

          pushNotification(String(message));

          // 需要手动置空 vue3在值相同时不会触发watch
          sseData.value = null;
        });
      }

      // ---------- WS 通道（IPD 业务通知，JSON 帧） ----------
      wsHandle = useWebSocketMessage();
      if (wsHandle) {
        const { data: wsData } = wsHandle;
        stopWsWatch = watch(wsData, (raw) => {
          if (!raw) return;
          console.log(`[WS] 接收到消息: ${raw}`);

          // 后端 WebSocketChannelHandler.serialize 发的是 JSON 文本帧；
          // 非 JSON（如心跳回包）直接忽略。
          let text = '';
          let title: string | undefined;
          try {
            const payload = JSON.parse(String(raw)) as {
              content?: string;
              title?: string;
            };
            title = payload.title || undefined;
            text = [payload.title, payload.content]
              .filter(Boolean)
              .join('：');
          } catch {
            // 非 JSON 帧：不弹窗（心跳等传输层帧不属于业务通知）
            wsData.value = null;
            return;
          }
          if (!text) {
            wsData.value = null;
            return;
          }

          pushNotification(text, title);

          wsData.value = null;
        });
      }
    }

    /**
     * 停止监听并关闭 SSE/WS 连接（登出时调用）。
     * 清空句柄，使下次 startListeningMessage 能为（可能不同的）用户重建连接，
     * 避免登出后连接泄漏 / 换用户误复用旧连接。
     */
    function stopListeningMessage() {
      stopSseWatch?.();
      stopWsWatch?.();
      stopSseWatch = undefined;
      stopWsWatch = undefined;
      sseHandle?.close();
      wsHandle?.close();
      sseHandle = undefined;
      wsHandle = undefined;
    }

    /**
     * 设置全部已读
     */
    function setAllRead() {
      notificationList.value
        .filter((item) => item.userId === userId.value)
        .forEach((item) => {
          item.isRead = true;
        });
    }

    /**
     * 设置单条消息已读
     * @param item 通知
     */
    function setRead(item: NotificationItem) {
      !item.isRead && (item.isRead = true);
      // 显示信息
      Modal.info({
        title: item.title,
        content: item.message,
      });
    }

    /**
     * 清空全部消息
     */
    function clearAllMessage() {
      notificationList.value = notificationList.value.filter(
        (item) => item.userId !== userId.value,
      );
    }

    /**
     * 只需要空实现即可
     * 否则会在退出登录清空所有
     */
    function $reset() {
      // notificationList.value = [];
    }
    /**
     * 显示小圆点
     */
    const showDot = computed(() =>
      notificationList.value
        .filter((item) => item.userId === userId.value)
        .some((item) => !item.isRead),
    );

    return {
      $reset,
      clearAllMessage,
      notificationList,
      notifications,
      setAllRead,
      setRead,
      showDot,
      startListeningMessage,
      stopListeningMessage,
    };
  },
  {
    persist: {
      pick: ['notificationList'],
    },
  },
);
