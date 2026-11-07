// src/core/Geometry.js
// 空间几何层（纯函数，无状态）——《设计文档 v0.5》§2.1 / §2.2 / §12.3 / §18
//
// 坐标口径（全项目唯一）：
//   - 统一连续坐标，1 格边长 = 1 单位；地图左上角为原点 (0,0)，地图为 size×size 正方形。
//   - 外圈地块 (x, y)：中心 (x+0.5, y+0.5)，碰撞框 [x, x+1] × [y, y+1]。
//   - 栅栏地块 (row, col)：栅栏原点恒为网格 (1,1)（与 size 无关），
//     中心 (col+1.5, row+1.5)，碰撞框 [col+1, col+2] × [row+1, row+2]。
//   - 地图外圈边长 size 可配置（初始 3×3）；扩图时栅栏内 = (size-2)×(size-2) 同步变大，
//     栅栏左上角仍恒在网格 (1,1)。
//
// 本层只输出「逻辑坐标」，不涉及像素；UI 层唯一职责是 逻辑坐标 × 每格像素 = 屏幕坐标。
//
// 位置的两套口径（对应「几何冻结、显示不冻结」）：
//   - c.pos       逻辑位置（权威，参与一切判定；结算期间由几何快照冻结）。
//   - c.renderPos 渲染插值位置（表现层可随时更新，不参与判定）。
//   本模块提供 creatureCircle()（逻辑圆）与 creatureRenderCircle()（显示圆）两套纯函数。
//
// 生物归属裁剪（§2.1 域裁剪）：生物的「位于哪些地块」只在栅栏域内判定；
//   圆贴边压到外圈框不算位于外圈地块（外圈单位页只显示角色）。

import { outerIdxToXY, outerXYToIdx, mapDimsOf, fenceDimsOf, outerRingCount } from './Distance.js';
import { getCreatureDef } from '../data/creatures.js';

/** 栅栏原点（网格坐标，与地图边长无关，恒为 (1,1)） */
export const FENCE_ORIGIN_X = 1;
export const FENCE_ORIGIN_Y = 1;

/** 无据可依时的生物半径（米）；设计文档 §2.2 基准（1 格边长 = 1 米） */
export const DEFAULT_CREATURE_RADIUS = 0.25;

/** 每格像素上限/下限（UI 反算用；3×3 在常规窗口下仍是 80px） */
export const MAX_TILE_PX = 80;
export const MIN_TILE_PX = 28;

// ────────────────────────────────────────────────────────────
// 基础工具
// ────────────────────────────────────────────────────────────

export function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

export function circleCenterDistance(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}

/**
 * 圆与轴对齐矩形是否重叠（最近点 clamp 法，O(1)）。
 * 「有任意重叠」即算位于该地块内，包含相切（<=）。
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {{x0:number, y0:number, x1:number, y1:number}} rect
 */
