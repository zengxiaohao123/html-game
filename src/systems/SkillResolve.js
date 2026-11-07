// src/systems/SkillResolve.js
// 技能结算流水线 ——《空间碰撞与时序方案》§2.8（judgeMode）/ §3.2 ⑦c / §12.3
//
// 每个技能在 data/characters.js 声明 judgeMode: 'tile' | 'target'，引擎只走两条固定流水线：
//   ① tile   ：锚点格 → 枚举行/列/圆/线带覆盖的栅栏地块集合 → 碰撞框取生物（按实例去重）
//              → 全部登记进**同一个** EffectBatch → commit。
//   ② target ：按中心点选 1~N 名具体生物（最近 / 随机 / 条件集合）→ 按实例去重 → 同一 EffectBatch。
//
// 铁律（§3.6）：
//   · 每次结算入口取一份 snapshotGeometry，整批判定只读这份快照；快照不跨回合/帧复用。
//   · 判定几何用快照；HP / buff 等状态按最新值读取（'集合先定，效果后算'）。
//   · 死亡只入 PendingDeathQueue，批次末统一 flush（§3.5 第 8 步）。
//   · `settling` 只存在于同步结算调用栈内，本模块不持有任何异步状态。
//
// 几何口径（§12.3）：
//   · 距离一律「生物中心点 ↔ 参照点」直线距离，禁止格距 / 行列差。
//   · 参照点：主动技能 = 技能所在地块中心；连携技 = 连携技实例所在地块中心。
//   · 左右方位 = 比较中心点 x，不得退化为"目标所在格的左/右邻格"。
//   · 范围 = 圆-圆接触：圆心距 <= 半径 + 该生物半径（圆半径取 areaRadius）。
//   · 长度单位统一为「米」，1 格边长 = 1 米；areaRadius / tier1Radius 等数值即米数。
//
// 命中口径按形状分两类：
//   · circle：以锚点（生物连续中心）为圆心、半径按米计，**不枚举地块**，
//     与生物碰撞圆重叠即命中（斜对角格里的生物只要圆伸进来同样命中）。
//   · line / row / column / rowColumn：仍按**地块集合**判定
//     （地块中心点到线段距离，或锚点所在行/列），再按碰撞框取格内生物。

import { SKILLS, resolveSkillOwnerId } from '../data/characters.js';
import { FACTION, factionOf, isHostileTo } from '../data/factions.js';
import {
  FENCE_ORIGIN_X,
  FENCE_ORIGIN_Y,
  clamp,
  circleCenterDistance,
  creatureCircle,
  fenceTileRect,
  tileCenter,
  creaturesInTiles,
  snapshotGeometry,
} from '../core/Geometry.js';
import { outerIdxToXY, mapDimsOf, fenceDimsOf } from '../core/Distance.js';
import { EffectBatch } from './EffectBatch.js';
import { PendingDeathQueue } from './PendingDeathQueue.js';
import { devLog } from '../core/Logger.js';

export const JUDGE_MODES = ['tile', 'target'];
export const TILE_ANCHORS = ['skillTile', 'target', 'player+target'];
export const TILE_SHAPES = ['circle', 'row', 'column', 'rowColumn', 'line'];

/**
 * 技能目标侧（意在取代已废弃的 `selfOnly` 死字段）：
 *   enemy —— 默认：只选阵营合法的敌方生物（我方 → 危险 / 高危）
 *   self  —— 自身 / 我方共用实体，不选生物目标（鼓舞、屏息瞄准、汲取）
 *   ally  —— 我方共用实体（与 self 目前等价：我方只有一个实体，不按角色拆分）
 */
export const TARGET_SIDES = ['enemy', 'self', 'ally'];

/** 读取技能目标侧；未声明按 enemy（绝大多数技能默认索敌） */
export function targetSideOf(skill) {
  return TARGET_SIDES.includes(skill?.targetSide) ? skill.targetSide : 'enemy';
}

/** 行/列 / 线带需要 areaRadius 的形状 */
const RADIUS_SHAPES = ['circle', 'line'];

