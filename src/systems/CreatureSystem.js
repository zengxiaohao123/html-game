// src/systems/CreatureSystem.js
// Phase 3 —— 生物系统（阶段 2：连续积分移动）
//   spawnCreature(kind)    —— 生成 1 只，放入栅栏合法点（允许完全重叠）
//   stepCreatures(gs, dtSec) —— 固定 200ms 逻辑步内的连续积分（pos），由 RealtimeClock 驱动
//   advanceCreatureRendering(gs, dtSec) —— 每帧推进 renderPos（不参与判定，结算期间也不停）
//   feedCreature(gs, creatureId) —— 投喂逻辑（简化）
//   dailyTick(gs)         —— DaySystem.startNewDay 末尾调用：饥饿检测、成长、心情、产蛋、容量警告
//
// 运动模型（设计文档 §2.3 / §18.3）：
//   - pos 连续逻辑坐标（判定权威），renderPos 渲染插值位置；
//   - speedPerTile = 秒/格（3~6 秒/格），dir = 弧度（任意方向）；
//   - 随机游走：目标点 + 角速度上限的平滑转向；到达目标后偶尔停顿；
//   - 只裁剪栅栏边界（圆心 + 半径不出栅栏），生物之间不碰撞、不分离、允许重叠。
//
// 容量 & 超载惩罚（§13.2，2026-11-04 裁决）：
//   友善超载 → 2 天后 友善类收益归 0（wheat/rice/strawberry/pea/henhouse 产蛋）
//   危险 / 高危超载 → 2 天后 每日开始 对每只超容量生物
//     按「该生物 100% 基础攻击力」扣真实伤害（基础攻击力 = 面板显示数值，不受临时强化影响）

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { devLog } from '../core/Logger.js';
import { Random } from '../core/Random.js';
import { getCreatureDef, SLIME_KINDS } from '../data/creatures.js';
import { ITEMS } from '../data/items.js';
import { normalizeTerrain } from '../data/terrains.js';
import { InventorySystem } from './InventorySystem.js';
import { CombatSystem } from './CombatSystem.js';
import {
  DEFAULT_CREATURE_RADIUS,
  FENCE_ORIGIN_X,
  FENCE_ORIGIN_Y,
  clamp,
  creatureRadius,
  fenceCellOfGrid,
  fenceRect,
  fenceTileRect,
} from '../core/Geometry.js';

// ── 生物计数器（每次 spawn 都给唯一 id） ──
let _nextCreatureId = 1;
export function resetCreatureIdCounter() { _nextCreatureId = 1; }

// ── 运动参数 ──
/** 秒/格 合法区间（设计文档 §2.3：3~6 秒走 1 格） */
export const MIN_SECONDS_PER_TILE = 3;
export const MAX_SECONDS_PER_TILE = 6;
/** 平滑转向的最大角速度（弧度/秒）；保证不会瞬间反向抖动 */
const MAX_TURN_RATE = 2.4;
/** 到达目标后的停顿概率与时长（秒；刻意不用 Ms 后缀，避免被日初基线判为墙钟字段） */
const PAUSE_CHANCE_ON_ARRIVE = 0.3;
const PAUSE_MIN_S = 0.3;
const PAUSE_MAX_S = 0.9;
/** 重新取目标点的间隔（到达/超时都会重取，秒） */
const RETARGET_MIN_S = 1.2;
const RETARGET_MAX_S = 3.5;
/** 视为到达目标点的距离（格） */
const ARRIVE_EPS = 0.06;

/**
 * 生成 1 只生物
 * @param {object} gs
 * @param {string} kind          creatures.js 里定义的 kind：'chick' / 'slime_fire' 等
 * @param {object} [opts]
 * @param {string} [opts.facilityId] 来源设施（facility_henhouse / facility_slimehouse），用于每日心情 +1
 * @param {number} [opts.sourceTileIdx] 来源设施所在外圈格 idx（鸡舍按实例计数/投喂归属用）
 * @returns {object|null} 新生物对象；栅栏不存在或 kind 未知 → null
 */
