// src/systems/MapExpandSystem.js
// 农场扩建（道具 ITM-BK-003 / ITM-BK-004）——设计文档 v0.5 §2.1.1
//
// 物品库描述（玩家可见，逐字）：
//   农场扩建I型：农场的长度增加1格
//   农场扩建II型：农场的宽度增加1格
// 物品库备注（内部规则，不展示）：
//   I 型：长度 = 列数 +1。先把最右侧 1 列向右移动 1 格距离，再在原来的最右 1 列
//         （现在已空）新增外圈和栅栏内地块。若角色恰好在被移动的地块上，角色跟随移动
//         （本次移动不视为真正的移动，不触发任何效果/技能结算）。
//   II 型：宽度 = 行数 +1。先把最上侧 1 行向上移动 1 格距离，再在原来的最上 1 行
//         （现在已空）新增外圈和栅栏内地块。角色跟随规则同上。
//
// 实现要点：
//   1. 地图是 rows×cols 矩形网格（rows = 宽度/行数，cols = 长度/列数），外圈 idx 按
//      Distance.outerIdxToXY 的顺时针顺序重建；旧地块按「网格坐标」搬运，保证已放置
//      内容（设施/技能/物品/每日标记）跟随原地块一起移动。
//   2. 栅栏内区域 = (rows-2)×(cols-2)：
//        列扩建：栅栏向左锚定，新增一列栅栏插在原最右栅栏列之后、原最右外圈列之左；
//        行扩建：新增一行栅栏插在顶行之下；原栅栏内容整体下移 1 行。
//   3. 外圈下标会整体变化 → 玩家位置、连携技实例键（tileIdx|skillId）、连携队列、
//      UI 选中格、今日已访问格、生物归属 sourceTileIdx 全部重映射；栅栏内生物行扩建时
//      pos.y +1（世界坐标原点随顶行上移），主格缓存 row/col 同步重算。
//   4. 扩建是「当天内的世界变化」：不写日初基线，只在睡觉/跨日采集点随实时状态入档；
//      当天回档时地图尺寸与扩建道具一起回到本日开始时。
//   5. 新外圈与新栅栏内地块共用 §4 的 50/40/10 地形抽取；初始 3×3 已有栅栏格不回溯。
//   6. 对外契约（供其它系统重映射自己的裸索引引用）：
//        expandMapInPlace 返回值与 GE.MAP_EXPANDED payload 都带 `idxMap`（旧外圈 idx → 新 idx）
//        与 `remap`：
//          remap.outerIdx / outerIdxInv      外圈 idx 旧→新 / 新→旧（Map）
//          remap.fenceIdx / fenceIdxInv      栅栏线性 idx 旧→新 / 新→旧（Map）
//          remap.fenceRow / fenceCol         栅栏行 / 列 旧→新（Map）
//          remap.addedOuterIdx / addedFenceIdx  本次新增格的索引（number[]）
//          remap.before / after              扩建前后尺寸（含栅栏行列数）
//        也可通过 getLastExpandRemap() 查询最近一次扩建的映射。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { devLog } from '../core/Logger.js';
import { FENCE_ORIGIN_X, FENCE_ORIGIN_Y } from '../core/Geometry.js';
import { rollSpawnTerrain, getTerrain } from '../data/terrains.js';
import { outerIdxToXY, mapDimsOf } from '../core/Distance.js';
import { syncCapacityLimits } from './CapacitySystem.js';

export const EXPAND_AXIS = {
  LENGTH: 'length',   // I 型：列数 +1
  WIDTH: 'width',     // II 型：行数 +1
};

/** 最近一次扩建的索引映射（供订阅方查询；不写存档） */
let lastExpandRemap = null;
/** 扩建时为旧存档生物补的稳定地块 uid 序号（与 CreatureSystem 的 fac_* 前缀区分，避免冲突） */
let tileUidSeq = 1;

/**
 * 查询最近一次扩建的旧→新索引映射
 * @returns {null|{axis:string, before:object, after:object, outerIdx:Map, outerIdxInv:Map,
 *   fenceIdx:Map, fenceIdxInv:Map, fenceRow:Map, fenceCol:Map,
 *   addedOuterIdx:number[], addedFenceIdx:number[]}}
 */
export function getLastExpandRemap() {
  return lastExpandRemap;
}

