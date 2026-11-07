// tools/smoke-behavior.mjs —— 生物「走走停停」行为 + 撞墙安全冒烟
// 用法：node tools/smoke-behavior.mjs
//
// 验收口径（用户 2026-11-07 裁定）：
//   1) 以走为主、偶尔停下：60s 平均静止占比 小鸡 30~40% / 成鸡 40~50% / 史莱姆 50~60%
//      （单次 Idle 明显缩短、单次 Walk 变长，允许连续多段位移后再停）
//   2) 撞墙后**同一逻辑步内**立即重决策：Idle 或 换成「wallFreeThreshold 格内不碰任何栅栏」的方向
//   3) 任何时刻不存在「Walk 状态却连续零位移」；无可行方向 → Idle（带额外静止）
//   4) 1×1 栅栏（合法圆心区仅 0.5×0.5）60s 内仍有足够次数的位移，不卡死
//   5) 撞墙那一刻圆心不出栅栏；边界裁剪与重叠仍成立
//   6) 静止的生物不写 DOM
//   7) 全量冒烟 0 失败由 npm/全部脚本统一验证（本文件自身 0 失败）

// ── 最小 DOM 桩（必须在 import src 模块前装好） ──
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = Object.create(null);
    this._text = '';
    this.className = '';
  }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  addEventListener() {}
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = String(v ?? ''); this.children = []; }
  get innerHTML() { return ''; }
  set innerHTML(v) { if (String(v) === '') this.children = []; this._text = ''; }
}

/** 统计 style 写入次数的元素（只用于「静止不写 DOM」断言） */
class CountingEl extends FakeEl {
  constructor(tag = 'div') {
    super(tag);
    const counts = Object.create(null);
    this._counts = counts;
    this.style = new Proxy(Object.create(null), {
      set(target, key, value) {
        counts[key] = (counts[key] || 0) + 1;
        target[key] = value;
        return true;
      },
      get(target, key) { return target[key]; },
    });
  }
}

globalThis.document = {
  createElement: (t) => new CountingEl(t),
  body: new FakeEl('body'),
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
};
globalThis.window = globalThis.window || {};
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

import fs from 'node:fs';
import { createInitialState } from '../src/state/gameState.js';
import { CREATURES } from '../src/data/creatures.js';
import {
  BEHAVIOR_PROFILES,
  DEFAULT_BEHAVIOR,
  getBehaviorProfile,
} from '../src/data/creatureBehavior.js';
import { CreatureSystem, wallFreeDistanceOf } from '../src/systems/CreatureSystem.js';
import { RealtimeClock } from '../src/systems/RealtimeClock.js';
import { CreatureView } from '../src/ui/CreatureView.js';
import * as G from '../src/core/Geometry.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let pass = 0, fail = 0;
function check(cond, msg, extra) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else {
    fail++;
    console.log(`  ❌ ${msg}${extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`);
  }
}
function head(t) { console.log(`\n═══ ${t} ═══`); }

/** 构造 size×size 外圈地图（栅栏内 = (size-2)²，原点恒 (1,1)） */
function mkMap(size) {
  const gs = createInitialState();
  const ring = size - 1;
  const outerTiles = [];
  for (let idx = 0; idx < 4 * ring; idx++) {
    outerTiles.push({ idx, terrain: 'terrain_none', terrainAmount: 0, contentId: null, states: [], dailyFlags: {} });
  }
  const fenceRowCols = size - 2;
  const fence = [];
  for (let r = 0; r < fenceRowCols; r++) {
    for (let c = 0; c < fenceRowCols; c++) {
      fence.push({ row: r, col: c, terrain: 'terrain_none', terrainAmount: 0, creatures: [], items: [] });
    }
  }
  gs.map.size = size;
  gs.map.outerTiles = outerTiles;
  gs.map.fence = fence;
  gs.map.fenceRowCols = fenceRowCols;
  gs.player.x = 0;
  gs.creatures = [];
  return gs;
}

