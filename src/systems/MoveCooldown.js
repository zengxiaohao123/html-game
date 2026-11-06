// src/systems/MoveCooldown.js
// 移动冷却（设计文档 §5.2）：两次移动之间至少间隔 0.5 秒。
// 统一在移动执行处做时间戳门控 —— WASD 与「前往」/载具移动共用同一条记录，
// 冷却期间按下的移动直接忽略（不排队、不累积），避免「点了没反应」后突然连走多格。
//
// 时间戳挂在 gs.uiState.lastMoveAt（随 GS 走，不污染模块全局；读档时复位）。

export const MOVE_COOLDOWN_MS = 500;

function lastMoveAt(gs) {
  const v = gs?.uiState?.lastMoveAt;
  return typeof v === 'number' ? v : 0;
}

/** 当前是否允许发起一次移动 */
export function canMoveNow(gs, now = Date.now()) {
  return now - lastMoveAt(gs) >= MOVE_COOLDOWN_MS;
}

/** 记录一次成功移动的时间戳 */
export function markMoved(gs, now = Date.now()) {
  if (!gs) return;
  if (!gs.uiState) gs.uiState = {};
  gs.uiState.lastMoveAt = now;
}

/** 剩余冷却毫秒（0 = 已就绪；供 UI / 调试使用） */
export function remainingCooldownMs(gs, now = Date.now()) {
  return Math.max(0, MOVE_COOLDOWN_MS - (now - lastMoveAt(gs)));
}

/** 新游戏 / 读档时复位，避免跨局冷却 */
export function resetMoveCooldown(gs) {
  if (gs?.uiState) gs.uiState.lastMoveAt = 0;
}

export const MoveCooldown = {
  MOVE_COOLDOWN_MS,
  canMoveNow,
  markMoved,
  remainingCooldownMs,
  resetMoveCooldown,
};