/** 栅栏行列数（矩形地图：rows/cols 分开取，禁止再用 sqrt(fence.length) 假设方阵） */
function fenceDims(src) {
  return fenceDimsOf(src);
}

// ────────────────────────────────────────────────────────────
// judgeMode 校验（§2.8：必填，禁止运行时兜底猜模式）
// ────────────────────────────────────────────────────────────

/**
 * 解析并校验技能的 judgeMode；缺失 / 非法直接抛错（不做兜底）。
 * @param {object} skill
 * @returns {'tile'|'target'}
 */
export function judgeModeOf(skill) {
  const mode = skill?.judgeMode;
  if (!JUDGE_MODES.includes(mode)) {
    throw new Error(`[SkillResolve] 技能 ${skill?.id || '?'} 的 judgeMode 非法（${JSON.stringify(mode)}），必须为 'tile' 或 'target'`);
  }
  if (mode === 'tile') {
    if (!TILE_ANCHORS.includes(skill.anchor)) {
      throw new Error(`[SkillResolve] tile 型技能 ${skill.id} 的 anchor 非法（${JSON.stringify(skill.anchor)}）`);
    }
    if (!TILE_SHAPES.includes(skill.areaShape)) {
      throw new Error(`[SkillResolve] tile 型技能 ${skill.id} 的 areaShape 非法（${JSON.stringify(skill.areaShape)}）`);
    }
    if (RADIUS_SHAPES.includes(skill.areaShape)) {
      if (!(typeof skill.areaRadius === 'number' && skill.areaRadius > 0)) {
        throw new Error(`[SkillResolve] tile 型技能 ${skill.id} 缺少合法 areaRadius`);
      }
    }
  }
  return mode;
}

/**
 * 全量校验技能表的 judgeMode 覆盖（数据巡检 / 冒烟用）
 * @param {object} skills 默认 SKILLS
 * @returns {{ total:number, tile:number, target:number, issues:string[] }}
 */
export function validateSkillJudgeModes(skills = SKILLS) {
  const issues = [];
  const counts = { total: 0, tile: 0, target: 0 };
  for (const skill of Object.values(skills || {})) {
    counts.total += 1;
    try {
      const mode = judgeModeOf(skill);
      counts[mode] += 1;
    } catch (e) {
      issues.push(e.message);
    }
  }
  return { ...counts, issues };
}

// ────────────────────────────────────────────────────────────
// 结算作用域：快照 + 死亡队列 + 一个批次
// ────────────────────────────────────────────────────────────

/**
 * 创建一个结算作用域。**一次结算一份**，不可复用。
 * @param {object} gs
 * @param {object} [opts]
 * @param {string} [opts.skillId]
 * @param {string} [opts.instanceKey] 技能实例键（同一技能卡不同实例独立）
 * @param {string} [opts.phase]      'onEnter' / 'onPass' / 'onBlessed' / 'link'
 * @param {string} [opts.roleId]
 * @param {string} [opts.attackerRoleId]
 * @param {Function} [opts.deathQueue] 复用已有死亡队列（缺省新建，批次末 flush）
 * @param {Function} [opts.resolveDamage] / [opts.applyBuff] 测试注入
 * @returns {object} settlement
 */
export function createSettlement(gs, opts = {}) {
  const snapshot = snapshotGeometry(gs);
  const deathQueue = opts.deathQueue || new PendingDeathQueue(gs);
  // §9.1：未显式给出归属者时按技能解析 —— 通用技能（roleId: null）= 当前队伍 1 号位
  const skillDef = opts.skillId ? SKILLS[opts.skillId] : null;
  const ownerRoleId = opts.roleId ?? (skillDef ? resolveSkillOwnerId(gs, skillDef) : null);
  const batch = new EffectBatch(gs, {
    sourceSkillId: opts.skillId ?? null,
    instanceKey: opts.instanceKey,
    phase: opts.phase ?? 'default',
    atk: opts.atk ?? (gs?.player?.atk ?? 0),
    player: opts.player ?? (gs?.player ?? null),
    roleId: ownerRoleId,
    attackerRoleId: opts.attackerRoleId ?? ownerRoleId,
    deathQueue,
    resolveDamage: opts.resolveDamage,
    applyBuff: opts.applyBuff,
  });
  return {
    gs,
    snapshot,
    batch,
    deathQueue,
    skillId: opts.skillId ?? null,
    friendlyAsEnemyToday: !!gs?.flags?.friendlyAsEnemyToday,
    committed: false,
  };
}