export function spawnCreature(gs, kind, opts = {}) {
  const def = getCreatureDef(kind);
  if (!def) {
    devLog.warn('[CreatureSystem.spawnCreature] unknown kind:', kind);
    return null;
  }

  // 只要求落点在栅栏域内合法，不再要求整格为空（允许完全重叠）；容量仍按分类软上限统计
  const tile = pickFenceSpawnTile(gs);
  if (!tile) {
    devLog.warn('[CreatureSystem.spawnCreature] no fence tile, cannot spawn', kind);
    EventBus.emit(GE.TOAST_SHOW, { text: '⚠️ 栅栏不存在，无法生成生物', duration: 2000 });
    return null;
  }

  const radius = typeof def.radius === 'number' && def.radius > 0 ? def.radius : DEFAULT_CREATURE_RADIUS;
  const rect = fenceTileRect(tile.row, tile.col);
  const pos = randomPointInRect(rect, radius);
  const dir = randomDirection();

  // 构造实例
  const creature = {
    id: 'creature_' + (_nextCreatureId++),
    kind: def.kind,
    // primary 格：兼容既有栅格逻辑与 fence[].creatures 缓存（几何归属见 Geometry.creatureTileRefs）
    row: tile.row,
    col: tile.col,
    // 连续坐标（判定权威位置）与半径（米；1 格边长 = 1 米）
    pos,
    radius,
    // 运动：dir = 弧度（任意方向）；speedPerTile = 秒/格；闲逛目标点 + 停顿/重取计时
    dir,
    speedPerTile: typeof def.speedPerTile === 'number' && def.speedPerTile > 0
      ? def.speedPerTile
      : defaultSecondsPerTile(),
    targetPos: null,
    pauseLeft: 0,
    retargetLeft: 0,
    // 渲染插值位置：表现层可随帧更新，结算冻结只冻结 pos，不影响这里
    renderPos: { x: pos.x, y: pos.y },
    hp: def.hp,
    maxHp: def.hp,
    atk: def.atk,
    element: def.element,
    elementImmune: def.elementImmune,
    category: def.category,
    growth: 0,
    growthMax: def.growthMax || 0,
    mood: def.mood || 0,
    stage: def.stage || 'chick',
    facilityId: opts.facilityId || null,
    sourceTileIdx: opts.sourceTileIdx ?? null,
    lastMoveTs: Date.now(),
    activeBuffs: [],
  };

  // 加入 gs
  gs.creatures.push(creature);
  tile.creatures = tile.creatures || [];
  tile.creatures.push(creature.id);

  // 更新容量计数（超出也允许生成，warn 由 dailyTick 报）
  // A-7：【当生物增加时】词条（玉米田 FAC-011）—— 任何来源的生成都算"生物增加"
  HookDispatcher.fire('onCreatureAdded', { gs, creature });
  EventBus.emit(GE.CREATURE_SPAWNED, { creature });
  EventBus.emit(GE.CAPACITY_CHANGE, { category: def.category, newCount: countByCategory(gs, def.category) });
  EventBus.emit(GE.TOAST_SHOW, { text: `${def.emoji} 生成 ${def.name}`, duration: 1500 });
  devLog.info('[CreatureSystem.spawnCreature]', kind, creature.id);
  return creature;
}

/**
 * 选落点格：任意一个合法栅栏格（不要求为空，允许完全重叠）。
 * 扩图后栅栏内 (size-2)×(size-2) 同步变大，候选格随之变多。
 */
function pickFenceSpawnTile(gs) {
  const fence = gs.map?.fence || [];
  if (fence.length === 0) return null;
  return Random.pick(fence);
}

/** 在格内取一个圆不越出该格的合法中心点（半径以米计，1 格边长 = 1 米，连续坐标） */
function randomPointInRect(rect, radius) {
  const inset = Math.min(Math.max(0, radius), 0.5);
  const x0 = rect.x0 + inset;
  const x1 = rect.x1 - inset;
  const y0 = rect.y0 + inset;
  const y1 = rect.y1 - inset;
  return {
    x: x0 + Math.random() * Math.max(0, x1 - x0),
    y: y0 + Math.random() * Math.max(0, y1 - y0),
  };
}

/** 任意方向的初始朝向（弧度，自由闲逛，非四方向） */
function randomDirection() {
  return Math.random() * Math.PI * 2;
}

/** 速度兜底（秒/格）：取区间中值，避免缺字段时以 0 速卡死 */
function defaultSecondsPerTile() {
  return (MIN_SECONDS_PER_TILE + MAX_SECONDS_PER_TILE) / 2;
}

function countByCategory(gs, category) {
  return gs.creatures.filter(c => c.category === category).length;
}

// ────────────────────────────────────────────────────────────
// 连续积分（逻辑步 200ms 由 RealtimeClock 调用）
// ────────────────────────────────────────────────────────────

function normalizeAngle(a) {
  const twoPi = Math.PI * 2;
  let v = a % twoPi;
  if (v < 0) v += twoPi;
  return v;
}

/** 从 from 转向 to 的最短角差（-π, π] */
function shortestAngleDelta(from, to) {
  let d = normalizeAngle(to - from);
  if (d > Math.PI) d -= Math.PI * 2;
  return d;
}

/** 以最大角速度朝目标角度平滑转向（不允许瞬间反向） */
function turnToward(from, to, maxDeltaRad) {
  const d = shortestAngleDelta(from, to);
  if (Math.abs(d) <= maxDeltaRad) return normalizeAngle(to);
  return normalizeAngle(from + Math.sign(d) * maxDeltaRad);
}