/** 手工放一只生物（行为字段可控；不经过 spawn 的随机落点） */
function addCreature(gs, {
  id = 'c1', kind = 'chick', pos = { x: 2.5, y: 2.5 }, dir = 0,
  state = 'idle', stateLeft = 0, override = null,
} = {}) {
  const def = CREATURES[kind];
  const c = {
    id, kind, stage: 'adult', hp: 100, maxHp: 100, atk: 0, category: def.category,
    row: Math.floor(pos.y - G.FENCE_ORIGIN_Y), col: Math.floor(pos.x - G.FENCE_ORIGIN_X),
    pos: { ...pos }, renderPos: { ...pos },
    radius: def.radius, dir, speedPerTile: def.speedPerTile,
    behaviorState: state, stateLeft, targetPos: null, idleTurnLeft: 0,
    growth: 0, growthMax: 0,
  };
  if (override) c.behaviorOverride = override;
  gs.creatures.push(c);
  return c;
}

/** 确定性 LCG（只替换 Math.random，行为逻辑本身不感知） */
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 合法圆心区（圆心 + 半径不出栅栏） */
function innerRectOf(gs, creature) {
  const f = G.fenceRect(gs);
  const r = G.creatureRadius(creature);
  return { x0: f.x0 + r, x1: f.x1 - r, y0: f.y0 + r, y1: f.y1 - r };
}

/** 沿 angle 方向在合法矩形内可走的距离（射线到边界） */
function roomAlong(x, y, angle, inner) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (inner.x1 - x) / dx);
  else if (dx < -1e-9) t = Math.min(t, (inner.x0 - x) / dx);
  if (dy > 1e-9) t = Math.min(t, (inner.y1 - y) / dy);
  else if (dy < -1e-9) t = Math.min(t, (inner.y0 - y) / dy);
  if (!Number.isFinite(t)) t = 0;
  return Math.max(0, t);
}

/**
 * 跑一段逻辑时间，逐步采样位移、状态与撞墙决策。
 * @returns {{gs, c, samples, idleRatio, longestIdleSteps, transitions, walkRuns, wall}}
 */
