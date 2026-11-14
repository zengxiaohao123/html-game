// src/systems/CreatureSystem.js
// Phase 3 —— 生物系统（阶段 2：连续积分移动）
//   spawnCreature(kind)    —— 生成 1 只，放入栅栏合法点（允许完全重叠）
//   stepCreatures(gs, dtSec) —— 固定 200ms 逻辑步内的连续积分（pos），由 RealtimeClock 驱动
//   advanceCreatureRendering(gs, dtSec) —— 每帧推进 renderPos（不参与判定，结算期间也不停）
//   feedCreature(gs, creatureId) —— 投喂逻辑（简化）
//   onDayEnd(gs)          —— 【每一日结束时】（day++ 之前）：鸡舍喂食 → 成长/心情/产蛋判定
//   onDayStart(gs)        —— 【每一日开始时】（day++ 之后）：需要投喂的生物统一转【饥饿】+ 史莱姆粘液 + 容量警告
//
// 运动模型（设计文档 §2.3 / §18.3）：
//   - pos 连续逻辑坐标（判定权威），renderPos 渲染插值位置；
//   - speedPerTile = 秒/格（3~6 秒/格），dir = 弧度（任意方向）；
//   - 走走停停状态机（Idle ⇄ Walk）：大部分时间连续缓慢走动、偶尔停下；
//     到达后可按 chainWalkChance 连续走多段再停；所有时长/距离/转向参数见
//     src/data/creatureBehavior.js（逻辑层不写死数值）；
//   - 只裁剪栅栏边界（圆心 + 半径不出栅栏），生物之间不碰撞、不分离、允许重叠。
//   - 撞边安全（2026-11-07）：目标点用射线可达距离（绝不落在界外/不可达），
//     任何时刻都不允许停在 Walk 状态却零位移（真被完全挡住则转 Idle）。
//   - 连续速度积分（2026-11-07 观感修订，用户裁定）：
//     ① pos 只按「速度 × 时间」积分推进（vx/vy 单位 格/秒），撞墙也不 override pos：
//        沿速度走到边界接触点为止，绝不瞬移、绝不被 clamp 吸到边界；
//     ② renderPos 不再独立模拟，而是对「上一步 pos → 当前 pos」做线性插值，
//        两个端点同属一次合法积分，因此既平滑、又不会漂移/回拉/被吸附；
//     ③ 进入 Idle 先按 stopDecelS 线性刹车到 0，再真正静止；起步按 startAccelS 平滑加速；
//     ④ 撞墙做真实回弹：法线分量以 bounceRestitution 反射、切向按 bounceTangentialKeep 保留，
//        回弹速度按 bounceDamping 快速衰减，回弹 bounceS 秒后再做撞墙重决策（Idle / 换向）。
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
import { getBehaviorProfile, resolveBehavior } from '../data/creatureBehavior.js';
import { ITEMS } from '../data/items.js';
import { normalizeTerrain } from '../data/terrains.js';
import { InventorySystem } from './InventorySystem.js';
import { CombatSystem } from './CombatSystem.js';
import { fenceDimsOf, outerIdxToXY } from '../core/Distance.js';
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

// ── 门禁设施（鸡舍 / 史莱姆屋）：开门 / 关门只作用于「归属该设施实例」的生物 ──
export const DOOR_FACILITIES = new Set(['facility_henhouse', 'facility_slimehouse']);

/**
 * 放养进食规则（§13.4）：只有草食生物（数据标记 `feedByGrass`）会吃草；
 * 每只每日至多消耗 1 草元素量（1 次 = 地块元素量 -1，不走背包），
 * 吃到即进入【已投喂】，本日内不再继续吃草；次日开始时统一转回【饥饿】。
 */
export const GRASS_ELEMENTS_PER_CREATURE_PER_DAY = 1;

/** 该生物是否需要投喂（数据驱动：`feedByGrass`） */
function isFeedableCreature(c) {
  return !!c && !!getCreatureDef(c.kind)?.feedByGrass;
}

// ── 设施归属：稳定实例 uid 为主键，裸索引仅作旧存档回退 ──
// 扩建会整体重排外圈 idx；地块对象本身会被搬运，因此「设施实例 uid」不随索引变化。
let _nextTileUid = 1;

/** 给设施/地块分配稳定 uid（就地写入并返回） */
export function ensureTileUid(tile) {
  if (!tile) return null;
  if (!tile.uid) tile.uid = `fac_${_nextTileUid++}`;
  return tile.uid;
}

/** 解析某生物当前归属的设施地块（优先 uid，其次裸索引回退） */
export function creatureOwnerTile(gs, c) {
  if (!c) return null;
  const outer = gs?.map?.outerTiles || [];
  if (c.sourceTileUid) {
    const byUid = outer.find(t => t && t.uid === c.sourceTileUid);
    if (byUid) return byUid;
  }
  if (Number.isInteger(c.sourceTileIdx)) return outer[c.sourceTileIdx] || null;
  return null;
}

/** 生物是否归属指定设施/地块实例（与物种无关；野生生物两边都为空 → false） */
export function creatureOwnedByTile(gs, c, tile) {
  if (!c || !tile) return false;
  if (c.sourceTileUid && tile.uid) return c.sourceTileUid === tile.uid;
  return Number.isInteger(c.sourceTileIdx) && c.sourceTileIdx === tile.idx;
}

/**
 * 某设施实例归属的生物（优先稳定 uid，扩建后仍指向同一座设施）。
 * 野生生物（狩猎等来源）无归属，永远不在此列表内。
 * @returns {object[]}
 */
export function facilityOwnedCreatures(gs, tileIdx, { aliveOnly = true } = {}) {
  if (!Array.isArray(gs?.creatures) || tileIdx === null || tileIdx === undefined) return [];
  const tile = gs?.map?.outerTiles?.[tileIdx];
  if (!tile) return [];
  return gs.creatures.filter(c => {
    if (!c) return false;
    if (aliveOnly && !(c.hp > 0 && !c.dead)) return false;
    return creatureOwnedByTile(gs, c, tile);
  });
}

/** 解析扩建事件里的「旧索引 → 新索引」映射（优先用扩建系统提供的 API，缺失时按同一套搬运规则推导） */
function resolveExpandIdxMap(payload) {
  const raw = payload?.idxMap;
  if (raw instanceof Map) return raw;
  if (Array.isArray(raw)) {
    const m = new Map();
    for (const pair of raw) {
      if (pair && Number.isInteger(pair[0]) && Number.isInteger(pair[1])) m.set(pair[0], pair[1]);
    }
    return m.size ? m : null;
  }
  if (raw && typeof raw === 'object') {
    const m = new Map();
    for (const [k, v] of Object.entries(raw)) {
      if (Number.isInteger(Number(k)) && Number.isInteger(Number(v))) m.set(Number(k), Number(v));
    }
    return m.size ? m : null;
  }

  // 回退：由 axis + 扩建后的行列数推导（与 MapExpandSystem 的搬运规则一致）
  const { rows, cols, axis } = payload || {};
  if (!Number.isInteger(rows) || !Number.isInteger(cols)) return null;
  const isLength = axis === 'length';
  const oldRows = payload.oldRows ?? (isLength ? rows : rows - 1);
  const oldCols = payload.oldCols ?? (isLength ? cols - 1 : cols);
  if (oldRows < 2 || oldCols < 2) return null;

  const newByXY = new Map();
  for (const t of payload.gs?.map?.outerTiles || []) {
    if (!Number.isInteger(t?.idx)) continue;
    const { x, y } = outerIdxToXY({ rows, cols }, t.idx);
    newByXY.set(`${x},${y}`, t.idx);
  }
  const idxMap = new Map();
  const totalOld = 2 * oldRows + 2 * oldCols - 4;
  for (let oldIdx = 0; oldIdx < totalOld; oldIdx++) {
    const { x, y } = outerIdxToXY({ rows: oldRows, cols: oldCols }, oldIdx);
    const nx = isLength ? (x === oldCols - 1 ? x + 1 : x) : x;
    const ny = isLength ? y : (y === 0 ? 0 : y + 1);
    const next = newByXY.get(`${nx},${ny}`);
    if (next !== undefined) idxMap.set(oldIdx, next);
  }
  return idxMap.size ? idxMap : null;
}

