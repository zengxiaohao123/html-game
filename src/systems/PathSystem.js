// src/systems/PathSystem.js
// 「小径」状态机（有状态、负责所有副作用）
//
// 职责：
//   1. recomputePathEffect —— 连通判定 → 差集 → 新失效格还原 / 新生效格打标 → 容量同步
//   2. revertFenceTiles   —— 还原：按既有拆除规则清内容（静默）→ 角色传送
//   3. teleportPlayerToNearestLegal —— 曼哈顿最近合法格（外圈 + 仍生效小径）
//   4. initPathOnLoad     —— 读档后重算并静默校正玩家位置
//
// 还原顺序（用户裁定 24/25/26）：先清内容，再传送角色，最后同步容量。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { syncBlueBreath } from './BlueBreathSystem.js';
import { devLog } from '../core/Logger.js';
import { computePathComponents } from '../core/PathGraph.js';
import {
  fenceRefOfIdx,
  effectivePathRefs,
  isLegalStandRef,
  playerRef,
  setPlayerRef,
  refsEqual,
  refXY,
  tileRefKey,
} from '../core/TileAccess.js';
import { CapacitySystem } from './CapacitySystem.js';
import { InventorySystem } from './InventorySystem.js';
import { LinkSkillSystem } from './LinkSkillSystem.js';
import { harvestCropBeforeRemove } from './CropHarvest.js';
import { removeCreaturesOwnedByTile } from './CreatureSystem.js';
import { HookDispatcher } from '../core/HookDispatcher.js';

/** 家拥有【永恒】词条：禁止放到「临时外圈」的小径格上（用户裁定 24） */
const UNREPLACEABLE = new Set(['facility_home']);

function emitFenceUpdated(gs, fenceIdx) {
  const dims = gs.map?.fence?.length || 1;
  const cols = gs.map?.fenceCols || gs.map?.fenceRowCols || 1;
  EventBus.emit(GE.TILE_UPDATED, { fenceIdx, row: Math.floor(fenceIdx / cols), col: fenceIdx % cols });
  EventBus.emit(GE.FENCE_TILE_UPDATED, {
    fenceIdx,
    row: Math.floor(fenceIdx / cols),
    col: fenceIdx % cols,
  });
  void dims;
}

/**
 * 清空一个（即将失效的）生效小径格上的地块内容。
 * 完全沿用「拆除」规则，但不要求建造模式、不弹提示（用户裁定 25）。
 */
export function stripFenceContent(gs, fenceIdx, { reason = 'pathReverted' } = {}) {
  const cell = gs.map?.fence?.[fenceIdx];
  if (!cell || !cell.contentId) return;
  const removedId = cell.contentId;
  if (UNREPLACEABLE.has(removedId)) {
    // 理论上禁止放置；这里只做兜底：永恒内容不可拆除
    devLog.warn('[PathSystem] skip removing unreplaceable content:', removedId);
    return;
  }
  harvestCropBeforeRemove(gs, cell, fenceRefOfIdx(gs, fenceIdx));
  removeCreaturesOwnedByTile(gs, cell, { reason });
  cell.contentId = null;
  cell.contentState = {};
  if (removedId.startsWith('skill_')) {
    LinkSkillSystem.onSkillCardRemoved(gs, fenceRefOfIdx(gs, fenceIdx), removedId);
    InventorySystem.addItem(gs, removedId, 1);
  }
  HookDispatcher.fire('onReplace', {
    gs,
    tileIdx: null,
    tileRef: fenceRefOfIdx(gs, fenceIdx),
    oldContentId: removedId,
    newContentId: null,
  });
  emitFenceUpdated(gs, fenceIdx);
  EventBus.emit(GE.TILE_CONTENT_CHANGED, { fenceIdx, tileRef: fenceRefOfIdx(gs, fenceIdx) });
  devLog.info('[PathSystem] revert removed content', removedId, 'at fence', fenceIdx);
}

/**
 * 把角色传送到曼哈顿距离最近的合法地块。
 * 合法 = 外圈格 + 仍生效的小径格；不耗行动力 / 不推回合 / 不触发任何移动钩子。
 * 同距时优先外圈格，再按外圈 idx 升序（用户裁定 26）。
 */