/** 栅栏内合法区间（圆心 + 半径不出栅栏） */
function fenceInner(gs, radius) {
  const f = fenceRect(gs);
  return {
    x0: f.x0 + radius,
    x1: f.x1 - radius,
    y0: f.y0 + radius,
    y1: f.y1 - radius,
  };
}

/** 把圆心夹回栅栏内合法区域（长大变半径 / 读档越界时用） */
export function clampCreatureToFence(gs, creature) {
  if (!creature) return creature;
  const r = creatureRadius(creature);
  const inner = fenceInner(gs, r);
  for (const key of ['pos', 'renderPos']) {
    const p = creature[key];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    p.x = clamp(p.x, inner.x0, inner.x1);
    p.y = clamp(p.y, inner.y0, inner.y1);
  }
  return creature;
}

/** 随机取栅栏内的闲逛目标点（圆心不越界） */
function pickWanderTarget(gs, creature) {
  const inner = fenceInner(gs, creatureRadius(creature));
  for (let i = 0; i < 8; i++) {
    const x = inner.x0 + Math.random() * Math.max(0, inner.x1 - inner.x0);
    const y = inner.y0 + Math.random() * Math.max(0, inner.y1 - inner.y0);
    if (Math.hypot(x - creature.pos.x, y - creature.pos.y) > ARRIVE_EPS * 4) return { x, y };
  }
  return { x: (inner.x0 + inner.x1) / 2, y: (inner.y0 + inner.y1) / 2 };
}

/** 主格兼容缓存：row/col + fence[].creatures（几何归属仍以 pos+radius 为准） */
function syncPrimaryFenceTile(gs, creature) {
  const rowCols = gs.map?.fenceRowCols || 0;
  if (rowCols <= 0 || !Array.isArray(gs.map?.fence)) return;
  const gridX = clamp(Math.floor(creature.pos.x), FENCE_ORIGIN_X, FENCE_ORIGIN_X + rowCols - 1);
  const gridY = clamp(Math.floor(creature.pos.y), FENCE_ORIGIN_Y, FENCE_ORIGIN_Y + rowCols - 1);
  const cell = fenceCellOfGrid(gs, gridX, gridY);
  if (!cell) return;
  if (creature.row === cell.row && creature.col === cell.col) return;

  const oldTile = gs.map.fence.find(t => t.row === creature.row && t.col === creature.col);
  if (oldTile?.creatures) {
    oldTile.creatures = oldTile.creatures.filter(id => id !== creature.id);
  }
  creature.row = cell.row;
  creature.col = cell.col;
  const newTile = gs.map.fence[cell.row * rowCols + cell.col];
  if (newTile) {
    newTile.creatures = newTile.creatures || [];
    if (!newTile.creatures.includes(creature.id)) newTile.creatures.push(creature.id);
  }
  return newTile;
}

/** 进入草地形时消耗 1 草元素量（§13.3 放牧路径） */
function consumeGrassOnEnter(gs, creature, newTile) {
  if (!newTile) return false;
  if (normalizeTerrain(newTile.terrain) !== 'terrain_grass' || (newTile.terrainAmount ?? 0) <= 0) return false;
  newTile.terrainAmount -= 1;
  if (creature.kind === 'chick' || creature.kind === 'chicken') creature.grazedForFeed = true;
  if (newTile.terrainAmount <= 0) {
    newTile.terrain = 'terrain_none';
    EventBus.emit(GE.TILE_UPDATED);
  }
  return true;
}

/**
 * 一个逻辑步的连续积分：只推进 pos（判定权威位置）。
 * 回合 / 技能结算期间由 RealtimeClock 跳过本函数（pos 冻结），渲染位置照常推进。
 * @param {object} gs
 * @param {number} dtSec 逻辑步时长（秒）
 */