/**
 * 收到 MAP_EXPANDED：把生物的归属索引重映射到新 idx，并把旧存档生物升级为稳定 uid 归属。
 * 不修改 MapExpandSystem；若扩建系统已在事件里带上 idxMap 则直接复用。
 */
export function remapCreatureOwnershipAfterExpand(payload) {
  const gs = payload?.gs;
  const map = gs?.map;
  if (!map?.outerTiles) return;
  const idxMap = resolveExpandIdxMap(payload);

  for (const c of gs.creatures || []) {
    if (!c || !Number.isInteger(c.sourceTileIdx)) continue;
    // 若稳定 uid 已指向当前索引上的同一地块，说明归属已正确（防止重复重映射）
    const cur = map.outerTiles[c.sourceTileIdx];
    if (c.sourceTileUid && cur && cur.uid === c.sourceTileUid) continue;
    if (!idxMap) continue;
    const next = idxMap.get(c.sourceTileIdx);
    if (next === undefined) {
      c.sourceTileIdx = null; // 索引已失效，无法归属
      continue;
    }
    c.sourceTileIdx = next;
    if (!c.sourceTileUid) c.sourceTileUid = ensureTileUid(map.outerTiles[next]);
  }

  // 并行扩建可能把栅栏格缓存写成生物对象；统一修正为 id 数组，保证开关门/信息区查询可用
  for (const f of map.fence || []) {
    if (!Array.isArray(f.creatures)) { f.creatures = []; continue; }
    f.creatures = f.creatures
      .map(x => (x && typeof x === 'object' ? x.id : x))
      .filter(Boolean);
  }
}

EventBus.on(GE.MAP_EXPANDED, remapCreatureOwnershipAfterExpand);

// ── 运动参数 ──
/** 秒/格 合法区间（设计文档 §2.3：3~6 秒走 1 格） */
export const MIN_SECONDS_PER_TILE = 3;
export const MAX_SECONDS_PER_TILE = 6;

/**
 * 生成 1 只生物
 * @param {object} gs
 * @param {string} kind          creatures.js 里定义的 kind：'chick' / 'slime_fire' 等
 * @param {object} [opts]
 * @param {string} [opts.facilityId] 来源设施（facility_henhouse / facility_slimehouse），用于每日心情 +1
 * @param {number} [opts.sourceTileIdx] 来源设施所在外圈格 idx（同时写入稳定 uid，扩建后归属不丢）
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

  // 归属设施实例：稳定 uid（扩建时地块对象被整体搬运，uid 不随外圈 idx 变化）
  const sourceTile = opts.sourceTileIdx != null ? gs.map?.outerTiles?.[opts.sourceTileIdx] : null;
  const sourceTileUid = sourceTile ? ensureTileUid(sourceTile) : null;

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
    // 运动：dir = 弧度（任意方向）；speedPerTile = 秒/格；
    // 行为状态机：behaviorState = 'idle' | 'walk'，stateLeft = 当前状态剩余秒数。
    // 初始 Idle 时长取 [0, idleMaxS] 随机错峰，避免同一帧全体起步。
    dir,
    speedPerTile: typeof def.speedPerTile === 'number' && def.speedPerTile > 0
      ? def.speedPerTile
      : defaultSecondsPerTile(),
    behaviorState: 'idle',
    stateLeft: Math.random() * getBehaviorProfile(def.kind).idleMaxS,
    targetPos: null,
    idleTurnLeft: rand(0.5, 2.5),
    // 速度向量（格/秒）：pos 只按「速度 × 时间」连续积分（撞墙回弹也走这条路径）；
    // 生成时是 Idle，速度从 0 起步，由 beginWalk 后的 startAccelS 平滑加速
    vx: 0,
    vy: 0,
    // 渲染插值位置：只在上一步 pos → 当前 pos 之间插值，不再独立模拟（避免漂移/吸附）
    renderPos: { x: pos.x, y: pos.y },
    renderFrom: { x: pos.x, y: pos.y },
    renderT: 0,
    renderDur: 0.2,
    // 起步加速 / 停车制动 / 撞墙回弹计时（秒）
    brakeLeft: 0,
    brakeSpeed0: 0,
    bounceLeft: 0,
    hp: def.hp,
    maxHp: def.hp,
    atk: def.atk,
    element: def.element,
    elementImmune: def.elementImmune,
    category: def.category,
    growth: 0,
    growthMax: def.growthMax || 0,
    mood: def.mood || 0,
    // 投喂状态（§13.4）：新获得的需投喂生物统一为【饥饿】；非投喂型生物不写该字段
    ...(def.feedByGrass ? { lastFed: false } : {}),
    stage: def.stage || 'chick',
    facilityId: opts.facilityId || null,
    sourceTileIdx: opts.sourceTileIdx ?? null,
    sourceTileUid,
    lastMoveTs: Date.now(),
    activeBuffs: [],
  };

  // 加入 gs
  gs.creatures.push(creature);
  tile.creatures = tile.creatures || [];
  tile.creatures.push(creature.id);

  // 设施门关闭时新生成的归属生物直接收纳（不可见、不移动，但仍计入容量）
  if (creature.sourceTileUid || creature.sourceTileIdx !== null) {
    const src = creatureOwnerTile(gs, creature);
    if (src && DOOR_FACILITIES.has(src.contentId) && (src.contentState || {}).doorOpen === false) {
      putCreatureIntoHouse(gs, creature);
    }
  }

  // 更新容量计数（超出也允许生成，warn 由 onDayStart 报）
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

export function countByCategory(gs, category) {
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

/** 区间随机数（[lo, hi)） */
function rand(lo, hi) {
  if (hi <= lo) return lo;
  return lo + Math.random() * (hi - lo);
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
  // 插值起点同步复位，避免「夹回」之后渲染层把旧位置再插值回来（视觉回拉）
  creature.renderFrom = { x: creature.pos.x, y: creature.pos.y };
  creature.renderT = Number.isFinite(creature.renderDur) ? creature.renderDur : 0.2;
  return creature;
}

// ────────────────────────────────────────────────────────────
// 走走停停行为状态机（Idle ⇄ Walk）
//   参数全部来自 src/data/creatureBehavior.js，逻辑层不写死时长/距离。
// ────────────────────────────────────────────────────────────

/** 生物实际速度（秒/格）；缺字段时用区间中值兜底 */
function secondsPerTileOf(creature) {
  const v = creature?.speedPerTile;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : defaultSecondsPerTile();
}

/** 巡航速度（格/秒）= 1 / speedPerTile */
function cruiseSpeedOf(creature) {
  return 1 / secondsPerTileOf(creature);
}

/** 当前速度模长（格/秒） */
function speedOf(creature) {
  const vx = Number.isFinite(creature?.vx) ? creature.vx : 0;
  const vy = Number.isFinite(creature?.vy) ? creature.vy : 0;
  return Math.hypot(vx, vy);
}

/** 当前速度方向（弧度）；速度≈0 时保留原 dir */
function syncHeadingFromVelocity(creature) {
  if (speedOf(creature) <= 1e-9) return;
  creature.dir = Math.atan2(creature.vy, creature.vx);
}

/** 行走态判定；旧实例（无 behaviorState）按阶段 2 语义视为行走 */
function isWalking(creature) {
  return creature?.behaviorState !== 'idle';
}

