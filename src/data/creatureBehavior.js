// src/data/creatureBehavior.js
// 生物「走走停停」行为参数表（唯一可调表；逻辑层不写死数值）
//
// 状态机（每只生物独立维护）：
//   Idle（静止）  stateLeft 倒计时归零 ──► Walk
//   Walk（行走）  到达 targetPos / 安全超时 ──► 按 chainWalkChance 决定「马上再走一段」或 Idle
//   Idle 时长按 shortPauseChance 二选一：短停（刚走完喘口气）或长站（真正站着不动）
//
// 观感目标（2026-11-07 用户裁定）：
//   生物「大部分时间在缓慢连续地走动，只是偶尔停下来」，而不是「站着为主、偶尔挪一下」。
//   允许连续多段位移后再停（chainWalkChance）；撞栅栏边必须重选出真正能产生位移的方向，
//   任何时刻都不允许长时间停在 Walk 状态却零位移（见 systems/CreatureSystem.js stepWalk）。
//
// 单位约定：
//   距离 = 格（1 格边长 = 1 米）
//   时间 = 秒（刻意不用 Ms 后缀，避免被日初基线判为墙钟字段）
//   角度 = 弧度
//
// 调参顺序建议：
//   1) walkDistMin/Max、longWalkChance —— 控制「一次走多远、走多久」
//   2) idleMinS / idleMaxS           —— 控制「停下站多久」
//   3) chainWalkChance               —— 控制「走完是否立刻接下一段（连续移动感）」
//   4) shortPauseChance              —— 控制「短停 vs 长站」比例
//   5) maxTurnRate                   —— 转向灵敏度（只影响转弯观感，不影响卡墙安全）

/** 通用默认值（物种未覆盖时使用） */
export const DEFAULT_BEHAVIOR = Object.freeze({
  idleMinS: 1.6,
  idleMaxS: 4.4,
  shortPauseChance: 0.5,
  shortPauseMinS: 0.45,
  shortPauseMaxS: 1.3,
  walkDistMin: 0.5,
  walkDistMax: 1.1,
  longWalkChance: 0.3,
  longWalkDistMin: 1.4,
  longWalkDistMax: 2.6,
  chainWalkChance: 0.35,
  walkAngleJitter: 1.0,
  maxTurnRate: 2.0,
  idleTurnChance: 0.3,
  idleTurnMaxRad: 0.6,
  arriveEps: 0.05,
  // 撞墙后的即时重决策（§2.3）：
  //   新方向必须保证沿该方向 wallFreeDistance 格内不碰任何一面栅栏，
  //   wallFreeDistance = max(wallFreeMinDist, wallFreeHorizonS / speedPerTile)。
  wallFreeHorizonS: 1.5,   // 按当前速度至少能连续走 1.5s 而不撞墙
  wallFreeMinDist: 0.5,    // 且不少于 0.5 格
  wallHitIdleChance: 0.22, // 撞墙后二选一：进 Idle 的概率（其余换成可行新方向）
  wallFailExtraIdleS: 1.5, // 采样不到可行方向时，每次连续失败额外延长的静止秒数（最多叠加 3 次）
  // 窄栏加成：合法圆心区可用跨度小于 narrowPenRefSpan 时按比例缩短 Idle（下限 minScale），
  // 保证 1×1 栅栏（跨度 0.5 格）里也「以走为主」而不是站着不动。
  narrowPenRefSpan: 1.5,
  narrowPenIdleMinScale: 0.55,
});

/** 小鸡：体型轻、最活（停得最短、走得最勤、转向最快） */
export const CHICK_BEHAVIOR = Object.freeze({
  idleMinS: 1.3,
  idleMaxS: 3.6,
  shortPauseChance: 0.5,
  shortPauseMinS: 0.4,
  shortPauseMaxS: 1.2,
  walkDistMin: 0.4,
  walkDistMax: 0.9,
  longWalkChance: 0.25,
  longWalkDistMin: 1.2,
  longWalkDistMax: 2.4,
  chainWalkChance: 0.3,
  walkAngleJitter: 1.2,
  maxTurnRate: 3.2,
  idleTurnChance: 0.45,
  idleTurnMaxRad: 0.9,
  arriveEps: 0.05,
  wallFreeHorizonS: 1.5,
  wallFreeMinDist: 0.5,
  wallHitIdleChance: 0.16,
  wallFailExtraIdleS: 1.5,
  narrowPenRefSpan: 1.5,
  narrowPenIdleMinScale: 0.55,
});

/** 成鸡：步态更沉、站得更久、转向更慢 */
export const CHICKEN_BEHAVIOR = Object.freeze({
  idleMinS: 2.4,
  idleMaxS: 6.0,
  shortPauseChance: 0.45,
  shortPauseMinS: 0.6,
  shortPauseMaxS: 1.8,
  walkDistMin: 0.5,
  walkDistMax: 1.0,
  longWalkChance: 0.28,
  longWalkDistMin: 1.5,
  longWalkDistMax: 2.8,
  chainWalkChance: 0.25,
  walkAngleJitter: 1.0,
  maxTurnRate: 2.4,
  idleTurnChance: 0.3,
  idleTurnMaxRad: 0.6,
  arriveEps: 0.05,
  wallFreeHorizonS: 1.5,
  wallFreeMinDist: 0.5,
  wallHitIdleChance: 0.22,
  wallFailExtraIdleS: 1.5,
  narrowPenRefSpan: 1.5,
  narrowPenIdleMinScale: 0.55,
});

/** 史莱姆：动得最少、走得最短、转向最迟钝 */
export const SLIME_BEHAVIOR = Object.freeze({
  idleMinS: 4.0,
  idleMaxS: 9.5,
  shortPauseChance: 0.4,
  shortPauseMinS: 0.9,
  shortPauseMaxS: 2.4,
  walkDistMin: 0.35,
  walkDistMax: 0.8,
  longWalkChance: 0.18,
  longWalkDistMin: 1.0,
  longWalkDistMax: 1.8,
  chainWalkChance: 0.18,
  walkAngleJitter: 0.6,
  maxTurnRate: 1.3,
  idleTurnChance: 0.15,
  idleTurnMaxRad: 0.35,
  arriveEps: 0.05,
  wallFreeHorizonS: 1.5,
  wallFreeMinDist: 0.5,
  wallHitIdleChance: 0.3,
  wallFailExtraIdleS: 1.5,
  narrowPenRefSpan: 1.5,
  narrowPenIdleMinScale: 0.55,
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