export function stepCreatures(gs, dtSec) {
  if (!gs || !Array.isArray(gs.creatures)) return;
  let tileChanged = false;

  for (const c of gs.creatures) {
    if (!c || c.hp <= 0) continue;
    if (!c.pos || !Number.isFinite(c.pos.x) || !Number.isFinite(c.pos.y)) continue;
    const fence = fenceRect(gs);
    const r = creatureRadius(c);
    if (fence.x1 <= fence.x0) continue;

    // 停顿：不移动、不转向
    if ((c.pauseLeft || 0) > 0) {
      c.pauseLeft = Math.max(0, c.pauseLeft - dtSec);
      continue;
    }

    // 目标点：到达 / 超时 / 被边界打断后重取
    c.retargetLeft = (c.retargetLeft || 0) - dtSec;
    if (!c.targetPos || c.retargetLeft <= 0) {
      c.targetPos = pickWanderTarget(gs, c);
      c.retargetLeft = RETARGET_MIN_S + Math.random() * (RETARGET_MAX_S - RETARGET_MIN_S);
    }

    const dx = c.targetPos.x - c.pos.x;
    const dy = c.targetPos.y - c.pos.y;
    if (Math.hypot(dx, dy) < ARRIVE_EPS) {
      // 到达：偶尔停顿（低概率，避免"每步都在抖"），再取下一个目标
      if (Math.random() < PAUSE_CHANCE_ON_ARRIVE) {
        c.pauseLeft = PAUSE_MIN_S + Math.random() * (PAUSE_MAX_S - PAUSE_MIN_S);
      }
      c.targetPos = pickWanderTarget(gs, c);
      c.retargetLeft = RETARGET_MIN_S + Math.random() * (RETARGET_MAX_S - RETARGET_MIN_S);
    }

    // 平滑转向（角速度上限 → 不会瞬间反向抖动）
    const desired = Math.atan2(c.targetPos.y - c.pos.y, c.targetPos.x - c.pos.x);
    c.dir = turnToward(
      Number.isFinite(c.dir) ? c.dir : desired,
      desired,
      MAX_TURN_RATE * dtSec,
    );

    // 连续位移：秒/格 → 本次逻辑步的格数
    const speed = typeof c.speedPerTile === 'number' && c.speedPerTile > 0
      ? c.speedPerTile : defaultSecondsPerTile();
    const dist = dtSec / speed;
    const inner = fenceInner(gs, r);
    const beforeX = c.pos.x;
    const beforeY = c.pos.y;
    c.pos.x = clamp(c.pos.x + Math.cos(c.dir) * dist, inner.x0, inner.x1);
    c.pos.y = clamp(c.pos.y + Math.sin(c.dir) * dist, inner.y0, inner.y1);

    // 越界被裁剪 → 丢弃目标，下一步重新取朝内的目标（靠角速度平滑转向，不瞬间反弹）
    const hitX = c.pos.x === inner.x0 || c.pos.x === inner.x1;
    const hitY = c.pos.y === inner.y0 || c.pos.y === inner.y1;
    if (hitX || hitY) {
      c.targetPos = null;
      c.retargetLeft = 0;
    }

    const moved = Math.abs(c.pos.x - beforeX) + Math.abs(c.pos.y - beforeY);
    if (moved > 0) {
      const newTile = syncPrimaryFenceTile(gs, c);
      if (newTile && consumeGrassOnEnter(gs, c, newTile)) tileChanged = true;
    }
  }

  // ⑤ 一次性广播：只有地块内容真的变化才发（连续移动本身由渲染层逐帧绘制）
  if (tileChanged) EventBus.emit(GE.TILE_UPDATED);
}

/**
 * 每帧推进 renderPos（表现层位置，不参与判定）。
 * 与逻辑积分使用同一套速度/方向；结算冻结期间 pos 停下，但本函数照常调用。
 * @param {object} gs
 * @param {number} dtSec 真实帧时长（秒）
 */
export function advanceCreatureRendering(gs, dtSec) {
  if (!gs || !Array.isArray(gs.creatures) || dtSec <= 0) return;
  const stepSec = Math.min(0.1, dtSec); // 单帧最多 100ms，避免切后台瞬移
  const fence = fenceRect(gs);
  if (fence.x1 <= fence.x0) return;

  for (const c of gs.creatures) {
    if (!c || c.hp <= 0) continue;
    if (!c.renderPos || !Number.isFinite(c.renderPos.x) || !Number.isFinite(c.renderPos.y)) {
      c.renderPos = { x: c.pos?.x ?? 0, y: c.pos?.y ?? 0 };
      continue;
    }
    if ((c.pauseLeft || 0) > 0) continue;
    const r = creatureRadius(c);
    const speed = typeof c.speedPerTile === 'number' && c.speedPerTile > 0
      ? c.speedPerTile : defaultSecondsPerTile();
    const dist = stepSec / speed;
    const dir = Number.isFinite(c.dir) ? c.dir : 0;
    const inner = {
      x0: fence.x0 + r, x1: fence.x1 - r,
      y0: fence.y0 + r, y1: fence.y1 - r,
    };
    c.renderPos.x = clamp(c.renderPos.x + Math.cos(dir) * dist, inner.x0, inner.x1);
    c.renderPos.y = clamp(c.renderPos.y + Math.sin(dir) * dist, inner.y0, inner.y1);
  }
}

/**
 * 投喂单只生物（简化版）
 */
export function feedCreature(gs, creatureId, amount = 1) {
  const c = gs.creatures.find(cc => cc.id === creatureId);
  if (!c) return false;
  c.mood += amount;
  return true;
}

/**
 * 击杀掉落发放（物品库 05 表 BIO drops 列）：
 *   BIO-001 小鸡 → 生肉 ×1；BIO-002 鸡 → 生肉 ×3；BIO-003 史莱姆 → 史莱姆凝胶 ×1
 * 所有击败路径（技能 / 连携技 / 燃烧）统一调用。
 */