/** 新外圈地块（与 createInitialState 的地块 schema 一致） */
function createOuterTile(idx) {
  const terrainId = rollSpawnTerrain();
  return {
    idx,
    terrain: terrainId,
    terrainAmount: getTerrain(terrainId).elementAmount,
    contentId: null,
    states: [],
    dailyFlags: {},
  };
}

/** 新栅栏地块：地形与外圈新地块同一套概率分布（§4 的 50/40/10） */
function createFenceTile(row, col) {
  const terrainId = rollSpawnTerrain();
  return {
    row,
    col,
    terrain: terrainId,
    terrainAmount: getTerrain(terrainId).elementAmount,
    creatures: [],
    items: [],
  };
}

function xyKey(x, y) {
  return `${x},${y}`;
}

/** 旧→新索引映射的反向表（供订阅方双向校验 / 反查） */
function invertMap(m) {
  const inv = new Map();
  for (const [oldIdx, newIdx] of m) inv.set(newIdx, oldIdx);
  return inv;
}

/** 把形如 `tileIdx|skillId` 的键集合整体迁移到新下标 */
function remapKeyedObject(src, idxMap) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return src;
  const next = {};
  for (const [k, v] of Object.entries(src)) {
    const bar = k.indexOf('|');
    if (bar > 0) {
      const oldIdx = Number(k.slice(0, bar));
      if (Number.isInteger(oldIdx) && idxMap.has(oldIdx)) {
        next[`${idxMap.get(oldIdx)}${k.slice(bar)}`] = v;
        continue;
      }
    }
    next[k] = v;
  }
  return next;
}

/**
 * 对单个 gs / 基线对象执行扩建（原地修改）
 * @param {object} gs 目标状态（含 map / player / creatures / uiState / linkSkill*）
 * @param {'length'|'width'} axis
 * @returns {{ok:boolean, before:{rows:number,cols:number}, after:{rows:number,cols:number},
 *   playerFollowed:boolean, idxMap:Map, remap:object}}
 */
