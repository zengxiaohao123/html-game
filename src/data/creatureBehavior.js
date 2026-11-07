// src/data/creatureBehavior.js
// 生物「走走停停」行为参数表（唯一可调表；逻辑层不写死数值）
//
// 状态机（每只生物独立维护）：
//   Idle（静止）  stateLeft 倒计时归零 ──► Walk
//   Walk（行走）  到达 targetPos / 撞栅栏边 / 安全超时 ──► Idle
//   Idle 时长按 shortPauseChance 二选一：短停（刚走完喘口气）或长站（真正站着不动）
//
// 参考：星露谷放出鸡舍的鸡 —— 白天在舍附近小范围活动，多数时间站着/啄食，
//       偶尔短距离走一两步再停；本作没有昼夜与天气对生物的影响，故只取「停下是常态」这一观感。
//
// 单位约定：
//   距离 = 格（1 格边长 = 1 米）
//   时间 = 秒（刻意不用 Ms 后缀，避免被日初基线判为墙钟字段）
//   角度 = 弧度
//
// 调参顺序建议：
//   1) idleMinS / idleMaxS  —— 控制「停多久」，越大越懒
//   2) walkDistMin/Max      —— 控制「一次走多远」
//   3) shortPauseChance     —— 控制走完是否只停一下又继续（越大越「碎步」）
//   4) longWalkChance       —— 控制「偶尔朝随机方向走一段」的频率

/** 通用默认值（物种未覆盖时使用） */
export const DEFAULT_BEHAVIOR = Object.freeze({
  idleMinS: 5,
  idleMaxS: 12,
  shortPauseChance: 0.4,
  shortPauseMinS: 0.4,
  shortPauseMaxS: 1.2,
  walkDistMin: 0.25,
  walkDistMax: 0.8,
  longWalkChance: 0.12,
  longWalkDistMin: 1.2,
  longWalkDistMax: 2.2,
  walkAngleJitter: 1.0,
  maxTurnRate: 2.0,
  idleTurnChance: 0.3,
  idleTurnMaxRad: 0.6,
  arriveEps: 0.05,
});

/** 小鸡：体型轻、最活（停得短、走得勤、转向快） */
export const CHICK_BEHAVIOR = Object.freeze({
  idleMinS: 4,
  idleMaxS: 9,
  shortPauseChance: 0.5,
  shortPauseMinS: 0.35,
  shortPauseMaxS: 1.0,
  walkDistMin: 0.2,
  walkDistMax: 0.6,
  longWalkChance: 0.18,
  longWalkDistMin: 1.2,
  longWalkDistMax: 2.2,
  walkAngleJitter: 1.2,
  maxTurnRate: 3.0,
  idleTurnChance: 0.45,
  idleTurnMaxRad: 0.9,
  arriveEps: 0.05,
});

/** 成鸡：步态更沉、站得更久、转向更慢 */
export const CHICKEN_BEHAVIOR = Object.freeze({
  idleMinS: 7,
  idleMaxS: 16,
  shortPauseChance: 0.4,
  shortPauseMinS: 0.5,
  shortPauseMaxS: 1.5,
  walkDistMin: 0.25,
  walkDistMax: 0.8,
  longWalkChance: 0.12,
  longWalkDistMin: 1.5,
  longWalkDistMax: 2.8,
  walkAngleJitter: 1.0,
  maxTurnRate: 2.0,
  idleTurnChance: 0.3,
  idleTurnMaxRad: 0.6,
  arriveEps: 0.05,
});

/** 史莱姆：动得最少、走得最短、转向最迟钝 */
export const SLIME_BEHAVIOR = Object.freeze({
  idleMinS: 9,
  idleMaxS: 22,
  shortPauseChance: 0.22,
  shortPauseMinS: 0.6,
  shortPauseMaxS: 1.8,
  walkDistMin: 0.15,
  walkDistMax: 0.45,
  longWalkChance: 0.05,
  longWalkDistMin: 1.0,
  longWalkDistMax: 1.6,
  walkAngleJitter: 0.6,
  maxTurnRate: 1.1,
  idleTurnChance: 0.15,
  idleTurnMaxRad: 0.35,
  arriveEps: 0.05,
});

/**
 * 物种 → 行为预设。
 * 新增生物时只在这里挂一行即可；未登记的 kind 落到 default。
 */
export const BEHAVIOR_PROFILES = Object.freeze({
  chick: CHICK_BEHAVIOR,
  chicken: CHICKEN_BEHAVIOR,
  slime_fire: SLIME_BEHAVIOR,
  slime_water: SLIME_BEHAVIOR,
  slime_thunder: SLIME_BEHAVIOR,
  slime_ice: SLIME_BEHAVIOR,
  slime_grass: SLIME_BEHAVIOR,
  slime_wind: SLIME_BEHAVIOR,
  slime_rock: SLIME_BEHAVIOR,
  default: DEFAULT_BEHAVIOR,
});

/**
 * 取物种行为预设（返回冻结对象，不要原地改；调参请改上面的表）。
 * @param {string} kind
 * @returns {typeof DEFAULT_BEHAVIOR}
 */
export function getBehaviorProfile(kind) {
  return BEHAVIOR_PROFILES[kind] || DEFAULT_BEHAVIOR;
}

/**
 * 解析某只生物实际使用的行为参数：
 * 物种预设 + 实例级 `behaviorOverride`（测试 / 特殊个体手调）。
 * @param {object} creature
 */
export function resolveBehavior(creature) {
  const base = getBehaviorProfile(creature?.kind);
  const override = creature?.behaviorOverride;
  return override ? { ...base, ...override } : base;
}

export default getBehaviorProfile;