/** 兼容旧实例 / 运行期手工构造的实例：补齐行为字段（不覆盖已有值） */
function ensureBehaviorState(creature, profile) {
  if (creature.behaviorState !== 'idle' && creature.behaviorState !== 'walk') {
    creature.behaviorState = isWalking(creature) && creature.targetPos ? 'walk' : 'idle';
  }
  if (typeof creature.stateLeft !== 'number' || !Number.isFinite(creature.stateLeft) || creature.stateLeft < 0) {
    creature.stateLeft = creature.behaviorState === 'idle'
      ? rand(profile.idleMinS, profile.idleMaxS)
      : 0;
  }
  if (typeof creature.idleTurnLeft !== 'number' || !Number.isFinite(creature.idleTurnLeft)) {
    creature.idleTurnLeft = rand(0.5, 2.5);
  }
  // 速度向量：旧实例没有 vx/vy 时按「当前状态 + dir」补齐
  if (!Number.isFinite(creature.vx) || !Number.isFinite(creature.vy)) {
    const sp = creature.behaviorState === 'walk' ? cruiseSpeedOf(creature) : 0;
    const dir = Number.isFinite(creature.dir) ? creature.dir : 0;
    creature.vx = Math.cos(dir) * sp;
    creature.vy = Math.sin(dir) * sp;
  }
  if (!Number.isFinite(creature.brakeLeft) || creature.brakeLeft < 0) creature.brakeLeft = 0;
  if (!Number.isFinite(creature.brakeSpeed0)) creature.brakeSpeed0 = 0;
  if (!Number.isFinite(creature.bounceLeft) || creature.bounceLeft < 0) creature.bounceLeft = 0;
  if (!creature.renderFrom || !Number.isFinite(creature.renderFrom.x) || !Number.isFinite(creature.renderFrom.y)) {
    creature.renderFrom = { x: creature.pos.x, y: creature.pos.y };
  }
  if (!Number.isFinite(creature.renderT)) creature.renderT = 0;
  if (!Number.isFinite(creature.renderDur) || creature.renderDur <= 0) creature.renderDur = 0.2;
}

/** 回弹物理参数（见行为参数表：bounceRestitution / bounceTangentialKeep / bounceDamping） */
function bouncePhysicsOf(profile) {
  return {
    restitution: Number.isFinite(profile?.bounceRestitution) ? profile.bounceRestitution : 0.45,
    tangential: Number.isFinite(profile?.bounceTangentialKeep) ? profile.bounceTangentialKeep : 0.85,
    damping: Number.isFinite(profile?.bounceDamping) && profile.bounceDamping > 0 ? profile.bounceDamping : 4,
  };
}

/** 沿 angle 方向在合法矩形内还能走多远（射线到边界的距离；已贴边朝外 → 0） */
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

/** 朝合法区中心的精确方向（从边界出发时，该射线必穿过整个合法区） */
function towardCenterAngle(creature, inner) {
  const cx = (inner.x0 + inner.x1) / 2;
  const cy = (inner.y0 + inner.y1) / 2;
  const a = Math.atan2(cy - creature.pos.y, cx - creature.pos.x);
  return Number.isFinite(a) ? normalizeAngle(a) : rand(0, Math.PI * 2);
}

/** 朝合法区内部的兜底方向（保底带朝内法向分量，不会被墙再次挡住） */
function inwardAngle(creature, inner) {
  return normalizeAngle(towardCenterAngle(creature, inner) + rand(-0.35, 0.35));
}

/**
 * 「撞墙后新方向必须无墙可走的最小距离」（§2.3）：
 *   max(wallFreeMinDist, wallFreeHorizonS / speedPerTile)
 * 即「按当前速度至少能连续走 wallFreeHorizonS 秒而不碰到任何一面栅栏」。
 * @param {object} profile
 * @param {number} secondsPerTile 秒/格
 */
export function wallFreeDistanceOf(profile, secondsPerTile) {
  const horizonS = Number.isFinite(profile?.wallFreeHorizonS) ? profile.wallFreeHorizonS : 1.5;
  const minDist = Number.isFinite(profile?.wallFreeMinDist) ? profile.wallFreeMinDist : 0.5;
  const spt = Number.isFinite(secondsPerTile) && secondsPerTile > 0 ? secondsPerTile : 1;
  return Math.max(minDist, horizonS / spt);
}

/**
 * 撞墙后的即时重决策（在撞墙的同一个逻辑步内调用，二选一由调用方抽取 Idle 概率）：
 *   - 在任意弧度上采样（先试「朝合法区中心」，再均匀全角度采样），只保留
 *     「沿该方向至少 wallFreeThreshold 格内不会碰到任何一面栅栏」的方向；
 *   - 有可行方向 → 返回 { angle, dist }（dist 同时不超过该方向可达距离）；
 *   - 一个可行方向都没有 → 返回 null（调用方必须进 Idle，不得原地反复尝试）。
 */
function decideAfterWallHit(creature, profile, inner) {
  const threshold = wallFreeDistanceOf(profile, secondsPerTileOf(creature));
  const want = Math.random() < profile.longWalkChance
    ? rand(profile.longWalkDistMin, profile.longWalkDistMax)
    : rand(profile.walkDistMin, profile.walkDistMax);

  // 候选：① 精确朝合法区中心；② 以随机相位均匀铺满 2π（任意弧度，不限上下左右）
  const candidates = [towardCenterAngle(creature, inner)];
  const offset = rand(0, Math.PI * 2);
  const SAMPLES = 24;
  for (let i = 0; i < SAMPLES; i++) {
    candidates.push(normalizeAngle(offset + (i / SAMPLES) * Math.PI * 2));
  }

  const usable = [];
  for (const angle of candidates) {
    const room = roomAlong(creature.pos.x, creature.pos.y, angle, inner);
    if (room < threshold) continue;
    usable.push({ angle, dist: Math.min(want, room) });
  }
  if (usable.length === 0) return null;
  return usable[Math.floor(rand(0, usable.length)) % usable.length];
}

/**
 * 挑一个行走目标点（保证可达、且实际位移 >= minStep）。
 *   常规：沿当前朝向 ± walkAngleJitter 的方向走 walkDist 距离（保持方向连贯）；
 *   远走：longWalkChance 命中时全随机方向 + longWalkDist 距离（「偶尔朝随机方向走一段」）。
 * 距离取 min(期望距离, 该方向到边界的可达距离)：目标点永远在合法区内、永远可达，
 * 不会出现「目标点全在界外 / 目标夹到墙上导致实际走不动」。
 * @returns {{x:number, y:number, dist:number, angle:number}}
 */
function pickWalkTarget(creature, profile, inner) {
  const isLong = Math.random() < profile.longWalkChance;
  const want = isLong
    ? rand(profile.longWalkDistMin, profile.longWalkDistMax)
    : rand(profile.walkDistMin, profile.walkDistMax);
  // 一步太小会退化成「原地挪一下」，这种方向直接淘汰（合法区最窄 0.5 格，必有可达方向）
  const minStep = Math.max(profile.arriveEps, 0.15);
  const baseDir = Number.isFinite(creature.dir) ? creature.dir : rand(0, Math.PI * 2);
  const smallJitter = () => baseDir + (Math.random() * 2 - 1) * profile.walkAngleJitter;

  // 候选：① 沿当前朝向（保持连贯）；② 偏一点；③ 全随机换向（避免贴墙时只朝一个方向抽签）
  const candidates = [];
  candidates.push(isLong ? rand(0, Math.PI * 2) : smallJitter());
  for (let i = 0; i < 8; i++) candidates.push(rand(0, Math.PI * 2));

  for (const angle of candidates) {
    const room = roomAlong(creature.pos.x, creature.pos.y, angle, inner);
    if (room < minStep) continue;
    const dist = Math.min(want, room);
    return {
      x: creature.pos.x + Math.cos(angle) * dist,
      y: creature.pos.y + Math.sin(angle) * dist,
      dist,
      angle,
    };
  }

  // 极小栅栏 / 贴角：指向合法区中心（合法区宽度 > minStep 时必定可达）
  const angle = inwardAngle(creature, inner);
  const room = roomAlong(creature.pos.x, creature.pos.y, angle, inner);
  const dist = Math.min(want, Math.max(room, 0));
  return {
    x: creature.pos.x + Math.cos(angle) * dist,
    y: creature.pos.y + Math.sin(angle) * dist,
    dist,
    angle,
  };
}