export function teleportPlayerToNearestLegal(gs) {
  const from = playerRef(gs);
  if (from === null) return false;
  if (isLegalStandRef(gs, from)) return false;

  let best = null;
  let bestDist = Infinity;
  let bestIsOuter = false;
  const outerCount = gs.map?.outerTiles?.length || 0;
  const candidates = [];
  for (let i = 0; i < outerCount; i++) candidates.push(i);
  for (const r of effectivePathRefs(gs)) candidates.push(r);

  for (const ref of candidates) {
    if (!isLegalStandRef(gs, ref)) continue;
    const a = refXY(gs, ref);
    const b = refXY(gs, from);
    if (!a || !b) continue;
    const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const isOuter = typeof ref === 'number';
    const better = d < bestDist
      || (d === bestDist && isOuter && !bestIsOuter)
      || (d === bestDist && isOuter === bestIsOuter && isOuter && ref < best);
    if (better) {
      best = ref;
      bestDist = d;
      bestIsOuter = isOuter;
    }
  }

  if (best === null) return false;
  setPlayerRef(gs, best);
  syncBlueBreath(gs);
  EventBus.emit(GE.MOVE, {
    fromIdx: typeof from === 'number' ? from : null,
    toIdx: typeof best === 'number' ? best : null,
    fromRef: from,
    toRef: best,
    teleported: true,
    path: [],
  });
  devLog.info('[PathSystem] teleport player to nearest legal tile:', tileRefKey(best));
  return true;
}

/**
 * 重算全部小径的生效状态，并处理还原 / 打标 / 容量。
 * @param {object} gs
 * @param {{reason?:string}} [opts]
 * @returns {{activated:number[], reverted:number[], effectiveCount:number}}
 */
export function recomputePathEffect(gs, { reason = 'recompute' } = {}) {
  if (!gs?.map?.fence) return { activated: [], reverted: [], effectiveCount: 0 };
  const { effectiveFence, effectiveCount } = computePathComponents(gs);
  const activated = [];
  const reverted = [];

  for (let i = 0; i < gs.map.fence.length; i++) {
    const cell = gs.map.fence[i];
    if (!cell) continue;
    const should = effectiveFence.has(i);
    if (should && cell.isPathOuter !== true) {
      cell.isPathOuter = true;
      activated.push(i);
    } else if (!should && cell.isPathOuter === true) {
      cell.isPathOuter = false;
      reverted.push(i);
    }
  }

  // 先完成所有标记，再做清除（清除时的合法性/传送目标都必须看到最终状态）
  for (const i of reverted) stripFenceContent(gs, i, { reason });
  if (reverted.length > 0) teleportPlayerToNearestLegal(gs);

  for (const i of [...activated, ...reverted]) emitFenceUpdated(gs, i);

  if (reverted.length > 0) CapacitySystem.markCapacityWarningToday(gs);
  else CapacitySystem.syncCapacityLimits(gs, 'path');

  EventBus.emit(GE.PATH_EFFECT_CHANGED, {
    reason,
    activated,
    reverted,
    effectiveCount,
  });

  return { activated, reverted, effectiveCount };
}

/** 读档 / 新游戏初始化：重算并静默校正（旧档可能没有 isPathOuter） */
export function initPathOnLoad(gs) {
  for (const cell of gs?.map?.fence || []) {
    if (cell && typeof cell.isPathOuter !== 'boolean') cell.isPathOuter = false;
  }
  const result = recomputePathEffect(gs, { reason: 'load' });
  CapacitySystem.syncCapacityLimits(gs, 'pathLoad');
  return result;
}

/** 该地块是否允许放置【永恒】类内容（临时外圈格禁止） */
export function canHostEternalContent(gs, ref) {
  const isFence = !!ref && typeof ref === 'object';
  if (!isFence) return true;
  void gs;
  return false;
}

export const PathSystem = {
  recomputePathEffect,
  /** 显式还原指定小径格（地形被改写等场景）；ref 支持外圈 idx / fence ref */
  revertTiles: (gs, refs, opts) => {
    for (const ref of refs || []) {
      const idx = typeof ref === 'number' ? ref : gs.map.fence.indexOf(
        gs.map.fence.find((c) => c && c.row === ref.row && c.col === ref.col),
      );
      const cell = gs.map?.fence?.[idx];
      if (cell) cell.isPathOuter = false;
    }
    return recomputePathEffect(gs, opts);
  },
  teleportPlayerToNearestLegal,
  stripFenceContent,
  initPathOnLoad,
  canHostEternalContent,
};

export default PathSystem;