/**
 * 提交批次 + flush 死亡（批次末统一处理）
 * @param {object} settlement
 * @returns {{ summary:object, deaths:object }}
 */
export function commitSettlement(settlement) {
  if (!settlement || settlement.committed) {
    throw new Error('[SkillResolve] 结算作用域已提交，一次结算一份快照/批次');
  }
  settlement.committed = true;
  const summary = settlement.batch.commit();
  const deaths = settlement.deathQueue.flush();
  devLog.info('[SkillResolve] 结算完成', settlement.skillId || '',
    '伤害组', summary.damages.length, 'buff组', summary.buffs.length,
    '死亡', deaths.defeated.length);
  return { summary, deaths };
}

/** 按 id 取**存活**生物实例（效果应用对象；几何仍只读快照） */
export function liveById(gs, id) {
  if (!id || !Array.isArray(gs?.creatures)) return null;
  const c = gs.creatures.find(x => x.id === id);
  if (!c) return null;
  if (c.dead === true || (typeof c.hp === 'number' && c.hp <= 0)) return null;
  return c;
}

// ────────────────────────────────────────────────────────────
// 候选集合（只读快照）
// ────────────────────────────────────────────────────────────

/**
 * 合法目标池（两层过滤的第一层：阵营）。
 * 默认攻击方 = 我方角色（party），只返回阵营合法目标 = 危险 / 高危生物；
 * 友善生物默认**永远**不在池内（除非技能显式 ignoreFaction，或当日 friendlyAsEnemyToday）。
 * @param {object} snapshot
 * @param {object} [opts]
 * @param {'party'|'friendly'|'hostile'} [opts.attackerFaction='party'] 攻击方阵营
 * @param {boolean} [opts.ignoreFaction=false] 【不分敌我】：跳过阵营过滤（当前技能库 0 条）
 * @param {boolean} [opts.friendlyAsEnemyToday=false] 感恩节的晚餐：当日友善生物视同敌人
 */
export function enemyPool(snapshot, opts = {}) {
  const {
    attackerFaction = FACTION.PARTY,
    ignoreFaction = false,
    friendlyAsEnemyToday = false,
  } = opts;
  return (snapshot?.creatures || [])
    .filter(e => e.hp > 0)
    .filter(e => {
      if (ignoreFaction) return true;
      if (friendlyAsEnemyToday) return true;
      return isHostileTo(attackerFaction, factionOf(e));
    });
}

/** 快照条目 → 栅栏格线性索引（距离并列时的稳定次级排序键） */
function fenceIndexAt(entry, dims) {
  const col = clamp(Math.floor(entry.x) - FENCE_ORIGIN_X, 0, Math.max(0, dims.cols - 1));
  const row = clamp(Math.floor(entry.y) - FENCE_ORIGIN_Y, 0, Math.max(0, dims.rows - 1));
  return row * dims.cols + col;
}

/**
 * 按「中心点直线距离」排序（并列按栅栏格下标升序，再按实例 id 升序）。
 * @param {object[]} entries 快照条目
 * @param {{x:number,y:number}} anchor
 * @param {object} src gs / snapshot（取 fenceRowCols）
 */
