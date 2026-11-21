// src/core/TileAccess.js
// 统一地块视图（纯函数优先，除玩家位置写入外无副作用）
//
// 背景：《设计文档 v0.6》§9.6「小径」——生效的小径格虽然物理上位于栅栏内，
// 但在规则上被当作外圈地块。为避免「外圈 idx / 栅栏 row,col」两套坐标散落各处，
// 所有需要「可放置/可进入/可祈福」的地块统一走本模块：
//   - ref 口径：外圈 = 数字 idx；栅栏 = { kind:'fence', row, col }
//   - contentRefs() = 全部外圈格 + 当前生效的小径格
//   - 玩家位置统一存 gs.player.loc，player.x 仅作为外圈 idx 的兼容镜像（栅栏时为 null）
//
// 禁止在本模块里写任何规则分支（连通判定在 PathGraph，副作用在 PathSystem）。

import {
  outerTileRef,
  fenceTileRef,
  normalizeTileRef,
  isFenceTileRef,
  fenceCellOfGrid,
  tileCenter,
} from './Geometry.js';
import {
  mapDimsOf,
  fenceDimsOf,
  outerIdxToXY,
  outerXYToIdx,
  outerRingCount,
} from './Distance.js';
import { normalizeTerrain } from '../data/terrains.js';

export const PATH_TERRAIN = 'terrain_path';

/** [上,右,下,左] 的网格增量 */
export const DIR_DELTA = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

export function isFenceRef(ref) {
  return isFenceTileRef(ref);
}

/** 地块稳定键：外圈 'o:3'，栅栏 'f:1,2'（用于技能实例、访问记录、去重） */
export function tileRefKey(ref) {
  if (typeof ref === 'number') return `o:${ref}`;
  if (ref && ref.kind === 'outer' && Number.isInteger(ref.idx)) return `o:${ref.idx}`;
  if (isFenceTileRef(ref)) return `f:${ref.row},${ref.col}`;
  return null;
}

export function parseTileRefKey(key) {
  if (typeof key !== 'string') return null;
  if (key.startsWith('o:')) {
    const idx = Number(key.slice(2));
    return Number.isInteger(idx) && idx >= 0 ? idx : null;
  }
  if (key.startsWith('f:')) {
    const [row, col] = key.slice(2).split(',').map(Number);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
    return fenceTileRef(row, col);
  }
  return null;
}

/** 归一化为内部的 ref 口径（外圈 → 数字；栅栏 → fence ref） */
export function normalizeRef(gs, ref) {
  const n = normalizeTileRef(gs, ref);
  if (!n) return null;
  return n.kind === 'outer' ? n.idx : fenceTileRef(n.row, n.col);
}

export function refsEqual(a, b) {
  const ka = tileRefKey(a);
  return ka !== null && ka === tileRefKey(b);
}

export function fenceIdxOf(gs, ref) {
  const n = normalizeTileRef(gs, ref);
  if (!n || n.kind !== 'fence') return -1;
  return n.row * fenceDimsOf(gs).cols + n.col;
}

export function fenceRefOfIdx(gs, fenceIdx) {
  const dims = fenceDimsOf(gs);
  const cols = dims.cols || 1;
  return fenceTileRef(Math.floor(fenceIdx / cols), fenceIdx % cols);
}

export function fenceCellOf(gs, ref) {
  const n = normalizeTileRef(gs, ref);
  if (!n || n.kind !== 'fence') return null;
  return gs.map?.fence?.[n.row * fenceDimsOf(gs).cols + n.col] || null;
}

/** 是否为「生效的小径格」（栅栏内、地形小径、已判定连通） */
export function isPathOuterTile(gs, ref) {
  const cell = fenceCellOf(gs, ref);
  return !!(cell && cell.isPathOuter === true);
}

/**
 * 单一判定：该地块当前是否按「外圈」对待（外圈格 + 生效小径格）。
 * 信息区 tab 生成 / 地块内容 tab / 「前往」可点击性等**全部从它取**，
 * 禁止在各处用 `cell.isPathOuter` 或「栅栏格相邻即可前往」自行推断。
 */