function simulate(kind, seconds, seed, override = null, opts = {}) {
  const { size = 5, startPos = null, dir = 0 } = opts;
  const gs = mkMap(size);
  const pos = startPos || {
    x: 1 + (size - 2) / 2,
    y: 1 + (size - 2) / 2,
  };
  const c = addCreature(gs, { kind, state: 'idle', stateLeft: 0, pos, dir, override });
  const inner = innerRectOf(gs, c);
  const profile = override ? { ...getBehaviorProfile(kind), ...override } : getBehaviorProfile(kind);
  const threshold = wallFreeDistanceOf(profile, c.speedPerTile);
  const stepLen = 0.2 / c.speedPerTile;

  const origRandom = Math.random;
  Math.random = makeRng(seed);
  const samples = [];
  const wall = { hits: 0, badDecision: 0, badRoom: 0, outOfBounds: 0, walkZeroSteps: 0, maxWalkZeroRun: 0, idleDecisions: 0, walkDecisions: 0 };
  let walkZeroRun = 0;
  try {
    const steps = Math.round(seconds / 0.2);
    for (let i = 0; i < steps; i++) {
      const beforeX = c.pos.x;
      const beforeY = c.pos.y;
      const wasWalk = c.behaviorState === 'walk';
      const hitsBefore = c.wallHits || 0;
      CreatureSystem.stepCreatures(gs, 0.2);
      const moved = Math.hypot(c.pos.x - beforeX, c.pos.y - beforeY) > 1e-12;

      // ── Walk 状态零位移检测 ──
      // 只统计「本步零位移且仍是 Walk」的真卡住样本；
      // 撞墙当步被判定为 Idle 的零位移是合法停机（状态已在同一步切换，不属于卡在 Walk）。
      if (wasWalk && !moved && c.behaviorState === 'walk') {
        wall.walkZeroSteps++;
        walkZeroRun++;
        wall.maxWalkZeroRun = Math.max(wall.maxWalkZeroRun, walkZeroRun);
      } else {
        walkZeroRun = 0;
      }

      // ── 圆心必须在合法区内（撞墙也不许穿出） ──
      if (!(c.pos.x >= inner.x0 - 1e-9 && c.pos.x <= inner.x1 + 1e-9 &&
            c.pos.y >= inner.y0 - 1e-9 && c.pos.y <= inner.y1 + 1e-9)) {
        wall.outOfBounds++;
      }

      // ── 撞墙后的同一逻辑步重决策校验 ──
      if ((c.wallHits || 0) > hitsBefore) {
        wall.hits++;
        if (c.lastWallDecision === 'idle') {
          wall.idleDecisions++;
          if (c.behaviorState !== 'idle' || c.targetPos !== null) wall.badDecision++;
        } else if (c.lastWallDecision === 'walk') {
          wall.walkDecisions++;
          if (c.behaviorState !== 'walk' || !c.targetPos) wall.badDecision++;
          // 决策点在撞墙后的边界；本步已沿新方向走了 stepLen
          const room = roomAlong(c.pos.x, c.pos.y, c.dir, inner) + stepLen;
          if (room < threshold - 1e-6) wall.badRoom++;
        } else {
          wall.badDecision++;
        }
      }

      samples.push({
        t: (i + 1) * 0.2,
        x: c.pos.x,
        y: c.pos.y,
        state: c.behaviorState,
        moved,
      });
    }
  } finally {
    Math.random = origRandom;
  }

  const idleSteps = samples.filter(s => !s.moved).length;
  let transitions = 0;
  let longestIdleSteps = 0;
  let runIdle = 0;
  const walkRuns = [];
  let runStartPos = null;
  let lastMovingPos = null;
  for (let i = 0; i < samples.length; i++) {
    const m = samples[i].moved;
    if (i > 0 && m !== samples[i - 1].moved) transitions++;
    if (!m) { runIdle++; if (runIdle > longestIdleSteps) longestIdleSteps = runIdle; }
    else runIdle = 0;

    if (m) {
      if (!runStartPos) runStartPos = { x: samples[i - 1]?.x ?? samples[i].x, y: samples[i - 1]?.y ?? samples[i].y };
      lastMovingPos = { x: samples[i].x, y: samples[i].y };
    } else if (runStartPos) {
      walkRuns.push(Math.hypot(lastMovingPos.x - runStartPos.x, lastMovingPos.y - runStartPos.y));
      runStartPos = null;
      lastMovingPos = null;
    }
  }
  if (runStartPos) {
    walkRuns.push(Math.hypot(lastMovingPos.x - runStartPos.x, lastMovingPos.y - runStartPos.y));
  }

  return {
    gs, c, samples,
    idleRatio: idleSteps / samples.length,
    transitions,
    longestIdleSteps,
    walkRuns,
    wall,
    threshold,
  };
}