export function circleIntersectsRect(cx, cy, r, rect) {
  if (!rect) return false;
  const nx = clamp(cx, rect.x0, rect.x1);
  const ny = clamp(cy, rect.y0, rect.y1);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

/** 点是否严格位于矩形内（不含边界，主格判定等场景使用） */
export function pointInRect(p, rect) {
  return !!rect && p.x > rect.x0 && p.x < rect.x1 && p.y > rect.y0 && p.y < rect.y1;
}

/** 两个矩形内部是否重叠（仅相切边界不算重叠） */
export function rectsOverlap(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

// ────────────────────────────────────────────────────────────
// 地块引用（ref）：{kind:'outer', idx} | {kind:'fence', row, col}
//   - 生物查询类接口也接受数字：表示栅栏地块线性索引 row*fenceRowCols+col
//     （生物只属于栅栏域，因此数值入参按栅栏域解释）。
//   - 几何接口（tileCenter/tileRect）的数值入参按仓库既有约定解释为「外圈 idx」。
// ────────────────────────────────────────────────────────────

export function outerTileRef(idx) {
  return { kind: 'outer', idx };
}

export function fenceTileRef(row, col) {
  return { kind: 'fence', row, col };
}

export function isFenceTileRef(ref) {
  return !!ref && (
    ref.kind === 'fence' ||
    (typeof ref.row === 'number' && typeof ref.col === 'number')
  );
}

/** 栅栏 (row, col) → 网格 (x, y)：栅栏原点恒为 (1,1) */
export function gridCellOfFence(row, col) {
  return { x: col + FENCE_ORIGIN_X, y: row + FENCE_ORIGIN_Y };
}

/** 网格 (x, y) → 栅栏 (row, col)；不落在栅栏域返回 null
 *  @param {object} gs
 *  @param {number} x
 *  @param {number} y
 */
export function fenceCellOfGrid(gs, x, y) {
  const row = y - FENCE_ORIGIN_Y;
  const col = x - FENCE_ORIGIN_X;
  const dims = fenceDimsOf(gs);
  if (row < 0 || row >= dims.rows || col < 0 || col >= dims.cols) return null;
  return { row, col };
}

/** 取对外暴露的地图行列数（兼容旧 size 口径） */
export function mapDims(gs) {
  return mapDimsOf(gs);
}

/** 栅栏地块线性索引（与 gs.map.fence 数组下标一致） */
export function fenceTileIndex(gs, row, col) {
  return row * fenceDimsOf(gs).cols + col;
}

/** 把数字/ref 归一化为栅栏 ref；外圈 ref 或非法值返回 null */
export function normalizeFenceRef(gs, ref) {
  const dims = fenceDimsOf(gs);
  if (typeof ref === 'number') {
    if (!Number.isInteger(ref) || ref < 0 || ref >= dims.rows * dims.cols) return null;
    return { kind: 'fence', row: Math.floor(ref / dims.cols), col: ref % dims.cols };
  }
  if (isFenceTileRef(ref)) {
    const row = ref.row;
    const col = ref.col;
    if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
    if (row < 0 || row >= dims.rows || col < 0 || col >= dims.cols) return null;
    return { kind: 'fence', row, col };
  }
  return null; // {kind:'outer'} 一律裁剪掉
}

/** 归一化为地块 ref；数字按「外圈 idx」解释；非法返回 null */
export function normalizeTileRef(gs, ref) {
  const total = outerTileCount(gs);
  if (typeof ref === 'number') {
    if (!Number.isInteger(ref) || ref < 0) return null;
    return ref < total ? { kind: 'outer', idx: ref } : null;
  }
  if (isFenceTileRef(ref)) return normalizeFenceRef(gs, ref);
  if (ref && ref.kind === 'outer' && Number.isInteger(ref.idx)) {
    return ref.idx >= 0 && ref.idx < total ? ref : null;
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// 地块几何：中心点 / AABB
// ────────────────────────────────────────────────────────────

/**
 * 地块中心点（逻辑坐标）
 * @returns {{x:number, y:number}|null}
 */
export function tileCenter(gs, ref) {
  const r = normalizeTileRef(gs, ref);
  if (!r) return null;
  if (r.kind === 'outer') {
    const { x, y } = outerIdxToXY(mapDimsOf(gs), r.idx);
    return { x: x + 0.5, y: y + 0.5 };
  }
  const g = gridCellOfFence(r.row, r.col);
  return { x: g.x + 0.5, y: g.y + 0.5 };
}

/**
 * 地块碰撞框（轴对齐正方形 AABB，逻辑坐标）
 * @returns {{x0:number, y0:number, x1:number, y1:number}|null}
 */
export function tileRect(gs, ref) {
  const r = normalizeTileRef(gs, ref);
  if (!r) return null;
  if (r.kind === 'outer') {
    const { x, y } = outerIdxToXY(mapDimsOf(gs), r.idx);
    return { x0: x, y0: y, x1: x + 1, y1: y + 1 };
  }
  const g = gridCellOfFence(r.row, r.col);
  return { x0: g.x, y0: g.y, x1: g.x + 1, y1: g.y + 1 };
}

/** 栅栏地块矩形（无需 gs：栅栏原点与边长无关） */
export function fenceTileRect(row, col) {
  const g = gridCellOfFence(row, col);
  return { x0: g.x, y0: g.y, x1: g.x + 1, y1: g.y + 1 };
}

/** 整个栅栏区域的矩形（外圈边长可扩展 → 栅栏内区域同步变大） */
export function fenceRect(gs) {
  const dims = fenceDimsOf(gs);
  return {
    x0: FENCE_ORIGIN_X,
    y0: FENCE_ORIGIN_Y,
    x1: FENCE_ORIGIN_X + dims.cols,
    y1: FENCE_ORIGIN_Y + dims.rows,
  };
}

/** 外圈 idx 数量（随地图行/列数变化） */
export function outerTileCount(gs) {
  const dims = mapDimsOf(gs);
  return outerRingCount(dims.rows, dims.cols);
}

/** 全部外圈地块 ref */
export function allOuterTileRefs(gs) {
  const n = outerTileCount(gs);
  const out = [];
  for (let i = 0; i < n; i++) out.push(outerTileRef(i));
  return out;
}

/** 全部栅栏地块 ref（行优先） */
export function allFenceTileRefs(gs) {
  const dims = fenceDimsOf(gs);
  const out = [];
  for (let r = 0; r < dims.rows; r++) {
    for (let c = 0; c < dims.cols; c++) out.push(fenceTileRef(r, c));
  }
  return out;
}

/**
 * UI 用：在可用区域内反算每格像素（边长可扩展时不挤压、不错位）。
 * 3×3 在常规窗口下仍取上限 80px，与改造前一致；外圈变大时按可用区域等比缩小。
 * @param {object} p
 * @param {number} p.availW 可用宽度（px）
 * @param {number} p.availH 可用高度（px）
 * @param {number} p.size   外圈边长（旧口径方阵；矩形地图请传 rows/cols）
 * @param {number} [p.rows] 地图行数（宽度）
 * @param {number} [p.cols] 地图列数（长度）
 * @returns {number} 每格像素（整数）
 */
export function computeTilePx({
  availW, availH, size, rows, cols, maxTilePx = MAX_TILE_PX, minTilePx = MIN_TILE_PX,
}) {
  const nRows = Math.max(1, rows ?? size ?? 3);
  const nCols = Math.max(1, cols ?? size ?? 3);
  const fit = Math.min(Math.max(0, availW) / nCols, Math.max(0, availH) / nRows);
  return Math.max(minTilePx, Math.min(maxTilePx, Math.floor(fit)));
}

// ────────────────────────────────────────────────────────────
// 生物圆
// ────────────────────────────────────────────────────────────

/**
 * 生物半径（米；1 格边长 = 1 米）：实例 radius 优先，其次生物定义，最后 0.25（待定口径）
 * @param {object|string} creatureOrKind
 */
export function creatureRadius(creatureOrKind) {
  if (!creatureOrKind) return DEFAULT_CREATURE_RADIUS;
  if (typeof creatureOrKind === 'number' && creatureOrKind > 0) return creatureOrKind;
  if (typeof creatureOrKind === 'object' && typeof creatureOrKind.radius === 'number' && creatureOrKind.radius > 0) {
    return creatureOrKind.radius;
  }
  const kind = typeof creatureOrKind === 'string' ? creatureOrKind : creatureOrKind.kind;
  const def = getCreatureDef(kind);
  if (def && typeof def.radius === 'number' && def.radius > 0) return def.radius;
  return DEFAULT_CREATURE_RADIUS;
}

/** 生物逻辑圆（判定用）：优先连续坐标 pos；旧数据回落到主格中心 */
export function creatureCircle(creature) {
  if (!creature) return null;
  const p = creature.pos;
  const hasPos = !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const x = hasPos ? p.x : (creature.col ?? 0) + FENCE_ORIGIN_X + 0.5;
  const y = hasPos ? p.y : (creature.row ?? 0) + FENCE_ORIGIN_Y + 0.5;
  return { x, y, r: creatureRadius(creature) };
}

/** 生物渲染圆（表现用）：优先 renderPos（插值位置），回落逻辑圆 */
export function creatureRenderCircle(creature) {
  if (!creature) return null;
  const rp = creature.renderPos;
  if (rp && Number.isFinite(rp.x) && Number.isFinite(rp.y)) {
    return { x: rp.x, y: rp.y, r: creatureRadius(creature) };
  }
  return creatureCircle(creature);
}

/** 生物当前压到的全部栅栏地块 ref（域裁剪：不看外圈） */
export function creatureTileRefs(gs, creature) {
  const c = creatureCircle(creature);
  if (!c) return [];
  const out = [];
  const dims = fenceDimsOf(gs);
  for (let r = 0; r < dims.rows; r++) {
    for (let col = 0; col < dims.cols; col++) {
      if (circleIntersectsRect(c.x, c.y, c.r, fenceTileRect(r, col))) {
        out.push(fenceTileRef(r, col));
      }
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// 空间查询（暴力 O(n·tiles)，生物数量 ≤ 数十，无需四叉树）
// 所有查询默认只返回存活生物，且按生物实例（id）去重。
// ────────────────────────────────────────────────────────────

function isAlive(c) {
  // 收纳入设施（鸡舍/史莱姆屋关门）的生物不在栅栏空间参与任何查询/命中
  return !!c && c.hp > 0 && !c.dead && !c.housed;
}

function snapshotCircleEntry(entry) {
  return { x: entry.x, y: entry.y, r: entry.radius };
}

/**
 * 几何快照：冻结「逻辑位置 + 半径」，供一次结算使用。
 * 不含任何可变状态（hp/buff 等仍按最新值读取）；渲染层继续用 pos/renderPos 实时绘制。
 * @param {object} gs
 */
export function snapshotGeometry(gs) {
  const creatures = (gs?.creatures || [])
    .filter(isAlive)
    .map((c) => {
      const circle = creatureCircle(c);
      return {
        id: c.id,
        kind: c.kind,
        category: c.category,
        hp: c.hp,
        x: circle.x,
        y: circle.y,
        radius: circle.r,
      };
    });
  const mapDims = mapDimsOf(gs);
  const fenceDims = fenceDimsOf(gs);
  return {
    __geometrySnapshot: true,
    size: gs?.map?.size ?? 3,
    rows: mapDims.rows,
    cols: mapDims.cols,
    fenceRowCols: gs?.map?.fenceRowCols ?? 1,
    fenceRows: fenceDims.rows,
    fenceCols: fenceDims.cols,
    creatures,
  };
}

function isSnapshot(src) {
  return !!src && src.__geometrySnapshot === true;
}

/** 查询对象源的生物列表（活体） */
function sourceCreatures(src) {
  const list = isSnapshot(src) ? src.creatures : (src?.creatures || []);
  return list.filter((c) => (isSnapshot(src) ? c.hp > 0 : isAlive(c)));
}

function sourceCircle(src, c) {
  return isSnapshot(src)
    ? { x: c.x, y: c.y, r: c.radius }
    : creatureCircle(c);
}

/**
 * 落在指定栅栏地块矩形内的生物（圆×框有重叠即算；按实例去重）。
 * 入参：栅栏 ref 或栅栏线性索引；外圈 ref 按域裁剪返回 []。
 * @param {object} gs 或 geometry snapshot
 * @param {object|number} tileRef
 * @returns {object[]}
 */
export function creaturesInTileRect(gs, tileRef) {
  const ref = normalizeFenceRef(gs, tileRef);
  if (!ref) return [];
  const rect = fenceTileRect(ref.row, ref.col);
  const out = [];
  const seen = new Set();
  for (const c of sourceCreatures(gs)) {
    if (seen.has(c.id)) continue;
    const circle = sourceCircle(gs, c);
    if (!circle) continue;
    if (circleIntersectsRect(circle.x, circle.y, circle.r, rect)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/**
 * 多个地块的并集查询：跨格生物只返回一次（按生物实例去重，不按格/物种）。
 * @param {object} gs 或 geometry snapshot
 * @param {Array<object|number>} tileRefs
 * @returns {object[]}
 */
export function creaturesInTiles(gs, tileRefs) {
  const out = [];
  const seen = new Set();
  for (const ref of (tileRefs || [])) {
    const norm = normalizeFenceRef(gs, ref);
    if (!norm) continue;
    const rect = fenceTileRect(norm.row, norm.col);
    for (const c of sourceCreatures(gs)) {
      if (seen.has(c.id)) continue;
      const circle = sourceCircle(gs, c);
      if (!circle) continue;
      if (circleIntersectsRect(circle.x, circle.y, circle.r, rect)) {
        seen.add(c.id);
        out.push(c);
      }
    }
  }
  return out;
}

/**
 * 距给定中心点最近的生物（默认 = 最近的存活敌人，对应 §12.3 默认索敌）。
 * 一律用圆心到圆心直线距离，禁止格距/行列差。
 * @param {object} gs 或 geometry snapshot
 * @param {{x:number,y:number}} point
 * @param {object} [opts]
 * @param {boolean} [opts.enemiesOnly=true] false 时不过滤阵营
 * @param {boolean} [opts.aliveOnly=true]
 * @param {Array<string>} [opts.excludeIds]
 * @param {(c:object)=>boolean} [opts.filter]
 * @returns {object|null}
 */
export function nearestCreatureTo(gs, point, opts = {}) {
  const {
    enemiesOnly = true,
    aliveOnly = true,
    excludeIds = [],
    filter = null,
  } = opts;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const exclude = new Set(excludeIds || []);
  const pool = aliveOnly
    ? sourceCreatures(gs)
    : (isSnapshot(gs) ? (gs.creatures || []) : (gs?.creatures || []));
  let best = null;
  let bestDist = Infinity;
  for (const c of pool) {
    if (exclude.has(c.id)) continue;
    if (enemiesOnly && c.category === 'friendly') continue;
    if (typeof filter === 'function' && !filter(c)) continue;
    const circle = sourceCircle(gs, c);
    if (!circle) continue;
    const d = circleCenterDistance(point, circle);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** 全部存活生物（按实例；空间层不做格级枚举） */
export function allCreatures(gs, { aliveOnly = true } = {}) {
  const list = gs?.creatures || [];
  return aliveOnly ? list.filter(isAlive) : list.slice();
}

/** 栅栏域内所有存活生物（与 allCreatures 等价的域裁剪视图，供未来查询统一入口） */
export function creaturesInFence(gs) {
  return allCreatures(gs);
}

// 聚合导出，便于 `import { Geometry } from ...`
export const Geometry = {
  FENCE_ORIGIN_X,
  FENCE_ORIGIN_Y,
  DEFAULT_CREATURE_RADIUS,
  MAX_TILE_PX,
  MIN_TILE_PX,
  clamp,
  circleCenterDistance,
  circleIntersectsRect,
  pointInRect,
  rectsOverlap,
  outerTileRef,
  fenceTileRef,
  isFenceTileRef,
  gridCellOfFence,
  fenceCellOfGrid,
  fenceTileIndex,
  mapDims,
  normalizeFenceRef,
  normalizeTileRef,
  tileCenter,
  tileRect,
  fenceTileRect,
  fenceRect,
  outerTileCount,
  allOuterTileRefs,
  allFenceTileRefs,
  computeTilePx,
  creatureRadius,
  creatureCircle,
  creatureRenderCircle,
  creatureTileRefs,
  snapshotGeometry,
  creaturesInTileRect,
  creaturesInTiles,
  nearestCreatureTo,
  allCreatures,
  creaturesInFence,
};

export default Geometry;