/**
 * 窄栏加成：合法圆心区可用跨度越小，Idle 越短。
 * 1×1 栅栏跨度只有 0.5 格，若 Idle 仍按大栏时长，观感会退化成「站着不动」；
 * 这里按 span / narrowPenRefSpan 线性缩短（下限 narrowPenIdleMinScale）。
 */
function idleDurationScale(profile, inner) {
  if (!inner) return 1;
  const span = Math.min(inner.x1 - inner.x0, inner.y1 - inner.y0);
  const ref = Number.isFinite(profile.narrowPenRefSpan) && profile.narrowPenRefSpan > 0
    ? profile.narrowPenRefSpan
    : 1.5;
  const minScale = Number.isFinite(profile.narrowPenIdleMinScale)
    ? profile.narrowPenIdleMinScale
    : 1;
  return clamp(span / ref, minScale, 1);
}

/**
 * 进入长站/短停：先按 stopDecelS 平滑刹车到速度 0（位置仍连续积分），再真正静止。
 * 速度不是瞬间归零 —— 否则视觉上会像「被吸附/急停」。
 */
function beginIdle(creature, profile, inner = null) {
  creature.behaviorState = 'idle';
  creature.targetPos = null;
  creature.bounceLeft = 0;
  const sp = speedOf(creature);
  const decelS = Number.isFinite(profile.stopDecelS) && profile.stopDecelS > 0 ? profile.stopDecelS : 0.28;
  creature.brakeSpeed0 = sp;
  creature.brakeLeft = sp > 1e-6 ? decelS : 0;
  if (creature.brakeLeft === 0) {
    creature.vx = 0;
    creature.vy = 0;
  }
  const isShortPause = Math.random() < profile.shortPauseChance;
  const duration = (isShortPause
    ? rand(profile.shortPauseMinS, profile.shortPauseMaxS)
    : rand(profile.idleMinS, profile.idleMaxS)) * idleDurationScale(profile, inner);
  creature.stateLeft = duration;
  // 静止期间安排一次小幅转头（不产生位移；圆形不渲染朝向，因此无 DOM 更新）
  creature.idleTurnLeft = rand(0.6, Math.min(3.0, Math.max(0.8, duration)));
}

/** 进入行走：挑目标点并设置安全超时（撞边由 stepWalk 处理，不会提前空转） */
function beginWalk(gs, creature, profile) {
  const inner = fenceInner(gs, creatureRadius(creature));
  const pick = pickWalkTarget(creature, profile, inner);
  creature.behaviorState = 'walk';
  creature.targetPos = { x: pick.x, y: pick.y };
  creature.stateLeft = pick.dist * secondsPerTileOf(creature) * 1.6 + 0.8;
  creature.idleTurnLeft = 0;
  // 刹车未结束就重新起步：取消刹车，速度从当前值平滑加速回巡航（不瞬间跳变）
  creature.brakeLeft = 0;
  creature.bounceLeft = 0;
}

/**
 * 结束一段行走：按 chainWalkChance 立刻接下一段（连续移动观感），否则进 Idle。
 * 一「停」之前平均连续走 1/(1-chainWalkChance) 段。
 */
function finishWalk(gs, creature, profile) {
  const chain = Number.isFinite(profile.chainWalkChance) ? profile.chainWalkChance : 0;
  if (chain > 0 && Math.random() < chain) {
    beginWalk(gs, creature, profile);
    return;
  }
  beginIdle(creature, profile, fenceInner(gs, creatureRadius(creature)));
}

/**
 * 按当前速度向量连续积分 dtSec（格/秒 × 秒）。
 *   位置永远只走到「边界接触点」为止，绝不越过再被 clamp 覆盖 → 无瞬移；
 *   撞到某一面墙时，法线分量按 restitution 反射、切向按 tangential 保留（真实回弹）。
 * @returns {boolean} 本步是否发生了撞墙接触
 */
function integrateMotion(creature, inner, dtSec, physics) {
  const restitution = physics?.restitution ?? 0.45;
  const tangential = physics?.tangential ?? 0.85;
  let remain = dtSec;
  let hit = false;

  for (let iter = 0; iter < 3 && remain > 1e-9; iter++) {
    const vx = Number.isFinite(creature.vx) ? creature.vx : 0;
    const vy = Number.isFinite(creature.vy) ? creature.vy : 0;
    if (Math.hypot(vx, vy) <= 1e-12) break;

    const tx = vx > 1e-9 ? (inner.x1 - creature.pos.x) / vx
      : vx < -1e-9 ? (inner.x0 - creature.pos.x) / vx : Infinity;
    const ty = vy > 1e-9 ? (inner.y1 - creature.pos.y) / vy
      : vy < -1e-9 ? (inner.y0 - creature.pos.y) / vy : Infinity;
    const tHit = Math.min(tx, ty);

    if (tHit >= remain) {
      creature.pos.x = clamp(creature.pos.x + vx * remain, inner.x0, inner.x1);
      creature.pos.y = clamp(creature.pos.y + vy * remain, inner.y0, inner.y1);
      remain = 0;
      break;
    }

    // 只走到边界接触点（t 为到达边界所需时间，绝不超过本步剩余时间）
    const t = Math.max(0, Math.min(tHit, remain));
    creature.pos.x = clamp(creature.pos.x + vx * t, inner.x0, inner.x1);
    creature.pos.y = clamp(creature.pos.y + vy * t, inner.y0, inner.y1);

    // 真实回弹：法线分量反转并衰减；只撞单面时另一分量按切向保留率衰减
    const hitX = tx <= tHit + 1e-9;
    const hitY = ty <= tHit + 1e-9;
    let nvx = vx;
    let nvy = vy;
    if (hitX) nvx = -vx * restitution;
    if (hitY) nvy = -vy * restitution;
    if (hitX && !hitY) nvy = vy * tangential;
    if (hitY && !hitX) nvx = vx * tangential;
    creature.vx = nvx;
    creature.vy = nvy;
    hit = true;
    remain -= t;
    if (t <= 1e-9 && iter === 2) break; // 极端贴角时防止死循环
  }
  return hit;
}

/** Idle 一步：平滑刹车（位置仍连续积分）→ 倒计时 + 偶尔小幅转头 → 归零后出发 */
function stepIdle(gs, creature, profile, dtSec) {
  // ① 刹车：stopDecelS 内速度线性衰减到 0，位移按平均速度积分（不会一帧内瞬停）
  if (creature.brakeLeft > 0 && creature.brakeSpeed0 > 1e-6) {
    const total = Number.isFinite(profile.stopDecelS) && profile.stopDecelS > 0 ? profile.stopDecelS : 0.28;
    const prevLeft = creature.brakeLeft;
    const nextLeft = Math.max(0, prevLeft - dtSec);
    const avgSpeed = creature.brakeSpeed0 * ((prevLeft + nextLeft) / 2) / total;
    const mag = speedOf(creature);
    if (avgSpeed > 1e-9 && mag > 1e-9) {
      const k = avgSpeed / mag;
      const prevVx = creature.vx;
      const prevVy = creature.vy;
      creature.vx = prevVx * k;
      creature.vy = prevVy * k;
      integrateMotion(creature, fenceInner(gs, creatureRadius(creature)), dtSec, { restitution: 0, tangential: 1 });
      creature.vx = prevVx;
      creature.vy = prevVy;
    }
    creature.brakeLeft = nextLeft;
    if (nextLeft <= 0) {
      creature.brakeLeft = 0;
      creature.vx = 0;
      creature.vy = 0;
    }
  }

  creature.stateLeft -= dtSec;

  if (creature.stateLeft > 0 && profile.idleTurnChance > 0 && profile.idleTurnMaxRad > 0) {
    creature.idleTurnLeft -= dtSec;
    if (creature.idleTurnLeft <= 0) {
      if (Math.random() < profile.idleTurnChance) {
        const delta = (Math.random() * 2 - 1) * profile.idleTurnMaxRad;
        creature.dir = normalizeAngle((Number.isFinite(creature.dir) ? creature.dir : 0) + delta);
      }
      creature.idleTurnLeft = rand(1.2, 3.2);
    }
  }

  if (creature.stateLeft <= 0) beginWalk(gs, creature, profile);
}