// ════════════════════════════════════════════════════════════
head('1. 参数表结构：每个物种都有完整预设，且表是唯一数值来源');
{
  const required = Object.keys(DEFAULT_BEHAVIOR);
  check(required.length >= 17, '行为参数表字段齐全（>=17 项，含撞墙重决策参数）', required.length);
  for (const kind of Object.keys(CREATURES)) {
    const p = getBehaviorProfile(kind);
    const missing = required.filter(k => typeof p[k] !== 'number' || !Number.isFinite(p[k]));
    check(missing.length === 0, `${kind}: 预设参数完整且为有限数值`, missing);
    check(p.idleMinS < p.idleMaxS && p.shortPauseMinS < p.shortPauseMaxS &&
          p.walkDistMin < p.walkDistMax && p.longWalkDistMin < p.longWalkDistMax,
      `${kind}: 各时长/距离区间下界 < 上界`, p);
    check(p.wallFreeMinDist >= 0.5 && p.wallFreeHorizonS > 0 && p.wallHitIdleChance > 0 &&
          p.chainWalkChance > 0,
      `${kind}: 撞墙阈值/Idle 概率/连续行走概率均已配置`, {
        wallFreeMinDist: p.wallFreeMinDist,
        wallFreeHorizonS: p.wallFreeHorizonS,
        wallHitIdleChance: p.wallHitIdleChance,
        chainWalkChance: p.chainWalkChance,
      });
  }
  check(BEHAVIOR_PROFILES.chick.idleMaxS < BEHAVIOR_PROFILES.chicken.idleMaxS &&
        BEHAVIOR_PROFILES.chicken.idleMaxS < BEHAVIOR_PROFILES.slime_fire.idleMaxS,
    '长站上限：小鸡 < 成鸡 < 史莱姆（物种差异）',
    [BEHAVIOR_PROFILES.chick.idleMaxS, BEHAVIOR_PROFILES.chicken.idleMaxS, BEHAVIOR_PROFILES.slime_fire.idleMaxS]);
  check(BEHAVIOR_PROFILES.chick.idleMaxS < 4.0 && BEHAVIOR_PROFILES.chicken.idleMaxS < 7.0 &&
        BEHAVIOR_PROFILES.slime_fire.idleMaxS <= 10.0,
    '单次长站已明显缩短（小鸡 <4s / 成鸡 <7s / 史莱姆 <=10s）');
  check(BEHAVIOR_PROFILES.chick.maxTurnRate > BEHAVIOR_PROFILES.chicken.maxTurnRate &&
        BEHAVIOR_PROFILES.chicken.maxTurnRate > BEHAVIOR_PROFILES.slime_fire.maxTurnRate,
    '转向灵敏度：小鸡 > 成鸡 > 史莱姆');

  const cs = fs.readFileSync(`${ROOT}/src/systems/CreatureSystem.js`, 'utf8');
  check(cs.includes("from '../data/creatureBehavior.js'"), '逻辑层从行为参数表读取（不写死数值）');
  check(!cs.includes('PAUSE_CHANCE_ON_ARRIVE') && !cs.includes('RETARGET_MIN_S'),
    '已删除阶段 2 的写死停顿/重取常量');
  check(cs.includes('wallFreeDistanceOf') && cs.includes('decideAfterWallHit'),
    '撞墙重决策（阈值函数 + 即时决策）已在逻辑层实现');
}

// ════════════════════════════════════════════════════════════
head('2. 生成即进入 Idle（错峰），旧字段不再出现');
{
  const gs = mkMap(5);
  const c = CreatureSystem.spawnCreature(gs, 'chick');
  const p = getBehaviorProfile('chick');
  check(c.behaviorState === 'idle', '新生成生物处于 Idle（先站后走）', c.behaviorState);
  check(Number.isFinite(c.stateLeft) && c.stateLeft >= 0 && c.stateLeft <= p.idleMaxS,
    'Idle 初始时长在 [0, idleMaxS] 内错峰', c.stateLeft);
  check(c.targetPos === null, 'Idle 时没有行走目标');
  check(!('pauseLeft' in c) && !('retargetLeft' in c), '不再写阶段 2 的 pauseLeft/retargetLeft');
}

// ════════════════════════════════════════════════════════════
head('3. 连续时间完全静止：25 个逻辑步（5s）位置逐字节不变');
{
  const gs = mkMap(5);
  const c = addCreature(gs, { kind: 'chicken', state: 'idle', stateLeft: 6, pos: { x: 2.2, y: 2.4 } });
  const clock = new RealtimeClock(() => gs);
  const x0 = c.pos.x;
  const y0 = c.pos.y;
  const r0x = c.renderPos.x;
  const r0y = c.renderPos.y;
  let allSame = true;
  for (let i = 0; i < 25; i++) {
    clock.advance(200); // 逻辑步 + 渲染帧都用真实路径
    if (c.pos.x !== x0 || c.pos.y !== y0 || c.renderPos.x !== r0x || c.renderPos.y !== r0y) {
      allSame = false;
      break;
    }
  }
  check(allSame, '5s 内 pos 与 renderPos 完全不变（真正的静止，不是慢速漂移）',
    { pos: c.pos, render: c.renderPos });
  check(c.behaviorState === 'idle', '这段时间仍处于 Idle', c.behaviorState);
}