export function grantKillDrops(gs, creature) {
  const def = getCreatureDef(creature.kind);
  const drops = def?.drops;
  if (!Array.isArray(drops) || drops.length === 0) return;
  for (const d of drops) {
    InventorySystem.addItem(gs, d.itemId, d.qty);
    EventBus.emit(GE.TOAST_SHOW, {
      text: `🎁 掉落：${ITEMS[d.itemId]?.name || d.itemId} ×${d.qty}`,
      duration: 1500,
    });
  }
  devLog.info('[CreatureSystem] 击杀掉落', creature.kind, drops);
}

/**
 * DaySystem.startNewDay 末尾调用
 * 职责：
 *   1) 检查所有生物饥饿/成长/心情
 *   2) 小鸡→鸡 成长
 *   3) 鸡产蛋
 *   4) 容量超载警告期 & 惩罚（高危 → 拆地块）
 *   5) 史莱姆粘液喷吐 5%（超载 15%）→ 完整实装
 *   6) 完整投喂（§13.3）：按鸡舍实例归属，优先放牧标记，其次消耗该鸡舍内储存的
 *      item_rice_straw/item_wheat（tile.contentState.henhouseFeed），growth +(10+心情) 或饥饿
 */
export function dailyTick(gs) {
  devLog.info('[CreatureSystem.dailyTick] day=', gs.day);

  // ── 1) 完整投喂：遍历 henhouse 设施 tile（FAC-009 / §13.3） ──
  const outerTiles = gs.map.outerTiles || [];
  const henhouseTiles = outerTiles.filter(t => t.contentId === 'facility_henhouse');
  const fedCreatures = new Set(); // 本次被投喂过的 creature id

  for (const henhouseTile of henhouseTiles) {
    // 只找「来自这个鸡舍实例」的生物（按 sourceTileIdx 归属；旧存档无该字段的生物无法归属，跳过）
    const henhouseCreatures = gs.creatures.filter(
      c => c.hp > 0 && c.sourceTileIdx === henhouseTile.idx
    );
    henhouseTile.contentState = henhouseTile.contentState || {};
    const store = henhouseTile.contentState.henhouseFeed || (henhouseTile.contentState.henhouseFeed = {});

    for (const c of henhouseCreatures) {
      if (fedCreatures.has(c.id)) continue;
      fedCreatures.add(c.id);

      // 路径 A（§13.3 优先）：优先消耗「该鸡舍内储存」的稻草或小麦 ×1
      const hasStraw = (store.item_rice_straw || 0) > 0;
      const hasWheat = (store.item_wheat || 0) > 0;
      if (hasStraw || hasWheat) {
        if (hasStraw) store.item_rice_straw -= 1;
        else store.item_wheat -= 1;
        c.grazedForFeed = false; // 储存路径已投喂，放牧标记同步失效（仅限前一天有效）
        c.growth += 10 + (c.mood || 0);
        c.lastFed = true;
      } else if (c.grazedForFeed) {
        // 路径 B（§13.3）：鸡舍内没有储存饲料，且鸡前一天在栅栏内啃过草 → 无需消耗即【已投喂】
        c.grazedForFeed = false;
        c.lastFed = true;
        c.growth += 10 + (c.mood || 0);
        devLog.info('[CreatureSystem] grazed → fed without store:', c.id);
      } else {
        // 两者都不满足 → 【饥饿】：心情 -1、成长值 +5（§13.3 / 物品库 03 表 A21，2026-11-03 裁决确认）
        c.grazedForFeed = false;
        c.growth += 5;
        c.mood = Math.max(-5, (c.mood || 0) - 1);
        EventBus.emit(GE.TOAST_SHOW, { text: `🐣 ${c.kind || '小鸡'} 没吃的，心情-1`, duration: 1200 });
        c.lastFed = false;
      }
    }
  }

  // ── 2) 生物日常 ──
  for (const c of gs.creatures) {
    if (!c || c.hp <= 0) continue;

    // 心情 +1 的触发时机在鸡舍 onEnter hook（§13.3：玩家每次进入鸡舍心情 +1，每日限 1 次），
    // 不在此无条件结算；非鸡舍来源生物心情固定 0（BIO-002 L 列）。

    // 成长值（小鸡）
    if (c.stage === 'chick' && c.growthMax > 0) {
      if (c.growth >= c.growthMax) {
        growUpChick(gs, c);
      }
    }

    // 鸡产蛋（§13.3：已投喂才产蛋）
    // 【已投喂】不是互斥条件：满足任一投喂条件即视为已投喂（2026-11-03 裁决，物品库 05 表 BIO-002）：
    //   路径 A 放牧啃草 / 路径 B 消耗鸡舍内储存饲料 —— 任一达成 lastFed=true。
    //   已投喂 → 产 1 蛋（心情×10% 概率优质蛋）；饥饿 → 心情 -1、不产蛋。
    if (c.kind === 'chicken') {
      // §13.2 友善超载惩罚：友善类收益归 0（除小麦/水稻）——产蛋直接丢弃（2026-11-04 裁决：满额丢弃同口径）
      if (gs.capacity?.friendlyOverloaded) {
        devLog.info('[CreatureSystem] friendlyOverloaded → 产蛋被惩罚丢弃:', c.id);
        continue;
      }
      if (c.lastFed) {
        // OUT-11：鸡蛋储存于来源鸡舍（上限 10），玩家进入鸡舍时取走（InfoPanel 收获滑条）。
        // 2026-11-04 裁决：鸡蛋与优质蛋共享同一储存额度（合计上限 10）；额度满时产出直接丢弃
        //   —— 不进背包、不进任何储存，仅记日志；收获进背包时鸡蛋与优质蛋为两个不同物品分别占格。
        const henTile = c.sourceTileIdx != null ? outerTiles[c.sourceTileIdx] : null;
        if (henTile && henTile.contentId === 'facility_henhouse') {
          henTile.contentState = henTile.contentState || {};
          const cs = henTile.contentState;
          const eggTotal = () => (cs.eggStored || 0) + (cs.eggStoredGolden || 0);
          if (eggTotal() < 10) {
            cs.eggStored = (cs.eggStored || 0) + 1;
            EventBus.emit(GE.TILE_UPDATED, { tileIdx: henTile.idx });
          } else {
            devLog.warn('[CreatureSystem] 鸡舍鸡蛋储存已满(10/10)，本次鸡蛋直接丢弃:', c.id);
          }
          // 优质蛋：心情 ×10%（心情负视为 0%）——OUT-21；与鸡蛋共享同一储存额度，满额同样丢弃
          const qualityChance = Math.max(0, (c.mood || 0) * 0.1);
          if (Random.chance(qualityChance)) {
            if (eggTotal() < 10) {
              cs.eggStoredGolden = (cs.eggStoredGolden || 0) + 1;
              EventBus.emit(GE.TILE_UPDATED, { tileIdx: henTile.idx });
            } else {
              devLog.warn('[CreatureSystem] 鸡舍鸡蛋储存已满(10/10)，本次优质蛋直接丢弃:', c.id);
            }
          }
        } else {
          // 旧存档 / 无鸡舍归属：直接进背包（保持既有行为；两物分别占格）
          InventorySystem.addItem(gs, 'item_egg', 1);
          const qualityChance = Math.max(0, (c.mood || 0) * 0.1);
          if (Random.chance(qualityChance)) {
            InventorySystem.addItem(gs, 'item_golden_egg', 1);
          }
        }
      } else {
        devLog.info('[CreatureSystem] chicken 未投喂 → 不产蛋:', c.id);
      }
    }
  }

  // ── 3) 史莱姆粘液喷吐（完整实装：5% / 超载 15%） ──
  // B-12：物品库 BIO-003「危险生物超容量时改为 15%」—— 条件是"当前数量超容量"本身，
  //   而不是惩罚激活标志（dangerOverloaded 要等警告期 2 天后才为 true）。
  const fenceTilesForCap = (gs.map.fence && gs.map.fence.length) || 1;
  const dangerCapNow = 4 + Math.max(0, fenceTilesForCap - 1);
  const dangerOverCapacity = countByCategory(gs, 'danger') > dangerCapNow;
  const slimeCount = gs.creatures.filter(c => c.category === 'danger' && c.hp > 0).length;
  for (let i = 0; i < slimeCount; i++) {
    const chance = dangerOverCapacity ? 0.15 : 0.05;
    if (Random.chance(chance)) {
      // 选随机 outerTile（合法外圈格）
      const candidates = outerTiles.filter(t => t.idx !== gs.player.x); // 不往玩家当前格喷
      if (candidates.length === 0) break;
      const target = Random.pick(candidates);
      if (!target.states) target.states = [];
      target.states.push({ type: 'slime' });
      EventBus.emit(GE.TILE_UPDATED, { tileIdx: target.idx });
      EventBus.emit(GE.TOAST_SHOW, { text: `🟢 史莱姆喷吐粘液到地块 ${target.idx}`, duration: 1500 });
      devLog.info('[CreatureSystem] slime spit mucus → tile', target.idx);
    }
  }

  // ── 4) 容量超载警告 & 惩罚 ──
  updateCapacityAndPunish(gs);

  // ── 5) 广播容量变化事件 ──
  EventBus.emit(GE.CAPACITY_CHANGE, {
    friendly: countByCategory(gs, 'friendly'),
    danger: countByCategory(gs, 'danger'),
    extreme: countByCategory(gs, 'extreme'),
  });
}