export function orderByDistance(entries, anchor, src) {
  const dims = fenceDims(src);
  return [...(entries || [])].sort((a, b) => {
    const da = circleCenterDistance(anchor, a);
    const db = circleCenterDistance(anchor, b);
    if (da !== db) return da - db;
    const ia = fenceIndexAt(a, dims);
    const ib = fenceIndexAt(b, dims);
    if (ia !== ib) return ia - ib;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * 最近 N 名敌人（§12.3 默认索敌）
 * @param {object} snapshot
 * @param {{x:number,y:number}} anchor
 * @param {object} [opts] { count, attackerFaction, ignoreFaction, friendlyAsEnemyToday, excludeIds, filter }
 */
export function selectNearestEnemies(snapshot, anchor, opts = {}) {
  const { count = 1, excludeIds = [], filter = null } = opts;
  const exclude = new Set(excludeIds || []);
  let pool = enemyPool(snapshot, opts).filter(e => !exclude.has(e.id));
  if (typeof filter === 'function') pool = pool.filter(filter);
  return orderByDistance(pool, anchor, snapshot).slice(0, Math.max(0, count));
}

/** 随机 N 名敌人（不放回；仅用于描述明确写「随机」的技能，如风止 / 风暴眼锁定） */
export function selectRandomEnemies(snapshot, opts = {}) {
  const { count = 1, filter = null } = opts;
  let pool = enemyPool(snapshot, opts);
  if (typeof filter === 'function') pool = pool.filter(filter);
  const src = pool.slice();
  const out = [];
  while (out.length < count && src.length > 0) {
    out.push(src.splice(Math.floor(Math.random() * src.length), 1)[0]);
  }
  return out;
}

/**
 * 技能声明的默认目标选择（targetCount / targetSelection）。
 * `targetSide` 不是 enemy（自身 / 友方）时不选生物目标，返回空数组。
 */
export function selectSkillTargets(snapshot, skill, anchor, opts = {}) {
  if (targetSideOf(skill) !== 'enemy') return [];
  const count = Math.max(1, skill?.targetCount || 1);
  const merged = {
    count,
    attackerFaction: opts.attackerFaction ?? FACTION.PARTY,
    // 【不分敌我】：技能词条或调用方显式放开时才跳过阵营过滤
    ignoreFaction: !!skill?.ignoreFaction || !!opts.ignoreFaction,
    friendlyAsEnemyToday: !!opts.friendlyAsEnemyToday,
  };
  if ((skill?.targetSelection || 'nearest') === 'random') {
    return selectRandomEnemies(snapshot, merged);
  }
  return selectNearestEnemies(snapshot, anchor, merged);
}

/**
 * 圆-圆接触：锚点半径内的生物（含生物自身半径，§12.3 第 4 条）
 * @param {object} snapshot
 * @param {{x:number,y:number}} point
 * @param {number} radius
 * @param {object} [opts] 同 enemyPool
 */
export function entriesNearPoint(snapshot, point, radius, opts = {}) {
  return enemyPool(snapshot, opts).filter(
    e => circleCenterDistance(point, e) <= radius + (typeof e.radius === 'number' ? e.radius : 0),
  );
}

// ────────────────────────────────────────────────────────────
// 参照点与方位（§12.3）
// ────────────────────────────────────────────────────────────

/** 主动技能参照点：技能所在地块中心 */
export function skillTileAnchor(gs, tileIdx) {
  return tileCenter(gs, tileIdx);
}

/** 玩家参照点：玩家所在地块中心 */
export function playerAnchor(gs) {
  return tileCenter(gs, gs?.player?.x);
}

/** 连携技参照点：连携技实例所在地块中心 */
export function instanceAnchor(gs, tileIdx) {
  return tileCenter(gs, tileIdx);
}

/** 归一化为中心点：快照条目 / 生物实例 / {x,y} */
function pointOf(v) {
  if (!v) return null;
  if (Number.isFinite(v.x) && Number.isFinite(v.y)) return { x: v.x, y: v.y };
  const c = creatureCircle(v);
  return c ? { x: c.x, y: c.y } : null;
}

/**
 * 「伤害来源在目标左侧」= 来源中心点 x < 目标中心点 x（§12.3）
 * 禁止用目标所在格索引 / col 比较。
 */
export function isSourceLeftOfTarget(source, target) {
  const s = pointOf(source);
  const t = pointOf(target);
  if (!s || !t) return false;
  return s.x < t.x;
}

// ────────────────────────────────────────────────────────────
// 地块枚举（tile 流水线）
// ────────────────────────────────────────────────────────────

/** 到线段的距离（用于 line 线带形状） */
export function distancePointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 圆形范围覆盖的栅栏格：地块**中心点**到锚点距离 <= radius（单位：米）
 * 注意：circle 型技能的**命中**走 `circleTargetsOf`（圆-圆重叠），不经过本函数；
 * 这里保留给地块口径查询与几何自检使用。
 * @param {object} gs
 * @param {{x:number,y:number}} anchor
 * @param {number} radius
 */
export function circleTileRefs(gs, anchor, radius) {
  const dims = fenceDims(gs);
  const out = [];
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(radius)) return out;
  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      const rect = fenceTileRect(row, col);
      const center = { x: rect.x0 + 0.5, y: rect.y0 + 0.5 };
      if (circleCenterDistance(center, anchor) <= radius) out.push({ kind: 'fence', row, col });
    }
  }
  return out;
}

