// src/core/Logger.js
// 极简开发日志工具：统一控制台输出，可一键开关。
// 生产构建前可设 devLog.enabled = false 关闭所有输出。

export const devLog = {
  /** 总开关：false 时所有调用静默 */
  enabled: true,

  info(...args) {
    if (!devLog.enabled) return;
    // eslint-disable-next-line no-console
    console.log('[转盘农场]', ...args);
  },
  warn(...args) {
    if (!devLog.enabled) return;
    // eslint-disable-next-line no-console
    console.warn('[转盘农场 ⚠️]', ...args);
  },
  error(...args) {
    if (!devLog.enabled) return;
    // eslint-disable-next-line no-console
    console.error('[转盘农场 ❌]', ...args);
  },
};