function growUpChick(gs, chick) {
  devLog.info('[CreatureSystem] chick grows up to chicken:', chick.id);
  EventBus.emit(GE.TOAST_SHOW, { text: `${chick.emoji || '🐣'} 长大成 🐔`, duration: 1500 });
  chick.kind = 'chicken';
  chick.stage = 'adult';
  chick.hp = 100;
  chick.maxHp = 100;
  chick.atk = 0;
  chick.growthMax = 0;
  chick.growth = 0;
  chick.mood = 0;
  chick.element = null;
  chick.elementImmune = null;
  chick.emoji = '🐔';
  // 形体变大：半径/速度同步切到成鸡定义（空间几何 §2.2）
  const adultDef = getCreatureDef('chicken');
  if (adultDef) {
    chick.radius = adultDef.radius;
    chick.speedPerTile = adultDef.speedPerTile;
  }
  // 半径 1/6 → 0.25 后圆可能越界：把圆心夹回栅栏合法区域（遗留问题本轮修掉）
  clampCreatureToFence(gs, chick);
}

/**
 * 超载真实伤害（§13.2，2026-11-04 裁决）：对超容量的生物，逐只按
 * 「该生物 100% 基础攻击力」累计真实伤害。
 * 基础攻击力 = getCreatureDef(kind).atk（面板显示数值），不受敌人临时强化影响。
 * 超容量个体取该类生物中最后 N 只（最近导致超载者，spawnCreature 追加在末尾）。
 * @param {GameState} gs
 * @param {'friendly'|'danger'|'extreme'} category
 * @param {number} excess 超出容量的数量
 * @returns {number} 应扣的真实伤害总量
 */