/**
 * 行 + 列覆盖的栅栏格（合纵连横）：外圈格 (x,y) → 栅栏 (row=y-1, col=x-1)；
 * 越界轴（贴外圈）只保留另一轴。
 */
export function rowColumnTileRefs(gs, tileIdx) {
  const dims = fenceDims(gs);
  const { x, y } = outerIdxToXY(mapDimsOf(gs), tileIdx);
  const fenceRow = y - FENCE_ORIGIN_Y;
  const fenceCol = x - FENCE_ORIGIN_X;
  const out = [];
  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      const inRow = fenceRow >= 0 && fenceRow < dims.rows && row === fenceRow;
      const inCol = fenceCol >= 0 && fenceCol < dims.cols && col === fenceCol;
      if (inRow || inCol) out.push({ kind: 'fence', row, col });
    }
  }
  return out;
}

/** 单行 / 单列（预留形状，目前无技能使用） */
export function rowOrColumnTileRefs(gs, tileIdx, axis) {
  const dims = fenceDims(gs);
  const { x, y } = outerIdxToXY(mapDimsOf(gs), tileIdx);
  const fenceRow = y - FENCE_ORIGIN_Y;
  const fenceCol = x - FENCE_ORIGIN_X;
  const out = [];
  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      const hit = axis === 'row'
        ? (fenceRow >= 0 && fenceRow < dims.rows && row === fenceRow)
        : (fenceCol >= 0 && fenceCol < dims.cols && col === fenceCol);
      if (hit) out.push({ kind: 'fence', row, col });
    }
  }
  return out;
}

/**
 * 线带覆盖的栅栏格（风暴眼）：地块中心点到线段距离 <= halfWidth
 * @param {object} gs
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {number} halfWidth
 */
export function lineTileRefs(gs, from, to, halfWidth = 0.5) {
  const dims = fenceDims(gs);
  const out = [];
  if (!from || !to) return out;
  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      const rect = fenceTileRect(row, col);
      const center = { x: rect.x0 + 0.5, y: rect.y0 + 0.5 };
      if (distancePointToSegment(center.x, center.y, from.x, from.y, to.x, to.y) <= halfWidth) {
        out.push({ kind: 'fence', row, col });
      }
    }
  }
  return out;
}

/**
 * 按技能的 anchor / areaShape / areaRadius 枚举地块
 * @param {object} gs
 * @param {object} skill tile 型技能定义
 * @param {object} params { skillTileIdx, anchorPoint, targetPoint }
 */
export function tileRefsForSkill(gs, skill, params = {}) {
  const { skillTileIdx = null, anchorPoint = null, targetPoint = null } = params;
  const shape = skill?.areaShape;
  if (shape === 'rowColumn') return rowColumnTileRefs(gs, skillTileIdx);
  if (shape === 'row') return rowOrColumnTileRefs(gs, skillTileIdx, 'row');
  if (shape === 'column') return rowOrColumnTileRefs(gs, skillTileIdx, 'column');
  if (shape === 'circle') return circleTileRefs(gs, anchorPoint, skill.areaRadius);
  if (shape === 'line') return lineTileRefs(gs, anchorPoint, targetPoint, skill.areaRadius ?? 0.5);
  return [];
}