// ════════════════════════════════════════════════════════════
head('4. 以走为主：60s 平均静止占比落在目标区间（每物种 10 个随机种子）');
{
  const targets = {
    chick: { range: [0.30, 0.40], tol: 0.05 },
    chicken: { range: [0.40, 0.50], tol: 0.05 },
    slime_grass: { range: [0.50, 0.60], tol: 0.05 },
  };
  const avg = {};
  for (const [kind, t] of Object.entries(targets)) {
    let sum = 0;
    let zero = 0;
    let bad = 0;
    for (let i = 0; i < 10; i++) {
      const r = simulate(kind, 60, 1000 + i * 7919);
      sum += r.idleRatio;
      zero += r.wall.walkZeroSteps;
      bad += r.wall.badDecision + r.wall.badRoom + r.wall.outOfBounds;
    }
    avg[kind] = sum / 10;
    console.log(`  · ${kind}: 10 次 60s 平均静止 ${(avg[kind] * 100).toFixed(1)}%（目标 ${t.range[0] * 100}~${t.range[1] * 100}%）`);
    check(avg[kind] >= t.range[0] - t.tol && avg[kind] <= t.range[1] + t.tol,
      `${kind}: 60s 平均静止占比落在 ${(t.range[0] * 100)}~${(t.range[1] * 100)}% ±5pp（以走为主、偶尔停）`,
      avg[kind]);
    check(zero === 0, `${kind}: 60s 内不存在「Walk 状态零位移」样本`, zero);
    check(bad === 0, `${kind}: 撞墙重决策/阈值/边界均无异常`, bad);
  }
  check(avg.slime_grass > avg.chicken && avg.chicken > avg.chick,
    '静止占比：史莱姆 > 成鸡 > 小鸡（物种差异保留）', avg);
}

// ════════════════════════════════════════════════════════════
head('5. 600s 长采样：静止占比上限 / 最长连续静止上限 / 卡墙零位移');
{
  for (const [kind, seed, bounds] of [
    ['chick', 12345, { maxIdleRatio: 0.45, maxIdleS: 5.0 }],
    ['chicken', 23456, { maxIdleRatio: 0.55, maxIdleS: 8.0 }],
    ['slime_grass', 34567, { maxIdleRatio: 0.65, maxIdleS: 11.0 }],
  ]) {
    const r = simulate(kind, 600, seed);
    console.log(`  · ${kind}: 静止 ${(r.idleRatio * 100).toFixed(1)}%，最长连续静止 ${(r.longestIdleSteps * 0.2).toFixed(1)}s，` +
      `撞墙 ${r.wall.hits} 次（idle ${r.wall.idleDecisions} / walk ${r.wall.walkDecisions}），行走段 ${r.walkRuns.length} 次`);
    check(r.idleRatio <= bounds.maxIdleRatio, `${kind}: 600s 静止占比 <= ${(bounds.maxIdleRatio * 100)}%`, r.idleRatio);
    check(r.longestIdleSteps * 0.2 <= bounds.maxIdleS,
      `${kind}: 最长连续静止 <= ${bounds.maxIdleS}s（无卡墙式长静止）`, r.longestIdleSteps * 0.2);
    check(r.wall.walkZeroSteps === 0, `${kind}: 600s 内 Walk 状态零位移步 = 0`, r.wall.walkZeroSteps);
    check(r.wall.maxWalkZeroRun === 0, `${kind}: 最长「Walk 零位移」连续步数 = 0`, r.wall.maxWalkZeroRun);
    check(r.walkRuns.length >= 20, `${kind}: 行走段 >= 20 次（不是站着为主）`, r.walkRuns.length);
  }
}

// ════════════════════════════════════════════════════════════
head('6. 参数变化能改变静止占比（同种子、只改 idle 参数）');
{
  const lazy = { idleMinS: 20, idleMaxS: 24, shortPauseChance: 0, longWalkChance: 0 };
  const active = { idleMinS: 1, idleMaxS: 2, shortPauseChance: 0, longWalkChance: 0 };
  const a = simulate('chick', 300, 98765, lazy);
  const b = simulate('chick', 300, 98765, active);
  console.log(`  · 懒参数静止占比 ${(a.idleRatio * 100).toFixed(1)}% vs 勤快参数 ${(b.idleRatio * 100).toFixed(1)}%`);
  check(a.idleRatio > b.idleRatio + 0.2,
    '调大 idleMinS/idleMaxS 后静止占比显著上升（参数可调）',
    { lazy: a.idleRatio, active: b.idleRatio });
}