function overloadBaseAtkDamage(gs, category, excess) {
  if (excess <= 0) return 0;
  const list = gs.creatures.filter((c) => c && c.hp > 0 && c.category === category);
  const picks = list.slice(Math.max(0, list.length - excess));
  let total = 0;
  for (const c of picks) total += Math.max(0, getCreatureDef(c.kind)?.atk || 0);
  return total;
}

function updateCapacityAndPunish(gs) {
  const cap = gs.capacity || (gs.capacity = {});
  // P1-2 容量扩格加成（§13.1 / 物品库 05 表头）：栅栏每多 1 格空间 → 友善 +1、危险 +1。
  //   初始栅栏 1 格（§2「初始 3×3：中心 1 格栅栏」），基础容量 友善 4 / 危险 4 / 高危 0。
  const fenceTiles = (gs.map.fence && gs.map.fence.length) || 1;
  const extra = Math.max(0, fenceTiles - 1);
  cap.friendly = 4 + extra;
  cap.danger = 4 + extra;
  cap.extreme = 0;
  cap.friendlyOverdue = cap.friendlyOverdue ?? 0;
  cap.dangerOverdue = cap.dangerOverdue ?? 0;
  cap.extremeOverdue = cap.extremeOverdue ?? 0;

  const friendlyCount = countByCategory(gs, 'friendly');
  const dangerCount = countByCategory(gs, 'danger');
  const extremeCount = countByCategory(gs, 'extreme');

  // 友善（§13.2：发生当天为第 1 天，警告期 2 天，警告期结束仍超载即惩罚 → 第 2 次结算触发）
  if (friendlyCount > cap.friendly) {
    cap.friendlyOverdue += 1;
    if (cap.friendlyOverdue >= 2) {
      devLog.warn('[CreatureSystem] friendly OVERLOAD punishment triggered');
      // 友善类收益归 0 —— 我们不直接改 facility 产出，而是挂 gs.capacity.friendlyOverloaded=true
      // 让 wheat/rice/strawberry/pea/henhouse 在 onDailyStart 里检查这个 flag（Phase 3 DaySystem 要改）
      cap.friendlyOverloaded = true;
    }
  } else {
    cap.friendlyOverdue = 0;
    cap.friendlyOverloaded = false;
  }

  // 危险（§13.2：警告期 2 天，第 2 次结算仍超载即惩罚）
  if (dangerCount > cap.danger) {
    cap.dangerOverdue += 1;
    if (cap.dangerOverdue >= 2) {
      devLog.warn('[CreatureSystem] danger OVERLOAD punishment triggered');
      cap.dangerOverloaded = true;
      // §13.2（2026-11-04 裁决）：对每只超容量生物按「100% 基础攻击力」扣真实伤害
      //   基础攻击力 = 面板显示数值（getCreatureDef(kind).atk），不受敌人临时强化影响
      const loss = overloadBaseAtkDamage(gs, 'danger', dangerCount - cap.danger);
      if (loss > 0) {
        CombatSystem.applyTrueDamageToPlayer(gs, gs.player, loss, { reason: 'danger_overload' });
        EventBus.emit(GE.TOAST_SHOW, { text: `⚠️ 危险生物超载！每日开始按超容量生物基础攻击力 100% 扣真实伤害（本次 -${loss} ❤️）`, duration: 2500 });
      }
    }
  } else {
    cap.dangerOverdue = 0;
    cap.dangerOverloaded = false;
  }

  // 高危（预留，Phase 3 没生成）
  if (extremeCount > cap.extreme) {
    cap.extremeOverdue += 1;
    if (cap.extremeOverdue >= 2) {
      cap.extremeOverloaded = true;
      // §13.2（2026-11-04 裁决）：真伤部分同样按「100% 基础攻击力」口径
      const loss = overloadBaseAtkDamage(gs, 'extreme', extremeCount - cap.extreme);
      if (loss > 0) CombatSystem.applyTrueDamageToPlayer(gs, gs.player, loss, { reason: 'extreme_overload' });

      // ── Agent 3：高危超载 → 拆 2 个地块内容（除了永恒设施 facility_home） ──
      const nonHomeTiles = (gs.map.outerTiles || []).filter(
        t => t.contentId && t.contentId !== 'facility_home'
      );
      const demolishCount = Math.min(2, nonHomeTiles.length);
      for (let i = 0; i < demolishCount; i++) {
        const pick = Random.pick(nonHomeTiles);
        nonHomeTiles.splice(nonHomeTiles.indexOf(pick), 1);
        const lost = pick.contentId;
        pick.contentId = null;
        EventBus.emit(GE.TILE_UPDATED, { tileIdx: pick.idx });
        EventBus.emit(GE.TOAST_SHOW, { text: `💥 高危超载！拆毁 ${lost}${loss > 0 ? `，并扣 ${loss} ❤️ 真伤` : ''}`, duration: 2500 });
        devLog.info('[CreatureSystem] extreme overload → demolish tile', pick.idx, 'content', lost);
      }
    }
  } else {
    cap.extremeOverdue = 0;
    cap.extremeOverloaded = false;
  }

  EventBus.emit(GE.CAPACITY_CHANGE, {
    friendly: friendlyCount, danger: dangerCount, extreme: extremeCount,
    friendlyOverloaded: cap.friendlyOverloaded, dangerOverloaded: cap.dangerOverloaded,
  });
}

