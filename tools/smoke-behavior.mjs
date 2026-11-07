// tools/smoke-behavior.mjs —— 生物「走走停停」行为冒烟
// 用法：node tools/smoke-behavior.mjs
//
// 验收口径（用户裁定）：
//   1) 存在一段连续时间完全静止（位置逐字节不变）
//   2) 静止与移动交替出现，且停下来是常态（静止占比 > 50%）
//   3) 调参能改变静止占比（同一随机种子、只改参数）
//   4) 边界裁剪与重叠仍成立（pos/renderPos 均在栅栏合法区，重叠不被吞并）
//   5) 静止的生物不写 DOM（CreatureView 的 transform 不再重复赋值）
//   6) 全量冒烟 0 失败由 npm/全部脚本统一验证（本文件自身 0 失败）

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
import { CreatureSystem } from '../src/systems/CreatureSystem.js';
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

/**
 * 跑一段逻辑时间，逐步采样位移与状态。
 * @returns {{gs:object, c:object, samples:Array, idleRatio:number, transitions:number, longestIdleSteps:number, walkRuns:Array}}
 */
function simulate(kind, seconds, seed, override = null, startPos = { x: 2.5, y: 2.5 }) {
  const gs = mkMap(5); // 栅栏内 3×3，合法圆心区 [1.25, 3.75]
  const c = addCreature(gs, { kind, state: 'idle', stateLeft: 0, pos: startPos, override });
  const origRandom = Math.random;
  Math.random = makeRng(seed);
  const samples = [];
  try {
    const steps = Math.round(seconds / 0.2);
    for (let i = 0; i < steps; i++) {
      const beforeX = c.pos.x;
      const beforeY = c.pos.y;
      CreatureSystem.stepCreatures(gs, 0.2);
      samples.push({
        t: (i + 1) * 0.2,
        x: c.pos.x,
        y: c.pos.y,
        state: c.behaviorState,
        moved: Math.hypot(c.pos.x - beforeX, c.pos.y - beforeY) > 1e-12,
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
  };
}

// ════════════════════════════════════════════════════════════
head('1. 参数表结构：每个物种都有完整预设，且表是唯一数值来源');
{
  const required = Object.keys(DEFAULT_BEHAVIOR);
  check(required.length >= 13, '行为参数表字段齐全（>=13 项）', required.length);
  for (const kind of Object.keys(CREATURES)) {
    const p = getBehaviorProfile(kind);
    const missing = required.filter(k => typeof p[k] !== 'number' || !Number.isFinite(p[k]));
    check(missing.length === 0, `${kind}: 预设参数完整且为有限数值`, missing);
    check(p.idleMinS < p.idleMaxS && p.shortPauseMinS < p.shortPauseMaxS &&
          p.walkDistMin < p.walkDistMax && p.longWalkDistMin < p.longWalkDistMax,
      `${kind}: 各时长/距离区间下界 < 上界`, p);
  }
  check(BEHAVIOR_PROFILES.chick.idleMaxS < BEHAVIOR_PROFILES.chicken.idleMaxS &&
        BEHAVIOR_PROFILES.chicken.idleMaxS < BEHAVIOR_PROFILES.slime_fire.idleMaxS,
    '长站上限：小鸡 < 成鸡 < 史莱姆（物种差异）',
    [BEHAVIOR_PROFILES.chick.idleMaxS, BEHAVIOR_PROFILES.chicken.idleMaxS, BEHAVIOR_PROFILES.slime_fire.idleMaxS]);
  check(BEHAVIOR_PROFILES.chick.maxTurnRate > BEHAVIOR_PROFILES.chicken.maxTurnRate &&
        BEHAVIOR_PROFILES.chicken.maxTurnRate > BEHAVIOR_PROFILES.slime_fire.maxTurnRate,
    '转向灵敏度：小鸡 > 成鸡 > 史莱姆');

  const cs = fs.readFileSync(`${ROOT}/src/systems/CreatureSystem.js`, 'utf8');
  check(cs.includes("from '../data/creatureBehavior.js'"), '逻辑层从行为参数表读取（不写死数值）');
  check(!cs.includes('PAUSE_CHANCE_ON_ARRIVE') && !cs.includes('RETARGET_MIN_S'),
    '已删除阶段 2 的写死停顿/重取常量');
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
head('4. 静止与移动交替，停下来是常态（600s 采样）');
{
  const results = {};
  for (const [kind, seed] of [['chick', 12345], ['chicken', 23456], ['slime_grass', 34567]]) {
    const r = simulate(kind, 600, seed);
    results[kind] = r;
    console.log(`  · ${kind}: 静止占比 ${(r.idleRatio * 100).toFixed(1)}%，` +
      `状态切换 ${r.transitions} 次，最长连续静止 ${r.longestIdleSteps} 步（${(r.longestIdleSteps * 0.2).toFixed(1)}s），` +
      `行走段 ${r.walkRuns.length} 次`);
    check(r.idleRatio > 0.5, `${kind}: 静止占比 > 50%（停下来是常态）`, r.idleRatio);
    check(r.transitions >= 20, `${kind}: Idle/Walk 交替 >= 20 次（不是一直走或一直站）`, r.transitions);
    check(r.longestIdleSteps >= 8, `${kind}: 存在 >= 1.6s 的连续完全静止`, r.longestIdleSteps);
    check(r.walkRuns.length >= 10, `${kind}: 行走段 >= 10 次`, r.walkRuns.length);
  }
  check(results.slime_grass.idleRatio > results.chicken.idleRatio,
    '史莱姆比成鸡更少动（静止占比更高）',
    { slime: results.slime_grass.idleRatio, chicken: results.chicken.idleRatio });
  check(results.chicken.idleRatio > results.chick.idleRatio,
    '成鸡比小鸡更少动（小鸡最活）',
    { chicken: results.chicken.idleRatio, chick: results.chick.idleRatio });
}

// ════════════════════════════════════════════════════════════
head('5. 参数变化能改变静止占比（同种子、只改 idle 参数）');
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
head('6. 行走距离受参数约束；偶尔远走');
{
  const shortProfile = {
    walkDistMin: 0.3, walkDistMax: 0.3, longWalkChance: 0,
    idleMinS: 0.4, idleMaxS: 0.6, shortPauseChance: 0,
  };
  const r = simulate('chick', 120, 555, shortProfile);
  const maxWalk = Math.max(...r.walkRuns, 0);
  console.log(`  · 固定 0.3 格短走：最大单段位移 ${maxWalk.toFixed(3)} 格（${r.walkRuns.length} 段）`);
  check(maxWalk <= 0.3 + 0.12, '常规行走单段位移 <= walkDistMax + 到达容差', maxWalk);
  check(r.walkRuns.length >= 8, '短走频繁发生', r.walkRuns.length);

  const longProfile = {
    walkDistMin: 0.3, walkDistMax: 0.3, longWalkChance: 1,
    longWalkDistMin: 2.0, longWalkDistMax: 2.0,
    idleMinS: 0.4, idleMaxS: 0.6, shortPauseChance: 0,
  };
  const r2 = simulate('chick', 120, 777, longProfile);
  const maxLong = Math.max(...r2.walkRuns, 0);
  console.log(`  · longWalkChance=1：最大单段位移 ${maxLong.toFixed(3)} 格`);
  check(maxLong > 1.0, '偶尔远走确实走出一段长距离（>1 格）', maxLong);
}

// ════════════════════════════════════════════════════════════
head('7. 边界裁剪 + 重叠不吞并（60s 真实时钟步进）');
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
head('8. 静止的生物不产生 DOM 更新；移动时才写 transform');
{
  const layer = new FakeEl('div');
  const view = new CreatureView(layer);
  const gs = {
    creatures: [{
      id: 'still', kind: 'slime_water', hp: 40, radius: 0.25,
      pos: { x: 2.0, y: 2.0 }, renderPos: { x: 2.0, y: 2.0 },
    }],
  };
  // 先 paint 一次创建节点（此时 transform 写入 1 次）
  view.paint(gs, 80);
  const node = view.els.get('still');
  const countTransform = node._counts.transform || 0;
  check(countTransform === 1, '首次绘制写入 1 次 transform', countTransform);

  for (let i = 0; i < 60; i++) view.paint(gs, 80); // 静止 60 帧
  check((node._counts.transform || 0) === countTransform,
    '静止 60 帧没有重复写 transform（无意义 DOM 更新为 0）', node._counts.transform);

  gs.creatures[0].renderPos.x += 0.1;
  view.paint(gs, 80);
  check((node._counts.transform || 0) === countTransform + 1,
    '位置变化后才再写 1 次 transform', node._counts.transform);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