export function expandMapInPlace(gs, axis) {
  const map = gs?.map;
  if (!map || !Array.isArray(map.outerTiles) || !Array.isArray(map.fence)) {
    return { ok: false, reason: 'invalidMap' };
  }

  const oldDims = mapDimsOf(map);
  const oldRows = oldDims.rows;
  const oldCols = oldDims.cols;
  if (oldRows < 2 || oldCols < 2) return { ok: false, reason: 'invalidMap' };

  const isLength = axis === EXPAND_AXIS.LENGTH;
  const newRows = isLength ? oldRows : oldRows + 1;
  const newCols = isLength ? oldCols + 1 : oldCols;
  const newDims = { rows: newRows, cols: newCols };
  const oldFDims = { rows: oldRows - 2, cols: oldCols - 2 };
  const newFDims = { rows: newRows - 2, cols: newCols - 2 };

  // ── 1. 旧外圈按网格坐标建索引 ──
  const oldByXY = new Map();
  for (const t of map.outerTiles) {
    const { x, y } = outerIdxToXY(oldDims, t.idx);
    oldByXY.set(xyKey(x, y), t);
  }

  // ── 2. 重建外圈（按新 idx 顺序）──
  const newOuter = [];
  const idxMap = new Map(); // 旧 envelope idx → 新 idx
  const addedOuterIdx = []; // 本次新建的外圈格（旧索引里不存在）
  const totalNew = 2 * newRows + 2 * newCols - 4;
  for (let idx = 0; idx < totalNew; idx++) {
    const { x, y } = outerIdxToXY(newDims, idx);
    let tile = null;
    if (isLength) {
      // 列扩建：原最右列右移 1 格；新列（x = oldCols-1）插在它左边
      if (x === oldCols) tile = oldByXY.get(xyKey(oldCols - 1, y)) || null;
      else if (x < oldCols - 1) tile = oldByXY.get(xyKey(x, y)) || null;
      else tile = null; // x === oldCols-1：新增列
    } else {
      // 行扩建：原顶行留在第 0 行；其余行整体下移 1 格；新行插在顶行之下
      if (y === 0) tile = oldByXY.get(xyKey(x, 0)) || null;
      else if (y >= 2) tile = oldByXY.get(xyKey(x, y - 1)) || null;
      else tile = null; // y === 1：新增行
    }

    if (tile) {
      if (Number.isInteger(tile.idx)) idxMap.set(tile.idx, idx);
      tile.idx = idx;
    } else {
      tile = createOuterTile(idx);
      addedOuterIdx.push(idx);
    }
    newOuter.push(tile);
  }

  // ── 3. 重建栅栏（同时产出 fenceIdx / row / col 的旧→新映射）──
  const newFence = [];
  const fenceIdxMap = new Map();
  const fenceRowMap = new Map();
  const fenceColMap = new Map();
  const addedFenceIdx = [];
  for (let r = 0; r < newFDims.rows; r++) {
    for (let c = 0; c < newFDims.cols; c++) {
      const newFenceIdx = r * newFDims.cols + c;
      // 列扩建：原栅栏列不动，新增一列插在最后（栅栏原点 (1,1) 不变）
      // 行扩建：原栅栏整体下移 1 行，新增一行插在顶行（第 1 行）之下
      const oldTile = isLength
        ? (c < oldFDims.cols ? map.fence[r * oldFDims.cols + c] : null)
        : (r >= 1 ? map.fence[(r - 1) * oldFDims.cols + c] : null);
      if (oldTile) {
        const oldRow = Number.isInteger(oldTile.row) ? oldTile.row : (isLength ? r : r - 1);
        const oldCol = Number.isInteger(oldTile.col) ? oldTile.col : c;
        fenceIdxMap.set(oldRow * oldFDims.cols + oldCol, newFenceIdx);
        if (!fenceRowMap.has(oldRow)) fenceRowMap.set(oldRow, r);
        if (!fenceColMap.has(oldCol)) fenceColMap.set(oldCol, c);
        oldTile.row = r;
        oldTile.col = c;
        newFence.push(oldTile);
      } else {
        addedFenceIdx.push(newFenceIdx);
        newFence.push(createFenceTile(r, c));
      }
    }
  }

  const remap = {
    axis,
    before: { rows: oldRows, cols: oldCols, fenceRows: oldFDims.rows, fenceCols: oldFDims.cols },
    after: { rows: newRows, cols: newCols, fenceRows: newFDims.rows, fenceCols: newFDims.cols },
    outerIdx: idxMap,
    outerIdxInv: invertMap(idxMap),
    fenceIdx: fenceIdxMap,
    fenceIdxInv: invertMap(fenceIdxMap),
    fenceRow: fenceRowMap,
    fenceCol: fenceColMap,
    addedOuterIdx,
    addedFenceIdx,
  };
  lastExpandRemap = remap;

  // ── 4. 更新 map 尺寸 ──
  map.rows = newRows;
  map.cols = newCols;
  map.fenceRows = newFDims.rows;
  map.fenceCols = newFDims.cols;
  // 旧字段：size 取包围盒较大边；fenceRowCols 仅在方阵时与列数一致（矩形请用 fenceRows/Cols）
  map.size = Math.max(newRows, newCols);
  map.fenceRowCols = newFDims.rows;
  map.outerTiles = newOuter;
  map.fence = newFence;

  // ── 5. 玩家位置重映射（角色跟随被移动的地块，不视为一次真正移动）──
  let playerFollowed = false;
  const player = gs.player;
  if (player && Number.isInteger(player.x)) {
    const oldIdx = player.x;
    if (idxMap.has(oldIdx)) {
      const nextIdx = idxMap.get(oldIdx);
      playerFollowed = nextIdx !== oldIdx;
      player.x = nextIdx;
    }
  }
  // 今日已访问格（载具「优先未访问」等按裸索引存）
  if (player && Array.isArray(player.visitedTodayIdx)) {
    player.visitedTodayIdx = player.visitedTodayIdx
      .map((i) => (Number.isInteger(i) && idxMap.has(i) ? idxMap.get(i) : null))
      .filter((i) => i !== null);
  }

  // ── 6. 栅栏内生物：行扩建时世界原点随顶行上移，pos 整体 +1 行；重建主格缓存 ──
  if (!isLength && Array.isArray(gs.creatures)) {
    for (const c of gs.creatures) {
      for (const p of [c.pos, c.renderPos, c.targetPos, c.renderFrom]) {
        if (p && Number.isFinite(p.y)) p.y += 1;
      }
    }
    // 栅栏格缓存以生物 id 保存（与 CreatureSystem 口径一致），按新坐标重建；
    // 收纳在设施内（housed）的生物不占栅栏格缓存。
    for (const f of newFence) f.creatures = [];
    for (const c of gs.creatures) {
      if (!c || c.housed) continue;
      if (!c.pos || !Number.isFinite(c.pos.x) || !Number.isFinite(c.pos.y)) continue;
      const row = Math.floor(c.pos.y) - FENCE_ORIGIN_Y;
      const col = Math.floor(c.pos.x) - FENCE_ORIGIN_X;
      if (row < 0 || row >= newFDims.rows || col < 0 || col >= newFDims.cols) continue;
      c.row = row;
      c.col = col;
      newFence[row * newFDims.cols + col].creatures.push(c.id);
    }
  }

  // ── 7. 依赖外圈下标的键 / 归属重映射 ──
  gs.linkSkillCounters = remapKeyedObject(gs.linkSkillCounters, idxMap);
  gs.linkSkillCooldowns = remapKeyedObject(gs.linkSkillCooldowns, idxMap);
  if (Array.isArray(gs.linkSkillQueue)) {
    for (const e of gs.linkSkillQueue) {
      if (!e) continue;
      if (Number.isInteger(e.tileIdx) && idxMap.has(e.tileIdx)) e.tileIdx = idxMap.get(e.tileIdx);
      if (typeof e.key === 'string') {
        const bar = e.key.indexOf('|');
        const oldIdx = bar > 0 ? Number(e.key.slice(0, bar)) : NaN;
        if (Number.isInteger(oldIdx) && idxMap.has(oldIdx)) {
          e.key = `${idxMap.get(oldIdx)}${e.key.slice(bar)}`;
        }
      }
    }
  }
  if (gs.uiState && Number.isInteger(gs.uiState.selectedTileIdx)) {
    const sel = gs.uiState.selectedTileIdx;
    gs.uiState.selectedTileIdx = idxMap.has(sel) ? idxMap.get(sel) : null;
  }
  // 生物归属（鸡舍/史莱姆屋按 sourceTileIdx 判归属）：索引跟随地块走；
  // 同时补稳定 uid，消费方（CreatureSystem）优先按 uid 归属，天然免疫后续扩建，
  // 也避免订阅方对同一份映射做二次重映射。
  if (Array.isArray(gs.creatures)) {
    for (const c of gs.creatures) {
      if (!c || !Number.isInteger(c.sourceTileIdx)) continue;
      const next = idxMap.get(c.sourceTileIdx);
      if (next === undefined) continue;
      c.sourceTileIdx = next;
      const tile = newOuter[next];
      if (tile) {
        if (!tile.uid) tile.uid = `tile_exp_${tileUidSeq++}`;
        c.sourceTileUid = tile.uid;
      }
    }
  }

  return {
    ok: true,
    axis,
    before: { rows: oldRows, cols: oldCols },
    after: { rows: newRows, cols: newCols },
    playerFollowed,
    idxMap,
    remap,
  };
}