export function isEffectiveOuterRef(gs, ref) {
  const n = normalizeTileRef(gs, ref);
  if (!n) return false;
  if (n.kind === 'outer') return true;
  return isPathOuterTile(gs, ref);
}

export function isOuterRef(gs, ref) {
  const n = normalizeTileRef(gs, ref);
  return !!n && n.kind === 'outer';
}

/** 是否为玩家可站的合法地块（外圈 + 生效小径）—— 与 isEffectiveOuterRef 同口径 */
export function isLegalStandRef(gs, ref) {
  return isEffectiveOuterRef(gs, ref);
}

/** 取地块对象（外圈/栅栏统一入口） */
export function getTile(gs, ref) {
  const n = normalizeTileRef(gs, ref);
  if (!n) return null;
  if (n.kind === 'outer') return gs.map?.outerTiles?.[n.idx] || null;
  return gs.map?.fence?.[n.row * fenceDimsOf(gs).cols + n.col] || null;
}

/** 地块 ref → 网格坐标 */
export function refXY(gs, ref) {
  const n = normalizeTileRef(gs, ref);
  if (!n) return null;
  if (n.kind === 'outer') return outerIdxToXY(mapDimsOf(gs), n.idx);
  return { x: n.col + 1, y: n.row + 1 };
}

/** 网格坐标 → 地块 ref（先栅栏后外圈；越界返回 null） */
export function refOfXY(gs, x, y) {
  const dims = mapDimsOf(gs);
  if (x < 0 || y < 0 || x >= dims.cols || y >= dims.rows) return null;
  const f = fenceCellOfGrid(gs, x, y);
  if (f) return fenceTileRef(f.row, f.col);
  const idx = outerXYToIdx(dims, x, y);
  return idx === null ? null : idx;
}

/** 4 邻接地块 ref（dirIdx：0 上 / 1 右 / 2 下 / 3 左；越界 null） */
export function neighborRef(gs, ref, dirIdx) {
  const p = refXY(gs, ref);
  if (!p) return null;
  const d = DIR_DELTA[dirIdx];
  if (!d) return null;
  return refOfXY(gs, p.x + d.dx, p.y + d.dy);
}

/** 4 邻接全部地块 ref（不含 null） */
export function neighborRefs(gs, ref) {
  return [0, 1, 2, 3].map((d) => neighborRef(gs, ref, d)).filter((r) => r !== null);
}

/** [左上,上,右上,左,右,左下,下,右下] 的网格增量（8 邻接） */
export const DIR8_DELTA = [
  { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
  { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
  { dx: -1, dy: 1 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 },
];

/** 8 邻接全部地块 ref（不含 null、不含自身） */
export function neighborRefs8(gs, ref) {
  const p = refXY(gs, ref);
  if (!p) return [];
  const out = [];
  for (const d of DIR8_DELTA) {
    const r = refOfXY(gs, p.x + d.dx, p.y + d.dy);
    if (r !== null) out.push(r);
  }
  return out;
}

/** 两个地块是否 4 邻接 */
export function areAdjacent(gs, a, b) {
  const p = refXY(gs, a);
  const q = refXY(gs, b);
  if (!p || !q) return false;
  return Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
}

/** 网格曼哈顿距离（不按外圈环距离） */
export function gridManhattan(gs, a, b) {
  const p = refXY(gs, a);
  const q = refXY(gs, b);
  if (!p || !q) return Infinity;
  return Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
}

/** 当前生效的小径栅栏格（按栅栏数组顺序） */
export function effectivePathRefs(gs) {
  const list = gs.map?.fence || [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i]?.isPathOuter === true) out.push(fenceRefOfIdx(gs, i));
  }
  return out;
}

export function effectivePathCount(gs) {
  return (gs.map?.fence || []).filter((c) => c?.isPathOuter === true).length;
}

/**
 * 全部「按外圈对待」的地块：外圈格 + 生效小径格。
 * @returns {{ref:(number|object), tile:object, isFence:boolean}[]}
 */