// ════════════════════════════════════════════════════════════
head('7. 行走距离受参数约束；偶尔远走');
{
  const shortProfile = {
    walkDistMin: 0.3, walkDistMax: 0.3, longWalkChance: 0, chainWalkChance: 0,
    idleMinS: 0.4, idleMaxS: 0.6, shortPauseChance: 0,
  };
  const r = simulate('chick', 120, 555, shortProfile);
  const maxWalk = Math.max(...r.walkRuns, 0);
  console.log(`  · 固定 0.3 格短走：最大单段位移 ${maxWalk.toFixed(3)} 格（${r.walkRuns.length} 段）`);
  check(maxWalk <= 0.3 + 0.12, '常规行走单段位移 <= walkDistMax + 到达容差', maxWalk);
  check(r.walkRuns.length >= 8, '短走频繁发生（不会站着为主）', r.walkRuns.length);

  const longProfile = {
    walkDistMin: 0.3, walkDistMax: 0.3, longWalkChance: 1, chainWalkChance: 0,
    longWalkDistMin: 2.0, longWalkDistMax: 2.0,
    idleMinS: 0.4, idleMaxS: 0.6, shortPauseChance: 0,
  };
  const r2 = simulate('chick', 120, 777, longProfile);
  const maxLong = Math.max(...r2.walkRuns, 0);
  console.log(`  · longWalkChance=1：最大单段位移 ${maxLong.toFixed(3)} 格`);
  check(maxLong > 1.0, '偶尔远走确实走出一段长距离（>1 格）', maxLong);
}

// ════════════════════════════════════════════════════════════
head('8. 边界裁剪 + 重叠不吞并（60s 真实时钟步进）');
{
  const gs = mkMap(5);
  const a = addCreature(gs, {
    id: 'a', kind: 'chick', state: 'idle', stateLeft: 0,
    override: { idleMinS: 0.4, idleMaxS: 0.8, shortPauseChance: 0.5 },
  });
  const b = addCreature(gs, {
    id: 'b', kind: 'slime_fire', state: 'idle', stateLeft: 0,
    override: { idleMinS: 0.4, idleMaxS: 0.8, shortPauseChance: 0.5 },
  });
  const clock = new RealtimeClock(() => gs);
  let inside = true;
  let movedSome = false;
  const p0 = { ...a.pos };
  for (let i = 0; i < 300; i++) {
    clock.advance(200);
    for (const c of [a, b]) {
      const r = c.radius;
      for (const p of [c.pos, c.renderPos]) {
        if (!(p.x >= 1 + r - 1e-9 && p.x <= 4 - r + 1e-9 &&
              p.y >= 1 + r - 1e-9 && p.y <= 4 - r + 1e-9)) { inside = false; }
      }
    }
  }
  if (Math.hypot(a.pos.x - p0.x, a.pos.y - p0.y) > 0.05) movedSome = true;
  check(inside, '60s 内 pos/renderPos 始终在栅栏合法区（圆心+半径不出栏）');
  check(movedSome, '同一只生物在这段时间确实走动过（不是被边界卡死）');
  check(gs.creatures.length === 2, '两只重叠生物始终各自保留', gs.creatures.length);
  const refs = G.creatureTileRefs(gs, a);
  check(refs.length >= 1, '几何层能按半径算出生物覆盖的格子', refs.length);
  const hits = G.creaturesInTiles(gs, refs);
  check(hits.length >= 1, '几何查询仍能命中栅栏内生物', hits.length);
}