/** 位移后的地块归属 / 啃草结算（返回是否触发地块内容变化） */
function applyTerrainChange(gs, creature, beforeX, beforeY) {
  if (Math.abs(creature.pos.x - beforeX) + Math.abs(creature.pos.y - beforeY) <= 0) return false;
  const newTile = syncPrimaryFenceTile(gs, creature);
  return !!(newTile && consumeGrassOnEnter(gs, creature, newTile));
}

/**
 * 撞墙接触：进入短暂回弹阶段（速度已在 integrateMotion 内按法线反射并衰减）。
 * 回弹结束（bounceLeft 归零）后再做「Idle / 换向」重决策。
 */
function beginWallBounce(creature, profile) {
  creature.wallHits = (creature.wallHits || 0) + 1;
  const bounceS = Number.isFinite(profile.bounceS) && profile.bounceS > 0 ? profile.bounceS : 0.32;
  creature.bounceLeft = bounceS;
  creature.lastWallDecision = 'bounce';
  creature.wallFailStreak = 0;
  // 回弹期间不因安全超时提前结束这一段行走
  creature.stateLeft = Math.max(creature.stateLeft || 0, bounceS + 0.4);
  syncHeadingFromVelocity(creature);
}

/**
 * 回弹结束后的一次重决策（用户裁定）：二选一
 *   ① Idle —— 按 idle 参数正常停一会儿（无可行方向时必选，并额外延长静止）；
 *   ② 换向 —— 新方向必须满足「wallFreeThreshold 格内不碰任何一面栅栏」。
 * 任何分支都不允许停在 Walk 状态却零位移。
 */
function resolveWallDecision(gs, creature, profile, inner) {
  const decision = decideAfterWallHit(creature, profile, inner);
  const idleChance = Number.isFinite(profile.wallHitIdleChance) ? profile.wallHitIdleChance : 0;

  if (!decision || Math.random() < idleChance) {
    if (!decision) {
      creature.wallFailStreak = (creature.wallFailStreak || 0) + 1;
    } else {
      creature.wallFailStreak = 0;
    }
    creature.lastWallDecision = 'idle';
    beginIdle(creature, profile, inner);
    if (!decision) {
      const extraS = Number.isFinite(profile.wallFailExtraIdleS) ? profile.wallFailExtraIdleS : 0;
      creature.stateLeft += Math.min(3, creature.wallFailStreak) * extraS;
    }
    return;
  }

  creature.wallFailStreak = 0;
  creature.lastWallDecision = 'walk';
  creature.dir = decision.angle;
  creature.targetPos = {
    x: creature.pos.x + Math.cos(decision.angle) * decision.dist,
    y: creature.pos.y + Math.sin(decision.angle) * decision.dist,
  };
  creature.stateLeft = decision.dist * secondsPerTileOf(creature) * 1.6 + 0.8;
  // 方向立即对齐新方向；速度大小保留回弹后的衰减值，下一步再平滑加速回巡航（不瞬跳）
  const sp = speedOf(creature);
  if (sp > 1e-9) {
    creature.vx = Math.cos(decision.angle) * sp;
    creature.vy = Math.sin(decision.angle) * sp;
  }
}

/**
 * Walk 一步：平滑转向 + 按速度连续积分（速度 = 1 / speedPerTile 格每秒）。
 * 结束条件：到达目标 / 安全超时 → finishWalk（可能立刻接下一段行走，或进 Idle 刹车）。
 * 撞墙策略（2026-11-07 用户裁定，取代旧「当步硬夹 + 当步重决策」）：
 *   ① 撞到任一面栅栏 → 位置停在边界接触点（绝不穿出、绝不夹跳），
 *     速度沿法线反射并快速衰减，进入 bounceS 秒的真实回弹；
 *   ② 回弹结束后再做一次重决策：Idle 或「wallFreeThreshold 格内不碰任何栅栏」的新方向；
 *   ③ 回弹与重决策全程都有真实位移，不存在「Walk 状态零位移」。
 * @returns {boolean} 是否因进入草格而触发地块内容变化
 */
function stepWalk(gs, creature, profile, dtSec) {
  const inner = fenceInner(gs, creatureRadius(creature));
  const beforeX = creature.pos.x;
  const beforeY = creature.pos.y;

  // ── A) 回弹阶段：沿反射后的速度连续积分，速度按 bounceDamping 指数衰减 ──
  if (creature.bounceLeft > 0) {
    const physics = bouncePhysicsOf(profile);
    const decay = Math.exp(-physics.damping * dtSec);
    creature.vx *= decay;
    creature.vy *= decay;
    integrateMotion(creature, inner, dtSec, physics);
    creature.bounceLeft = Math.max(0, creature.bounceLeft - dtSec);
    // 回弹速度已衰减到肉眼不可见时也立即重决策，避免「Walk 状态零位移」的空转
    if (creature.bounceLeft === 0 || speedOf(creature) <= 1e-4) {
      creature.bounceLeft = 0;
      resolveWallDecision(gs, creature, profile, inner);
    }
    syncHeadingFromVelocity(creature);
    return applyTerrainChange(gs, creature, beforeX, beforeY);
  }

  if (!creature.targetPos) {
    beginWalk(gs, creature, profile);
    return false;
  }

  // ── B) 平滑转向（角速度上限 → 不会瞬间反向抖动） ──
  const desired = Math.atan2(
    creature.targetPos.y - creature.pos.y,
    creature.targetPos.x - creature.pos.x,
  );
  creature.dir = turnToward(
    Number.isFinite(creature.dir) ? creature.dir : desired,
    desired,
    profile.maxTurnRate * dtSec,
  );

  // 速度大小：从当前值平滑加速到巡航速度（起步 / 回弹恢复），永不超速
  const cruise = cruiseSpeedOf(creature);
  const accelS = Number.isFinite(profile.startAccelS) && profile.startAccelS > 0 ? profile.startAccelS : 0.22;
  const sp = Math.min(cruise, speedOf(creature) + (cruise / accelS) * dtSec);
  creature.vx = Math.cos(creature.dir) * sp;
  creature.vy = Math.sin(creature.dir) * sp;

  const hit = integrateMotion(creature, inner, dtSec, bouncePhysicsOf(profile));
  creature.stateLeft -= dtSec;
  const changed = applyTerrainChange(gs, creature, beforeX, beforeY);

  if (hit) {
    beginWallBounce(creature, profile);
    return changed;
  }

  // 到达 / 超时：本步位移已结算完再切换状态（下一段接着走或进 Idle 刹车），不留空步
  const arrived = Math.hypot(
    creature.targetPos.x - creature.pos.x,
    creature.targetPos.y - creature.pos.y,
  ) <= profile.arriveEps;
  if (arrived || creature.stateLeft <= 0) {
    finishWalk(gs, creature, profile);
  }
  return changed;
}