export function contentEntries(gs) {
  const out = [];
  const outer = gs.map?.outerTiles || [];
  for (let i = 0; i < outer.length; i++) {
    if (outer[i]) out.push({ ref: i, tile: outer[i], isFence: false });
  }
  const fence = gs.map?.fence || [];
  const dims = fenceDimsOf(gs);
  const cols = dims.cols || 1;
  for (let i = 0; i < fence.length; i++) {
    const cell = fence[i];
    if (cell?.isPathOuter === true) {
      out.push({
        ref: fenceTileRef(Math.floor(i / cols), i % cols),
        tile: cell,
        isFence: true,
      });
    }
  }
  return out;
}

/** 只取有内容的生效地块 entry（外圈 + 生效小径） */
export function contentfulEntries(gs) {
  return contentEntries(gs).filter((e) => e.tile?.contentId);
}

/** 玩家当前位置 ref（非法/旧档时回落到外圈 idx） */
export function playerRef(gs) {
  const p = gs?.player;
  if (!p) return null;
  // 兼容直接写 player.x 的旧代码 / 测试 / 存档：外圈索引优先（同步口径见 setPlayerRef）
  if (Number.isInteger(p.x)) {
    const n = normalizeTileRef(gs, p.x);
    if (n && n.kind === 'outer') return n.idx;
  }
  const loc = p.loc;
  if (loc && isFenceTileRef(loc)) {
    const n = normalizeTileRef(gs, loc);
    if (n && n.kind === 'fence') return fenceTileRef(n.row, n.col);
  }
  if (loc && loc.kind === 'outer' && Number.isInteger(loc.idx)) {
    const n = normalizeTileRef(gs, loc.idx);
    if (n && n.kind === 'outer') return n.idx;
  }
  return null;
}

/** 写入玩家位置（同时维护 player.x / position 兼容镜像） */
export function setPlayerRef(gs, ref) {
  const n = normalizeTileRef(gs, ref);
  if (!n) return false;
  const p = gs.player;
  if (n.kind === 'outer') {
    p.loc = { kind: 'outer', idx: n.idx };
    p.x = n.idx;
    p.y = 0;
    p.position = 'outer';
  } else {
    p.loc = { kind: 'fence', row: n.row, col: n.col };
    p.x = null;
    p.y = 0;
    p.position = 'fence';
  }
  return true;
}

export function isPlayerAt(gs, ref) {
  return refsEqual(playerRef(gs), ref);
}

/** 玩家所在地块中心（逻辑坐标） */
export function playerCenter(gs) {
  const ref = playerRef(gs);
  return ref === null ? null : tileCenter(gs, ref);
}

/** 当前地形是否为小径 */
export function isPathTerrain(terrain) {
  return normalizeTerrain(terrain) === PATH_TERRAIN;
}

/** 外圈格总数（便捷导出） */
export function outerCount(gs) {
  const d = mapDimsOf(gs);
  return outerRingCount(d.rows, d.cols);
}

/** 合法落点 ref 列表（外圈 + 生效小径） */
export function legalStandRefs(gs) {
  const out = [];
  const n = outerCount(gs);
  for (let i = 0; i < n; i++) out.push(i);
  for (const r of effectivePathRefs(gs)) out.push(r);
  return out;
}

export const TileAccess = {
  PATH_TERRAIN,
  DIR_DELTA,
  DIR8_DELTA,
  isFenceRef,
  tileRefKey,
  parseTileRefKey,
  normalizeRef,
  refsEqual,
  fenceIdxOf,
  fenceRefOfIdx,
  fenceCellOf,
  isPathOuterTile,
  isEffectiveOuterRef,
  isOuterRef,
  isLegalStandRef,
  getTile,
  refXY,
  refOfXY,
  neighborRef,
  neighborRefs,
  neighborRefs8,
  areAdjacent,
  gridManhattan,
  effectivePathRefs,
  effectivePathCount,
  contentEntries,
  contentfulEntries,
  playerRef,
  setPlayerRef,
  isPlayerAt,
  playerCenter,
  isPathTerrain,
  outerCount,
  legalStandRefs,
};

export default TileAccess;