// ════════════════════════════════════════════════════════════
head('9. 静止的生物不产生 DOM 更新；移动时才写 transform');
{
  const layer = new FakeEl('div');
  const view = new CreatureView(layer);
  const gs = {
    creatures: [{
      id: 'still', kind: 'slime_water', hp: 40, radius: 0.25,
      pos: { x: 2.0, y: 2.0 }, renderPos: { x: 2.0, y: 2.0 },
    }],
  };
  view.paint(gs, 80);
  const node = view.els.get('still');
  const countTransform = node._counts.transform || 0;
  check(countTransform === 1, '首次绘制写入 1 次 transform', countTransform);

  for (let i = 0; i < 60; i++) view.paint(gs, 80);
  check((node._counts.transform || 0) === countTransform,
    '静止 60 帧没有重复写 transform（无意义 DOM 更新为 0）', node._counts.transform);

  gs.creatures[0].renderPos.x += 0.1;
  view.paint(gs, 80);
  check((node._counts.transform || 0) === countTransform + 1,
    '位置变化后才再写 1 次 transform', node._counts.transform);
}

// ════════════════════════════════════════════════════════════
head('10. 撞墙即时重决策：同一步完成 / 方向阈值 / 200 次压力 / 无可行→Idle');
{
  // 10.1 同一步内完成重决策 + 新方向满足「阈值内不碰任何栅栏」
  for (const kind of ['chick', 'chicken', 'slime_grass']) {
    const r = simulate(kind, 240, 24680, null, { size: 3, startPos: { x: 1.7, y: 1.7 }, dir: 0 });
    check(r.wall.hits > 0, `${kind}: 1×1 栅栏内确实发生撞墙（可验证重决策）`, r.wall.hits);
    check(r.wall.badDecision === 0, `${kind}: 每次撞墙都在同一逻辑步内完成 Idle/Walk 重决策`, r.wall.badDecision);
    check(r.wall.badRoom === 0, `${kind}: 每次换向的新方向都满足「${r.threshold.toFixed(2)} 格内不碰任何栅栏」`, r.wall.badRoom);
    check(r.wall.outOfBounds === 0, `${kind}: 撞墙那一刻圆心始终在合法区内（不穿出栅栏）`, r.wall.outOfBounds);
    check(r.wall.walkZeroSteps === 0, `${kind}: 240s 内不存在 Walk 零位移步`, r.wall.walkZeroSteps);
  }

  // 10.2 连续 200 次撞边压力测试：不抖动、不选回朝墙方向、位置不越界
  for (const kind of ['chick', 'chicken', 'slime_grass']) {
    const gs = mkMap(3);
    const r = G.creatureRadius({ kind, radius: CREATURES[kind].radius });
    const inner = { x0: 1 + r, x1: 2 - r, y0: 1 + r, y1: 2 - r };
    const c = addCreature(gs, { kind, pos: { x: inner.x1, y: inner.y0 }, dir: 0, state: 'walk' });
    const profile = getBehaviorProfile(kind);
    const threshold = wallFreeDistanceOf(profile, c.speedPerTile);
    const stepLen = 0.2 / c.speedPerTile;
    const origRandom = Math.random;
    Math.random = makeRng(424242);
    let bad = 0;
    let badRoom = 0;
    let idleCount = 0;
    let walkCount = 0;
    try {
      for (let i = 0; i < 200; i++) {
        // 极端场景：每次都贴右墙 + 朝墙内 + 当前段目标在墙外
        c.pos.x = inner.x1;
        c.pos.y = inner.y0;
        c.dir = 0;
        c.behaviorState = 'walk';
        c.targetPos = { x: inner.x1 + 5, y: inner.y0 };
        c.stateLeft = 1e9;
        const hitsBefore = c.wallHits || 0;
        CreatureSystem.stepCreatures(gs, 0.2);

        if ((c.wallHits || 0) <= hitsBefore) bad++;
        if (c.lastWallDecision === 'idle') {
          idleCount++;
          if (c.behaviorState !== 'idle' || c.targetPos !== null) bad++;
        } else if (c.lastWallDecision === 'walk') {
          walkCount++;
          if (c.behaviorState !== 'walk' || !c.targetPos) bad++;
          const room = roomAlong(c.pos.x, c.pos.y, c.dir, inner) + stepLen;
          if (room < threshold - 1e-6) badRoom++;
        } else {
          bad++;
        }
        if (!(c.pos.x >= inner.x0 - 1e-12 && c.pos.x <= inner.x1 + 1e-12 &&
              c.pos.y >= inner.y0 - 1e-12 && c.pos.y <= inner.y1 + 1e-12)) bad++;
      }
    } finally {
      Math.random = origRandom;
    }
    console.log(`  · ${kind}: 200 次撞墙 → Idle ${idleCount} 次 / 换向 ${walkCount} 次`);
    check(bad === 0, `${kind}: 200 次连续撞墙均完成重决策且不越界（无抖动空转）`, bad);
    check(idleCount + walkCount === 200, `${kind}: 200 次撞墙都是二选一（Idle 或 换向）`, idleCount + walkCount);
    check(walkCount > 0, `${kind}: 仍有一定比例换向离开（不是每次都只会站住）`, walkCount);
    check(badRoom === 0, `${kind}: 200 次换向中没有一次选回朝墙方向（无「撞墙→又朝墙」抖动）`, badRoom);
  }

  // 10.3 采样不到任何可行方向 → 直接 Idle（带额外静止），绝不留 Walk 零位移
  {
    const gs = mkMap(3); // 1×1 栅栏合法区 0.5×0.5，把阈值抬到 10 格 → 必然无可行方向
    const inner = { x0: 1.25, x1: 1.75, y0: 1.25, y1: 1.75 };
    const c = addCreature(gs, {
      kind: 'chicken', pos: { x: inner.x1, y: 1.5 }, dir: 0, state: 'walk',
      override: { wallFreeMinDist: 10 },
    });
    c.targetPos = { x: inner.x1 + 5, y: 1.5 };
    c.stateLeft = 0.2;
    const px = c.pos.x;
    CreatureSystem.stepCreatures(gs, 0.2);
    check(c.wallHits === 1, '无可行方向场景已识别为撞墙', c.wallHits);
    check(c.behaviorState === 'idle' && c.targetPos === null,
      '无可行方向 → 立即进入 Idle（不停在 Walk 状态零位移）', { state: c.behaviorState, target: c.targetPos });
    check(c.stateLeft > 0 && c.wallFailStreak === 1,
      '兜底 Idle 带额外静止（wallFailExtraIdleS）', { stateLeft: c.stateLeft, streak: c.wallFailStreak });
    check(c.pos.x === px && c.pos.x <= inner.x1 + 1e-9, '撞墙步位置夹回合法区', c.pos);

    // 恢复可行阈值后，下一段行走必须恢复（不会永久卡在 Idle）
    c.behaviorOverride = { wallFreeMinDist: 0.5 };
    c.stateLeft = 0;
    let moved = false;
    for (let i = 0; i < 100 && !moved; i++) {
      const bx = c.pos.x;
      const by = c.pos.y;
      CreatureSystem.stepCreatures(gs, 0.2);
      if (Math.hypot(c.pos.x - bx, c.pos.y - by) > 1e-12) moved = true;
    }
    check(moved, '无可行方向的兜底 Idle 之后能恢复移动（不会永久卡死）');
  }
}