/** 主格兼容缓存：row/col + fence[].creatures（几何归属仍以 pos+radius 为准） */
function syncPrimaryFenceTile(gs, creature) {
  const fDims = fenceDimsOf(gs);
  if (fDims.rows <= 0 || fDims.cols <= 0 || !Array.isArray(gs.map?.fence)) return;
  const gridX = clamp(Math.floor(creature.pos.x), FENCE_ORIGIN_X, FENCE_ORIGIN_X + fDims.cols - 1);
  const gridY = clamp(Math.floor(creature.pos.y), FENCE_ORIGIN_Y, FENCE_ORIGIN_Y + fDims.rows - 1);
  const cell = fenceCellOfGrid(gs, gridX, gridY);
  if (!cell) return;
  if (creature.row === cell.row && creature.col === cell.col) return;

  const oldTile = gs.map.fence.find(t => t.row === creature.row && t.col === creature.col);
  if (oldTile?.creatures) {
    oldTile.creatures = oldTile.creatures.filter(id => id !== creature.id);
  }
  creature.row = cell.row;
  creature.col = cell.col;
  const newTile = gs.map.fence[cell.row * fDims.cols + cell.col];
  if (newTile) {
    newTile.creatures = newTile.creatures || [];
    if (!newTile.creatures.includes(creature.id)) newTile.creatures.push(creature.id);
  }
  return newTile;
}

/**
 * 进入草地形时吃草（§13.4 放养进食）。
 * 仅草食生物（`feedByGrass` 数据标记，如小鸡 / 成鸡）会吃草；
 * 吃到草立即消耗 GRASS_ELEMENTS_PER_CREATURE_PER_DAY（1 元素量）并转为【已投喂】，
 * 【已投喂】状态下本日内不再继续吃草（次日开始时统一转回【饥饿】）。
 * 消耗直接扣地块元素量，不走背包库存。
 * @returns {boolean} 本次是否实际发生了消耗
 */
export function consumeGrassOnEnter(gs, creature, newTile) {
  if (!newTile || !creature) return false;
  const def = getCreatureDef(creature.kind);
  // 只有草食生物（数据标记 feedByGrass：小鸡 / 成鸡）才吃草；史莱姆等非草食生物不消耗草元素量
  if (!def?.feedByGrass) return false;
  if (normalizeTerrain(newTile.terrain) !== 'terrain_grass' || (newTile.terrainAmount ?? 0) <= 0) return false;
  // 【已投喂】本日内不会再继续吃草（含当日已啃过草 / 次日开始时尚未重置的边界态）
  if (creature.lastFed === true) return false;
  const amount = Math.max(1, GRASS_ELEMENTS_PER_CREATURE_PER_DAY);
  const eaten = Math.min(amount, newTile.terrainAmount);
  newTile.terrainAmount -= eaten;
  // 吃到草即达成「已投喂」
  creature.lastFed = true;
  EventBus.emit(GE.CREATURE_STATE_CHANGED, { creatureId: creature.id });
  if (newTile.terrainAmount <= 0) {
    newTile.terrain = 'terrain_none';
    // 栅栏内地块地形变化：带索引广播，MapView 只就地重绘这一格的地形背景
    // （不再依赖不带索引的 TILE_UPDATED 兜底）
    const fDims = fenceDimsOf(gs);
    const row = newTile.row;
    const col = newTile.col;
    const fenceIdx = row * fDims.cols + col;
    EventBus.emit(GE.TILE_TERRAIN_CHANGED, { row, col, fenceIdx });
    EventBus.emit(GE.FENCE_TILE_UPDATED, { row, col, fenceIdx });
  }
  return true;
}

// ────────────────────────────────────────────────────────────
// 设施开门 / 关门（鸡舍、史莱姆屋）
//   归属键：设施实例稳定 uid（creature.sourceTileUid），扩建重排外圈索引后仍指向同一座设施；
//   裸索引 sourceTileIdx 仅作旧存档回退。
//   关门 → housed=true：移出栅栏格缓存、冻结移动/行为/渲染，但仍留在 gs.creatures（容量照常占用）。
//   开门 → 随机放回栅栏圆心合法区（不越出栅栏），恢复移动与渲染。
//   野生生物（无 sourceTileUid / sourceTileIdx）永远不受影响。
// ────────────────────────────────────────────────────────────

/** 把生物移出栅栏格缓存（不改变 pos，只切归属缓存） */
function removeCreatureFromFenceCache(gs, creature) {
  const oldTile = gs.map?.fence?.find(t => t.row === creature.row && t.col === creature.col);
  if (oldTile?.creatures) {
    oldTile.creatures = oldTile.creatures.filter(id => id !== creature.id);
  }
}

/** 关门：生物收入设施（不可见、不移动），容量与归属不变 */
function putCreatureIntoHouse(gs, creature) {
  if (!creature) return;
  creature.housed = true;
  creature.vx = 0;
  creature.vy = 0;
  creature.targetPos = null;
  creature.behaviorState = 'idle';
  creature.stateLeft = 0;
  creature.bounceLeft = 0;
  creature.brakeLeft = 0;
  creature.brakeSpeed0 = 0;
  removeCreatureFromFenceCache(gs, creature);
}

/** 开门：随机放到栅栏内的合法位置，并恢复主格缓存与渲染/移动状态 */
function releaseCreatureFromHouse(gs, creature) {
  if (!creature) return;
  const fDims = fenceDimsOf(gs);
  const inner = fenceInner(gs, creatureRadius(creature));
  creature.housed = false;
  if (fDims.rows > 0 && fDims.cols > 0 && inner.x1 >= inner.x0 && inner.y1 >= inner.y0) {
    creature.pos = {
      x: inner.x0 + Math.random() * (inner.x1 - inner.x0),
      y: inner.y0 + Math.random() * (inner.y1 - inner.y0),
    };
    creature.renderPos = { x: creature.pos.x, y: creature.pos.y };
    creature.renderFrom = { x: creature.pos.x, y: creature.pos.y };
    creature.renderT = Number.isFinite(creature.renderDur) ? creature.renderDur : 0.2;
    // 主格缓存从非法旧状态重置后再同步
    creature.row = -1;
    creature.col = -1;
    syncPrimaryFenceTile(gs, creature);
  }
  creature.vx = 0;
  creature.vy = 0;
  creature.targetPos = null;
  creature.behaviorState = 'idle';
  creature.stateLeft = rand(0.3, 1.0);
  creature.bounceLeft = 0;
  creature.brakeLeft = 0;
  creature.brakeSpeed0 = 0;
  creature.dir = randomDirection();
  creature.lastMoveTs = Date.now();
}

/**
 * 设置门禁设施开/关门状态，并把该设施归属的全部生物收纳 / 放回栅栏。
 * 不消耗行动力、不占回合（设计文档未规定消耗）。
 * @param {object} gs
 * @param {number} tileIdx 设施所在外圈格 idx
 * @param {boolean} open true=开门，false=关门
 * @returns {{ok:boolean, open?:boolean, count?:number, reason?:string}}
 */
export function setFacilityDoorOpen(gs, tileIdx, open) {
  const tile = gs?.map?.outerTiles?.[tileIdx];
  if (!tile) return { ok: false, reason: 'noTile' };
  if (!DOOR_FACILITIES.has(tile.contentId)) return { ok: false, reason: 'notDoorFacility' };
  const next = !!open;
  if (!tile.contentState) tile.contentState = {};
  const wasOpen = tile.contentState.doorOpen !== false;
  const owned = facilityOwnedCreatures(gs, tileIdx);
  // 门本来就开着再点开门：不重复搬运生物
  if (next && wasOpen) return { ok: true, open: true, count: owned.length };
  for (const c of owned) {
    if (next) releaseCreatureFromHouse(gs, c);
    else putCreatureIntoHouse(gs, c);
  }
  tile.contentState.doorOpen = next;
  EventBus.emit(GE.TILE_UPDATED, { tileIdx });
  return { ok: true, open: next, count: owned.length };
}

/**
 * 通用：内容被拆除 / 替换时，清理该地块内容归属的全部生物。
 * 判定依据是「该地块是否有归属生物」（uid / 旧索引），不写死设施 id；
 * 归属生物算作死亡并直接移除（含 housed 收纳中的），但**不产生任何掉落 / 金币 / 经验**，
 * 也不走击杀结算。野生生物无归属，不受影响。幂等：无归属生物时不做任何事。
 * @returns {{ok:boolean, removed:object[]}}
 */
