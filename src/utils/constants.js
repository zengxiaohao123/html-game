// src/utils/constants.js
// 全局常量集中管理（游戏平衡性参数、存档槽位等）
// 新增常量请同步更新 architecture-spec.md / task-briefs.md 中相关部分。

// ── 玩家数值 ──
export const MAX_STAMINA = 8;
export const MIN_STAMINA = -3;
export const MAX_HP_DEFAULT = 100;
export const ATK_DEFAULT = 10;

// ── 地图初始值 ──
export const MAP_SIZE_INITIAL = 3;
export const FENCE_ROW_COLS_INITIAL = 1;

// ── 容量初始值 ──
export const CAPACITY_FRIENDLY_INITIAL = 4;
export const CAPACITY_DANGER_INITIAL = 4;
export const CAPACITY_EXTREME_INITIAL = 0;

// ── 存档 ──
export const SLOTS_MAX = 8;
export const AUTOSAVE_SLOT = 1;              // 1 号位为自动存档
export const STORAGE_PREFIX = 'wheelfarm_';  // localStorage key 前缀

// ── 时间 / 回合 ──
export const SLEEP_STAMINA_PENALTY_GOLD_RATIO = 0.1; // 强制睡觉时金币 10% 惩罚

// ── UI ──
export const HOTBAR_SLOTS = 10;
export const OUTBOX_SLOTS = 12;
export const TEAM_GROUPS = 4;