/**
 * 把饲料存入鸡舍（背包 → tile.contentState.henhouseFeed）。
 * §13.3 / FAC-009：鸡优先消耗鸡舍内储存的稻草/小麦。
 * 2026-11-04 裁决③：真实 UI 入口已接入 InfoPanel 鸡舍功能选项「投放饲料」，与取回逻辑对称。
 * @returns {{ ok: boolean, reason?: string, deposited?: number }}
 */
export function depositHenhouseFeed(gs, tileIdx, itemId, qty = 1) {
  const tile = gs.map.outerTiles[tileIdx];
  if (!tile || tile.contentId !== 'facility_henhouse') return { ok: false, reason: 'notHenhouse' };
  if (itemId !== 'item_rice_straw' && itemId !== 'item_wheat') return { ok: false, reason: 'notFeed' };
  const n = Math.min(qty, InventorySystem.countItem(gs, itemId));
  if (n <= 0) return { ok: false, reason: 'noItem' };
  InventorySystem.removeItem(gs, itemId, n);
  tile.contentState = tile.contentState || {};
  const store = tile.contentState.henhouseFeed || (tile.contentState.henhouseFeed = {});
  store[itemId] = (store[itemId] || 0) + n;
  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  devLog.info('[CreatureSystem] depositHenhouseFeed', itemId, 'x', n, '→ tile', tileIdx);
  return { ok: true, deposited: n };
}

/**
 * 把饲料从鸡舍取回背包（tile.contentState.henhouseFeed → 背包），投放的逆操作。
 * @returns {{ ok: boolean, reason?: string, withdrawn?: number }}
 */
export function withdrawHenhouseFeed(gs, tileIdx, itemId, qty = 1) {
  const tile = gs.map.outerTiles[tileIdx];
  if (!tile || tile.contentId !== 'facility_henhouse') return { ok: false, reason: 'notHenhouse' };
  if (itemId !== 'item_rice_straw' && itemId !== 'item_wheat') return { ok: false, reason: 'notFeed' };
  const store = tile.contentState?.henhouseFeed || {};
  const n = Math.min(qty, store[itemId] || 0);
  if (n <= 0) return { ok: false, reason: 'noStore' };
  store[itemId] -= n;
  InventorySystem.addItem(gs, itemId, n);
  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  devLog.info('[CreatureSystem] withdrawHenhouseFeed', itemId, 'x', n, '← tile', tileIdx);
  return { ok: true, withdrawn: n };
}

export const CreatureSystem = {
  spawnCreature,
  stepCreatures,
  advanceCreatureRendering,
  clampCreatureToFence,
  dailyTick,
  feedCreature,
  grantKillDrops,
  depositHenhouseFeed,
  withdrawHenhouseFeed,
  resetCreatureIdCounter,
};