export function removeCreaturesOwnedByTile(gs, tile, { reason = 'facilityRemoved' } = {}) {
  if (!gs || !tile || !Array.isArray(gs.creatures)) return { ok: false, removed: [] };
  const owned = gs.creatures.filter(c => c && creatureOwnedByTile(gs, c, tile));
  if (owned.length === 0) return { ok: false, removed: [] };

  const removedIds = new Set(owned.map(c => c.id));
  // 从栅栏格缓存移除（含关门时各自 row/col 缓存残留）
  for (const f of gs.map?.fence || []) {
    if (!Array.isArray(f.creatures)) continue;
    f.creatures = f.creatures
      .map(x => (x && typeof x === 'object' ? x.id : x))
      .filter(id => id && !removedIds.has(id));
  }
  // 标记死亡（不调用任何击杀 / 掉落结算）
  const categories = new Set();
  for (const c of owned) {
    categories.add(getCreatureDef(c.kind)?.category || 'friendly');
    c.hp = 0;
    c.dead = true;
    c.housed = false;
  }
  gs.creatures = gs.creatures.filter(c => !removedIds.has(c.id));

  // 容量计数随 gs.creatures 自动下降 → 广播实时刷新 UI
  for (const category of categories) {
    EventBus.emit(GE.CAPACITY_CHANGE, {
      category,
      newCount: countByCategory(gs, category),
      reason,
    });
  }
  for (const c of owned) {
    EventBus.emit(GE.CREATURE_DEFEATED, { creature: c, source: reason, noReward: true });
  }
  return { ok: true, removed: owned };
}

/** 该设施当前是否开门（缺省视为开门，与初始状态一致） */
export function isFacilityDoorOpen(gs, tileIdx) {
  const tile = gs?.map?.outerTiles?.[tileIdx];
  if (!tile) return true;
  return (tile.contentState || {}).doorOpen !== false;
}

/**
 * 【晕眩】判定（词条：该单位无法行动，持续对应回合数）
 * 生物当前无主动攻击系统，因此「无法行动」的实际表现为：停止移动 / 改变位置。
 */
export function isCreatureStunned(creature) {
  const buffs = creature?.activeBuffs;
  if (!Array.isArray(buffs)) return false;
  return buffs.some((b) => b && b.id === 'stunned' && (b.remainingTurns ?? 1) > 0);
}

/**
 * 一个逻辑步（200ms）：按 Idle ⇄ Walk 状态机推进 pos（判定权威位置）。
 * 回合 / 技能结算期间由 RealtimeClock 跳过本函数（pos 冻结），渲染位置照常推进。
 * @param {object} gs
 * @param {number} dtSec 逻辑步时长（秒）
 */
export function stepCreatures(gs, dtSec) {
  if (!gs || !Array.isArray(gs.creatures)) return;
  const fence = fenceRect(gs);
  if (fence.x1 <= fence.x0) return;
  let tileChanged = false;

  for (const c of gs.creatures) {
    if (!c || c.hp <= 0) continue;
    if (c.housed) continue; // 收纳入设施：不参与移动
    if (!c.pos || !Number.isFinite(c.pos.x) || !Number.isFinite(c.pos.y)) continue;

    // 【晕眩】：该单位无法行动 —— 逻辑步内冻结移动（渲染插值停在当前 pos）
    if (isCreatureStunned(c)) {
      c.renderFrom = { x: c.pos.x, y: c.pos.y };
      c.renderT = 0;
      c.renderDur = dtSec;
      continue;
    }

    const profile = resolveBehavior(c);
    const inner = fenceInner(gs, creatureRadius(c));
    if (inner.x1 < inner.x0 || inner.y1 < inner.y0) continue;

    ensureBehaviorState(c, profile);

    // 记录本步起点：渲染层只在这两个合法端点之间插值（渲染位置不独立模拟）
    const beforeX = c.pos.x;
    const beforeY = c.pos.y;

    if (c.behaviorState === 'idle') {
      // Idle：刹车阶段仍按速度连续积分（平滑减速），刹停后 pos 完全不动
      stepIdle(gs, c, profile, dtSec);
    } else if (stepWalk(gs, c, profile, dtSec)) {
      tileChanged = true;
    }
    if (c.pos.x !== beforeX || c.pos.y !== beforeY) {
      if (c.behaviorState === 'idle' && applyTerrainChange(gs, c, beforeX, beforeY)) tileChanged = true;
    }

    // 渲染插值起点 = 本步开始时的 pos；renderT 从 0 累加到本步时长
    c.renderFrom = { x: beforeX, y: beforeY };
    c.renderT = 0;
    c.renderDur = dtSec;
  }

  // ⑤ 一次性广播：只有地块内容真的变化才发（连续移动本身由渲染层逐帧绘制）
  if (tileChanged) EventBus.emit(GE.TILE_UPDATED);
}

/**
 * 每帧推进 renderPos（表现层位置，不参与判定）。
 * 只做「上一步 pos → 当前 pos」的线性插值：
 *   - 两个端点都是连续积分的合法位置，插值结果天然在合法区内、且不会越过端点；
 *   - 不再让 renderPos 独立按 dir 模拟 —— 那是「停下/撞墙时被吸回 pos」的根因；
 *   - 结算冻结期间没有新的逻辑步，插值停在当前 pos（不产生无人结算的「假位移」）。
 * @param {object} gs
 * @param {number} dtSec 真实帧时长（秒）
 */
export function advanceCreatureRendering(gs, dtSec) {
  if (!gs || !Array.isArray(gs.creatures) || dtSec <= 0) return;
  const frameSec = Math.min(0.1, dtSec); // 单帧最多 100ms，切后台回来不跳一大段

  for (const c of gs.creatures) {
    if (!c || c.hp <= 0) continue;
    if (c.housed) continue; // 收纳入设施：渲染位置冻结
    if (!c.renderPos || !Number.isFinite(c.renderPos.x) || !Number.isFinite(c.renderPos.y)) {
      c.renderPos = { x: c.pos?.x ?? 0, y: c.pos?.y ?? 0 };
      continue;
    }
    if (!c.pos || !Number.isFinite(c.pos.x) || !Number.isFinite(c.pos.y)) continue;

    const dur = Number.isFinite(c.renderDur) && c.renderDur > 0 ? c.renderDur : 0.2;
    const from = c.renderFrom && Number.isFinite(c.renderFrom.x) && Number.isFinite(c.renderFrom.y)
      ? c.renderFrom
      : c.pos;
    const prevT = Number.isFinite(c.renderT) ? c.renderT : dur;
    c.renderT = Math.min(dur, prevT + frameSec);
    const t = dur > 0 ? c.renderT / dur : 1;
    c.renderPos.x = from.x + (c.pos.x - from.x) * t;
    c.renderPos.y = from.y + (c.pos.y - from.y) * t;
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
 * 【每一日结束时】生物结算（DaySystem.startNewDay 在 day++ 之前调用）
 * 顺序（§8.4 / §13.4，对玩家是同一瞬间，代码内部严格分先后）：
 *   1) 鸡舍喂食：按鸡舍实例归属，只喂仍为【饥饿】的鸡 / 小鸡；
 *      先消耗小麦、再消耗稻草，每只 1 份 → 【已投喂】；已【已投喂】的不消耗存粮；
 *      存粮不足时剩余个体保持【饥饿】，照常参与后续判定。
 *   2) 判定：成长值 / 心情值 / 畜产品产出（鸡蛋、优质蛋）。
 */