/**
 * 地块集合 → 合法目标（快照查询，按生物实例去重；不按格重复）
 * @param {object} settlement
 * @param {object} skill
 * @param {object[]} tileRefs
 */
export function tileTargetsOf(settlement, skill, tileRefs) {
  const allowed = new Set(enemyPool(settlement.snapshot, {
    ignoreFaction: !!skill?.ignoreFaction,
    friendlyAsEnemyToday: settlement.friendlyAsEnemyToday,
  }).map(e => e.id));
  return creaturesInTiles(settlement.snapshot, tileRefs).filter(e => allowed.has(e.id));
}

/**
 * circle 型范围命中：以锚点为圆心、半径按米计（1 格边长 = 1 米），与生物碰撞圆重叠即命中
 * （圆心距 ≤ areaRadius + 该生物 radius，取等命中）。
 * **不枚举地块**：斜对角格里的生物只要碰撞圆伸进半径圆，同样命中；
 * 快照条目按生物实例唯一，同一生物不会重复出现，批次键再做二次兜底。
 * @param {object} settlement
 * @param {object} skill tile 型技能（areaShape = 'circle'）
 * @param {{x:number,y:number}} anchorPoint 锚点（生物连续中心 / 技能格中心）
 * @param {number|null} radiusOverride 覆盖技能声明的半径（焚灭按档位取 tier1/tier2 半径）
 */
export function circleTargetsOf(settlement, skill, anchorPoint, radiusOverride = null) {
  if (!anchorPoint) return [];
  const radius = radiusOverride == null ? (skill?.areaRadius ?? 0) : radiusOverride;
  return entriesNearPoint(settlement.snapshot, anchorPoint, radius, {
    ignoreFaction: !!skill?.ignoreFaction,
    friendlyAsEnemyToday: settlement.friendlyAsEnemyToday,
  });
}

// ────────────────────────────────────────────────────────────
// 意图登记（统一入口，技能分支只描述"打给谁、倍率、buff"）
// ────────────────────────────────────────────────────────────

/**
 * 把伤害意图登记进当前批次（同一目标重复登记由 EffectBatch 去重）
 * @param {object} settlement
 * @param {object[]} entries 快照条目
 * @param {object} opts { multiplier, element, hits, key }
 * @returns {object[]} 实际生效目标（活体实例）
 */
export function registerDamage(settlement, entries, opts = {}) {
  const { multiplier, element = null, hits = 1, key } = opts;
  const applied = [];
  for (const entry of entries || []) {
    const live = liveById(settlement.gs, entry.id);
    if (!live) continue;
    const intent = settlement.batch.damage(live, multiplier, { element, hits, key });
    if (intent) applied.push(live);
  }
  return applied;
}

/**
 * 登记 buff / debuff 意图（同「目标 + buffId」由 EffectBatch 取最高强度 / 最长时长）
 * @param {object} settlement
 * @param {object} liveTarget 生物实例
 * @param {string} buffId
 * @param {object} [opts] { strength, duration, params }
 */
export function registerBuff(settlement, liveTarget, buffId, opts = {}) {
  if (!liveTarget) return null;
  return settlement.batch.buff(liveTarget, buffId, opts);
}

export const SkillResolve = {
  JUDGE_MODES,
  TILE_ANCHORS,
  TILE_SHAPES,
  TARGET_SIDES,
  targetSideOf,
  judgeModeOf,
  validateSkillJudgeModes,
  createSettlement,
  commitSettlement,
  liveById,
  enemyPool,
  orderByDistance,
  selectNearestEnemies,
  selectRandomEnemies,
  selectSkillTargets,
  entriesNearPoint,
  skillTileAnchor,
  playerAnchor,
  instanceAnchor,
  isSourceLeftOfTarget,
  distancePointToSegment,
  circleTileRefs,
  rowColumnTileRefs,
  rowOrColumnTileRefs,
  lineTileRefs,
  tileRefsForSkill,
  tileTargetsOf,
  circleTargetsOf,
  registerDamage,
  registerBuff,
};

export default SkillResolve;