// ════════════════════════════════════════════════════════════
head('11. 1×1 栅栏（合法圆心区 0.5×0.5）：60s 内仍有足够次数的位移');
{
  for (const kind of ['chick', 'chicken', 'slime_grass']) {
    const r = simulate(kind, 60, 13579, null, { size: 3 });
    console.log(`  · ${kind}: 位移段 ${r.walkRuns.length} 次，平均段长 ${(r.walkRuns.reduce((a, b) => a + b, 0) / (r.walkRuns.length || 1)).toFixed(2)} 格，` +
      `静止 ${(r.idleRatio * 100).toFixed(1)}%`);
    check(r.walkRuns.length >= 6, `${kind}: 1×1 栅栏 60s 内位移段 >= 6 次（能看见连续移动）`, r.walkRuns.length);
    check(r.wall.outOfBounds === 0, `${kind}: 1×1 栅栏内圆心始终合法`, r.wall.outOfBounds);
    check(r.wall.walkZeroSteps === 0, `${kind}: 1×1 栅栏内无 Walk 零位移`, r.wall.walkZeroSteps);
    check(r.longestIdleSteps * 0.2 <= 11.0, `${kind}: 1×1 栅栏内最长静止 <= 11s（无卡墙式长静止）`, r.longestIdleSteps * 0.2);
  }
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
