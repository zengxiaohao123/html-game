/**
 * core/EventBus.js —— 全局事件总线（发布订阅）
 *
 * 系统之间通过事件解耦：战斗结算、探索、UI、日志、存档监听同一套事件。
 * 所有事件名集中在 core/GameEvents.js 定义，避免魔法字符串散落。
 */

const listeners = new Map();

export const EventBus = {
  /**
   * 订阅事件
   * @param {string} event
   * @param {(payload:any)=>void} handler
   * @returns {()=>void} 取消订阅函数
   */
  on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => EventBus.off(event, handler);
  },

  once(event, handler) {
    const unsub = EventBus.on(event, (payload) => {
      unsub();
      handler(payload);
    });
    return unsub;
  },

  off(event, handler) {
    listeners.get(event)?.delete(handler);
  },

  /**
   * 同步派发；处理器抛错不应中断主流程，统一捕获并记录。
   */
  emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (err) {
        // 延迟引用避免循环依赖
        // eslint-disable-next-line no-console
        console.error(`[EventBus] 事件处理器异常 event=${event}`, err);
      }
    }
  },

  /** 仅供测试/重开存档时清空全部监听 */
  _reset() {
    listeners.clear();
  },
};
