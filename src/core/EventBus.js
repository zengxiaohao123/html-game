// src/core/EventBus.js
// 全局事件总线：发布/订阅基础设施
// 所有 EventBus 事件名必须在 src/core/GameEvents.js 集中定义，禁止字符串字面量。

const handlers = new Map(); // event → handler[]

export const EventBus = {
  /**
   * 订阅事件
   * @param {string} event 事件名（必须是 GE.xxx 常量）
   * @param {Function} handler 回调函数 (payload) => void
   */
  on(event, handler) {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(handler);
  },

  /**
   * 取消订阅
   * @param {string} event 事件名
   * @param {Function} handler 之前注册的同一个 handler 引用
   */
  off(event, handler) {
    const list = handlers.get(event);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) handlers.delete(event);
  },

  /**
   * 发布事件，依次调用所有 handler
   * @param {string} event 事件名
   * @param {*} [payload] 事件数据
   */
  emit(event, payload) {
    const list = handlers.get(event);
    if (!list) return;
    // 复制一份数组后遍历，避免 handler 内部 off 造成跳过
    const snapshot = list.slice();
    for (const h of snapshot) {
      try {
        h(payload);
      } catch (e) {
        console.error(`[EventBus] handler for "${event}" threw:`, e);
      }
    }
  },

  /**
   * 一次订阅：触发一次后自动 off
   * @param {string} event 事件名
   * @param {Function} handler 回调函数
   */
  once(event, handler) {
    const wrapper = (payload) => {
      handler(payload);
      EventBus.off(event, wrapper);
    };
    EventBus.on(event, wrapper);
  },
};
