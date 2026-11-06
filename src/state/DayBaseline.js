// src/state/DayBaseline.js
// 日初基线存档（《空间碰撞与时序方案》§11 / 设计文档 v0.5 §19）
//
// 口径：自动存档与手动存档都记录「本日开始时」的逻辑状态；读档 = 回到本日开始时。
// 因此基线只在日初采集一次（SleepSystem.sleep 末尾换日全部结算完成后 / 新开局末尾），
// 日内任何操作都不重新采集 —— 手动存档写的也是这份冻结副本。
//
// 入档：日历/天数、玩家数值、地图与地块、生物名册（含日初 pos/dir）、背包、编队、
//       容量、buff、载具、剩余回合冷却、rng.masterSeed。
// 不入档：任何墙钟（*Ms / *At）、连携队列与计数、演出/界面态、建造态、睡眠结算中间量。

import { devLog } from '../core/Logger.js';

/** 存档格式版本号（迁移识别用） */
export const SAVE_SCHEMA_VERSION = 2;
/** 存档模式标记：日初基线 */
export const SAVE_MODE_DAY_START = 'dayStart';

/** 墙钟字段识别：键名以 Ms / At 结尾 */
const WALL_CLOCK_KEY_RE = /(?:Ms|At)$/;

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 日初的界面态（不含演出标记与墙钟；读档后默认主界面） */
function dayStartUiState() {
  return {
    selectedTileIdx: null,
    infoTab: 'content',
    activePanel: null,
  };
}

/**
 * 递归收集键名匹配 Ms$ / At$ 的字段路径
 * @param {*} value
 * @param {string} [path]
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function findWallClockKeys(value, path = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findWallClockKeys(v, `${path}[${i}]`, out));
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (WALL_CLOCK_KEY_RE.test(key)) out.push(childPath);
      findWallClockKeys(value[key], childPath, out);
    }
  }
  return out;
}

/**
 * 断言：对象中不含任何墙钟字段（开发期不变量）
 * @param {*} value
 * @returns {true}
 */
export function assertNoWallClock(value) {
  const hits = findWallClockKeys(value);
  if (hits.length > 0) {
    throw new Error(`[DayBaseline] 基线含墙钟字段: ${hits.join(', ')}`);
  }
  return true;
}

/**
 * 采集日初基线：把 live GS 剥离成可入档的日初事实（深拷贝，不改入参）
 * @param {object} gs 全局状态
 * @returns {object} 基线副本
 */
export function capture(gs) {
  const base = deepClone(gs);

  // 时间：新档回合号恒为 0（日初逻辑静默点）
  base.turn = 0;

  // 墙钟：生物下次移动时间戳
  for (const c of base.creatures || []) {
    if (isPlainObject(c)) delete c.lastMoveTs;
  }

  // 连携窗口与日内累计（日初由 LinkSkillSystem.resetAll 归零）
  base.linkSkillQueue = [];
  base.linkSkillCounters = {};
  base.lastTurnLinkSkill = 0;

  // 演出 / 交互 / 结算中间量
  base.uiState = dayStartUiState();
  base.buildMode = false;
  base.pendingSleepStaminaBonus = 0;
  base.blessingQueue = [];
  delete base.blessLockUntilMs;

  // 随机：只存主种子，不存日内已抽过的进度
  base.rng = { masterSeed: gs?.rng?.masterSeed };

  assertNoWallClock(base);
  return base;
}

/**
 * 把基线装回运行时（读档）：清演出/窗口/墙钟，按逻辑状态静态重建
 * @param {object} baseline 基线副本
 * @param {number} [nowMs] 逻辑时钟起算点（默认 Date.now）
 * @returns {object} 可运行的 GS（基线深拷贝）
 */
export function install(baseline, nowMs = Date.now()) {
  const gs = deepClone(baseline);

  gs.turn = 0;
  gs.linkSkillQueue = [];
  gs.linkSkillCounters = {};
  gs.lastTurnLinkSkill = 0;
  gs.uiState = dayStartUiState();
  gs.uiState.lastMoveAt = 0; // 运行时墙钟从 0 起算（仅内存，不入档）
  gs.buildMode = false;
  gs.pendingSleepStaminaBonus = 0;
  gs.blessingQueue = [];
  delete gs.blessLockUntilMs;

  // 生物：按基线 pos/dir 重建，lastMoveTs 仅做错峰（不入档）
  (gs.creatures || []).forEach((c, i) => {
    if (!isPlainObject(c)) return;
    c.lastMoveTs = nowMs + (i * 37) % 250;
    if (isPlainObject(c.pos)) c.renderPos = { x: c.pos.x, y: c.pos.y };
    delete c.targetPos;
  });

  devLog.info('[DayBaseline] 已装回日初基线 day=', gs.day, 'turn=', gs.turn);
  return gs;
}

/**
 * 幂等断言：基线再采集一次必须逐字节一致（除时间戳外的内容不变量）
 * @param {object} baseline
 * @returns {true}
 */
export function assertIdempotent(baseline) {
  const once = JSON.stringify(baseline);
  const twice = JSON.stringify(capture(deepClone(baseline)));
  if (once !== twice) {
    throw new Error('[DayBaseline] 幂等不变量失败：capture(load(baseline)) 与原基线不一致');
  }
  return true;
}

// ── 当前基线（进程内冻结副本；SettingsPanel / GameDirector 都读它） ──
let current = null;

/** 设置当前日初基线（深拷贝保存，避免外部引用污染） */
export function setCurrent(baseline) {
  current = baseline ? deepClone(baseline) : null;
  return current;
}

/** 取当前日初基线副本；未开局返回 null */
export function getCurrent() {
  return current ? deepClone(current) : null;
}

/** 清空当前基线（新开局 / 调试用） */
export function clearCurrent() {
  current = null;
}

export const DayBaseline = {
  SAVE_SCHEMA_VERSION,
  SAVE_MODE_DAY_START,
  capture,
  install,
  findWallClockKeys,
  assertNoWallClock,
  assertIdempotent,
  setCurrent,
  getCurrent,
  clearCurrent,
};

export default DayBaseline;