/**
 * 使用扩建道具：扩建实时地图 + 广播 MAP_EXPANDED
 * 扩建属于「当天内的世界变化」：不写日初基线，日初（睡觉/跨日）自然采集后入档；
 * 当天回档时地图尺寸与背包数量一起回到日初状态。
 * @param {object} gs
 * @param {'length'|'width'} axis
 */
export function expandMap(gs, axis) {
  const result = expandMapInPlace(gs, axis);
  if (!result.ok) return result;

  // 栅栏面积变化 → 容量上限立即同步，并广播 CAPACITY_CHANGE（TopBar 同帧重绘）
  syncCapacityLimits(gs);

  EventBus.emit(GE.MAP_EXPANDED, {
    gs, axis, rows: result.after.rows, cols: result.after.cols,
    before: result.before, after: result.after,
    // 与订阅方约定的键名：旧外圈 idx → 新外圈 idx（Map）
    idxMap: result.remap.outerIdx,
    // 完整映射：外圈 / 栅栏 idx / 栅栏 row·col + 新增格列表
    remap: result.remap,
  });
  devLog.info('[MapExpand]', axis, `→ ${result.after.cols}列 × ${result.after.rows}行`);
  return result;
}

export const MapExpandSystem = {
  expandMap,
  expandMapInPlace,
  getLastExpandRemap,
  EXPAND_AXIS,
};