export function onDayEnd(gs) {
  devLog.info('[CreatureSystem.onDayEnd] day=', gs.day);

  // ── 1) 鸡舍喂食（§13.4） ──
  const outerTiles = gs.map.outerTiles || [];
  const henhouseTiles = outerTiles.filter(t => t.contentId === 'facility_henhouse');

  for (const henhouseTile of henhouseTiles) {
    // 只找「来自这个鸡舍实例」的需投喂生物（稳定 uid 归属，扩建后仍指向同一座鸡舍）
    const henhouseCreatures = gs.creatures.filter(
      c => c.hp > 0 && isFeedableCreature(c) && creatureOwnedByTile(gs, c, henhouseTile)
    );
    if (henhouseCreatures.length === 0) continue;
    henhouseTile.contentState = henhouseTile.contentState || {};
    const store = henhouseTile.contentState.henhouseFeed || (henhouseTile.contentState.henhouseFeed = {});

    for (const c of henhouseCreatures) {
      if (c.lastFed === true) continue; // 本日已投喂（吃过草）→ 不消耗存粮
      // 小麦优先，其次稻草，每只饥饿个体消耗 1 份
      if ((store.item_wheat || 0) > 0) store.item_wheat -= 1;
      else if ((store.item_rice_straw || 0) > 0) store.item_rice_straw -= 1;
      else continue; // 存粮不足 → 保持【饥饿】，照常参与后续判定
      c.lastFed = true;
      devLog.info('[CreatureSystem] henhouse fed:', c.id);
    }
  }

  // ── 2) 判定：成长值 / 心情值 / 畜产品产出 ──
  for (const c of gs.creatures) {
    if (!c || c.hp <= 0) continue;
    const def = getCreatureDef(c.kind);

    // 心情 +1 的触发时机在鸡舍 onEnter hook（§13.4：玩家每次进入鸡舍心情 +1，每日限 1 次），
    // 不在此无条件结算；非鸡舍来源生物心情固定 0（BIO-002 L 列）。

    if (isFeedableCreature(c)) {
      if (c.lastFed === true) {
        // 已投喂：成长值 +（10 + 心情值）
        if (c.growthMax > 0) c.growth = (c.growth || 0) + 10 + (c.mood || 0);
      } else {
        // 饥饿：心情 -1、成长值 +5（物品库 03 表 A21，2026-11-03 裁决确认）
        if (c.growthMax > 0) c.growth = (c.growth || 0) + 5;
        c.mood = Math.max(-5, (c.mood || 0) - 1);
        EventBus.emit(GE.TOAST_SHOW, { text: `🐣 ${def?.name || '小鸡'} 没吃的，心情-1`, duration: 1200 });
      }
    }

    // 成长值（小鸡）：本日结算后达到上限即长大
    if (c.stage === 'chick' && c.growthMax > 0) {
      if (c.growth >= c.growthMax) {
        growUpChick(gs, c);
      }
    }

    // 鸡产蛋（§13.4：已投喂才产蛋）
    // 已投喂 → 产 1 蛋（心情×10% 概率优质蛋）；饥饿 → 心情 -1、不产蛋。
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
        const henTile = creatureOwnerTile(gs, c);
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
}

/**
 * 【每一日开始时】生物结算（DaySystem.startNewDay 在 day++ 之后调用）
 * 顺序（§8.4，对玩家是同一瞬间，代码内部严格分先后）：
 *   1) 所有需要投喂的生物统一转为【饥饿】（上一日判定结束后立即重置）
 *   2) 史莱姆粘液喷吐 5%（超载 15%）
 *   3) 容量超载警告期推进 & 惩罚（必须在 onDailyStart 设施产出之前跑，让 friendlyOverloaded 就绪）
 */
export function onDayStart(gs) {
  devLog.info('[CreatureSystem.onDayStart] day=', gs.day);

  // ── 1) 投喂状态重置：需要投喂的生物全部【饥饿】 ──
  for (const c of gs.creatures) {
    if (!c || c.hp <= 0) continue;
    if (isFeedableCreature(c)) c.lastFed = false;
  }

  // ── 2) 史莱姆粘液喷吐（完整实装：5% / 超载 15%） ──
  const outerTiles = gs.map.outerTiles || [];
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
      // 同名效果不叠加：一格地块至多 1 层粘液
      if (target.states.some(s => s && s.type === 'slime')) continue;
      target.states.push({ type: 'slime' });
      EventBus.emit(GE.TILE_UPDATED, { tileIdx: target.idx });
      EventBus.emit(GE.TOAST_SHOW, { text: `🟢 史莱姆喷吐粘液到地块 ${target.idx}`, duration: 1500 });
      devLog.info('[CreatureSystem] slime spit mucus → tile', target.idx);
    }
  }

  // ── 3) 容量超载警告 & 惩罚 ──
  updateCapacityAndPunish(gs);

  // ── 4) 广播容量变化事件 ──
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
  // 行为参数按 kind 运行期查表（kind 已变为 chicken），这里重置状态并错峰长站
  beginIdle(chick, getBehaviorProfile('chicken'), fenceInner(gs, creatureRadius(chick)));
  // 半径 1/6 → 0.25 后圆可能越界：把圆心夹回栅栏合法区域（遗留问题本轮修掉）
  clampCreatureToFence(gs, chick);
}

/**
 * 超载真实伤害（§13.2，2026-11-07 裁定）：某类型超容量并进入超载期后，
 * **该类型的所有存活生物**各自结算一次真实伤害，每只 = 100% 该生物**当前攻击力**。
 * 当前攻击力取实例运行期 `c.atk`（含增益 / 减益后的瞬时值），不是种族面板基础值。
 * @param {GameState} gs
 * @param {'friendly'|'danger'|'extreme'} category
 * @returns {{creatureId:string, amount:number}[]} 逐只结算条目（顺序稳定，便于独立结算与测试）
 */
function overloadTrueDamageEntries(gs, category) {
  return gs.creatures
    .filter((c) => c && c.hp > 0 && c.category === category)
    .map((c) => {
      const atk = typeof c.atk === 'number' ? c.atk : (getCreatureDef(c.kind)?.atk || 0);
      return { creatureId: c.id, amount: Math.max(0, atk) };
    });
}

/**
 * 逐只独立结算（每只一条真伤事件）；玩家被扣到 0 后停止后续结算，
 * 避免多只连续触发同一套死亡惩罚。
 * @returns {{count:number, total:number}}
 */
export function applyOverloadTrueDamage(gs, category, reason) {
  const entries = overloadTrueDamageEntries(gs, category);
  let count = 0;
  let total = 0;
  for (const e of entries) {
    if (e.amount <= 0) continue;
    const lethal = gs.player.hp <= e.amount;
    CombatSystem.applyTrueDamageToPlayer(gs, gs.player, e.amount, {
      reason,
      creatureId: e.creatureId,
    });
    count += 1;
    total += e.amount;
    if (lethal) break;
  }
  return { count, total };
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
      // §13.2（2026-11-07 裁定）：该类型**所有生物**逐只按「100% 当前攻击力」扣真实伤害
      const { count, total } = applyOverloadTrueDamage(gs, 'danger', 'danger_overload');
      if (total > 0) {
        EventBus.emit(GE.TOAST_SHOW, { text: `⚠️ 危险生物超载！每日开始 ${count} 只生物各按当前攻击力 100% 扣真实伤害（本次 -${total} ❤️）`, duration: 2500 });
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
      // §13.2（2026-11-07 裁定）：真伤部分同样按「该类型所有生物 × 100% 当前攻击力」口径
      applyOverloadTrueDamage(gs, 'extreme', 'extreme_overload');

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
 * §13.4 / FAC-009：鸡舍日末喂食时优先消耗小麦、其次稻草。
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
  onDayEnd,
  onDayStart,
  feedCreature,
  grantKillDrops,
  depositHenhouseFeed,
  withdrawHenhouseFeed,
  resetCreatureIdCounter,
  consumeGrassOnEnter,
  setFacilityDoorOpen,
  isFacilityDoorOpen,
  facilityOwnedCreatures,
  creatureOwnerTile,
  creatureOwnedByTile,
  ensureTileUid,
  remapCreatureOwnershipAfterExpand,
  removeCreaturesOwnedByTile,
  countByCategory,
  DOOR_FACILITIES,
};
