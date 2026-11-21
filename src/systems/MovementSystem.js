// src/systems/MovementSystem.js
// 移动系统：WASD 驱动
// 核心约定：
//   1. 玩家位置统一走 TileAccess（外圈 idx / 栅栏 fence ref），WASD 只走「直线 1 格」
//   2. 不可移动时返回 null，不扣 stamina、不触发 hook、不更新 GS
//
// v0.5 扩展（保留）：
//   - 【冰面】徒步进入时被迫沿原方向滑行：滑到非冰面、或无法继续直行（拐角）才停。
//     滑行不额外扣行动力；每滑过一格都触发【经过时】，终点触发【进入时】。
//     使用载具移动不受滑行影响（走 VehicleSystem，不经过这里的滑行逻辑）。
//   - WASD 与「前往」共用同一条「1 格移动」入口 moveStep。
//
// v0.6 扩展（小径）：
//   - 生效小径格视为外圈地块：可以站上去、可以被徒步/载具当作落点（用户裁定 12/13/14）
//   - 冰面只可能出现在外圈格；栅栏内的小径地形不可能是冰面，因此滑行逻辑不会被小径影响
//   - 栅栏格没有外圈 idx，事件同时携带 fromRef/toRef，兼容旧 UI

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { Direction } from '../utils/Direction.js';
import { devLog } from '../core/Logger.js';
import { firePassHooksAlong, fireEnterHooks } from './MoveHooks.js';
import { CombatSystem } from './CombatSystem.js';
import { TalentSystem } from './TalentSystem.js';
import { VehicleSystem } from './VehicleSystem.js';
import { StaminaSystem } from './StaminaSystem.js';
import { normalizeTerrain } from '../data/terrains.js';
import { syncBlueBreath } from './BlueBreathSystem.js';
import {
  playerRef,
  setPlayerRef,
  neighborRef,
  getTile,
  tileRefKey,
  fenceIdxOf,
  refsEqual,
} from '../core/TileAccess.js';

/** 该地块地形是否为冰面 */
function isIce(gs, ref) {
  const tile = getTile(gs, ref);
  return !!tile && normalizeTerrain(tile.terrain) === 'terrain_ice';
}

/** 广播地块更新（外圈用 tileIdx，栅栏用 fenceIdx + tileRef） */
export function emitTileUpdated(gs, ref) {
  if (typeof ref === 'number') EventBus.emit(GE.TILE_UPDATED, { tileIdx: ref });
  else EventBus.emit(GE.TILE_UPDATED, { tileIdx: null, tileRef: ref, fenceIdx: fenceIdxOf(gs, ref) });
}

/**
 * 计算本次移动的完整路径（含冰面滑行），不产生任何副作用。
 * @returns {Array<number|object>} 依次经过的 ref（不含起点）；第一步不可走时返回 []
 */
export function resolvePath(gs, dirIdx) {
  const startRef = playerRef(gs);
  if (startRef === null) return [];
  const path = [];
  const keys = new Set([tileRefKey(startRef)]);

  let cur = startRef;
  let next = neighborRef(gs, cur, dirIdx);
  if (next === null) return [];
  // 生效小径以外的栅栏格不是合法落点（普通栅栏仍不可进入）
  if (typeof next !== 'number' && !getTile(gs, next)?.isPathOuter) return [];
  path.push(next);
  keys.add(tileRefKey(next));
  cur = next;

  // 冰面滑行：只要落在冰面上，就继续沿同一方向前进；无法直行（拐角/边界）则停下
  let guard = 0;
  while (isIce(gs, cur) && guard++ < 64) {
    const ahead = neighborRef(gs, cur, dirIdx);
    if (ahead === null) break;
    if (typeof ahead !== 'number' && !getTile(gs, ahead)?.isPathOuter) break;
    const k = tileRefKey(ahead);
    if (keys.has(k)) break;
    path.push(ahead);
    keys.add(k);
    cur = ahead;
  }
  return path;
}

/** 记录"本日进入过的地块"（momo 图腾优先传送用） */
function markVisited(gs, ref) {
  if (!Array.isArray(gs.player.visitedTodayRefs)) gs.player.visitedTodayRefs = [];
  const k = tileRefKey(ref);
  if (k && !gs.player.visitedTodayRefs.includes(k)) gs.player.visitedTodayRefs.push(k);
  if (typeof ref === 'number') {
    if (!Array.isArray(gs.player.visitedTodayIdx)) gs.player.visitedTodayIdx = [];
    if (!gs.player.visitedTodayIdx.includes(ref)) gs.player.visitedTodayIdx.push(ref);
  }
}

/**
 * 尝试移动玩家
 * @param {object} gs 全局状态（会被直接修改）
 * @param {string} direction 'up' | 'right' | 'down' | 'left'
 * @returns {{ ok: boolean, finalIdx: number|null, finalRef: (number|object)|null, byVehicle: boolean, blocked: boolean }}
 */
export function moveStep(gs, direction) {
  const dirIdx = Direction.dirToIndex(direction);
  if (dirIdx === -1) {
    devLog.warn('[MovementSystem] 非法方向:', direction);
    return { ok: false, finalIdx: null, finalRef: null, byVehicle: false, blocked: false };
  }

  const fromRef = playerRef(gs);
  if (fromRef === null) {
    return { ok: false, finalIdx: null, finalRef: null, byVehicle: false, blocked: false };
  }
  // 「走 1 格」的目标格：只看相邻一格（不含冰面滑行 —— 滑行是徒步专属的地形位移）
  const stepRef = neighborRef(gs, fromRef, dirIdx);
  const stepLegal = stepRef !== null
    && (typeof stepRef === 'number' || getTile(gs, stepRef)?.isPathOuter === true);
  const vehicleStep = VehicleSystem.canUseVehicleForStep(gs, stepLegal ? stepRef : null);

  if (!stepLegal) {
    // 该方向没有可站的相邻格（边界/普通栅栏格）：装备载具时同样按「载具不允许」静默拦截
    if (vehicleStep.status !== VehicleSystem.VEHICLE_STEP_STATUS.NO_VEHICLE) {
      devLog.info('[MovementSystem] 载具不允许该方向，按键拦截:', direction);
      return { ok: false, finalIdx: null, finalRef: null, byVehicle: false, blocked: true };
    }
    devLog.info('[MovementSystem] 方向', direction, '不可通行');
    EventBus.emit(GE.MOVE_BLOCKED, {
      direction,
      currentIdx: typeof fromRef === 'number' ? fromRef : null,
      currentRef: fromRef,
    });
    return { ok: false, finalIdx: null, finalRef: null, byVehicle: false, blocked: false };
  }

  // 装备了载具但该载具不允许这 1 格 → 直接阻止本次 WASD（无提示、无联动、不改变任何状态）
  if (vehicleStep.status === VehicleSystem.VEHICLE_STEP_STATUS.BLOCKED) {
    devLog.info('[MovementSystem] 载具不允许该格，按键拦截:', vehicleStep.reason);
    return { ok: false, finalIdx: null, finalRef: null, byVehicle: false, blocked: true };
  }

  // 载具允许：收敛到 VehicleSystem.tryMove 的统一载具流程
  if (vehicleStep.status === VehicleSystem.VEHICLE_STEP_STATUS.ALLOWED) {
    const r = VehicleSystem.tryMove(gs, { targetRef: stepRef, wasdStep: true });
    if (r.ok) {
      devLog.info('[MovementSystem] WASD 载具移动成功:', tileRefKey(fromRef), '→', tileRefKey(r.finalRef));
      return { ok: true, finalIdx: r.finalIdx, finalRef: r.finalRef, byVehicle: true, blocked: false };
    }
    devLog.info('[MovementSystem] WASD 载具移动未生效，按键拦截:', r.reason);
    return { ok: false, finalIdx: null, finalRef: null, byVehicle: false, blocked: true };
  }

  // 徒步：未装备载具，WASD 走 1 步；冰面会额外滑行（滑行不额外扣行动力）
  const path = resolvePath(gs, dirIdx);
  if (path.length === 0) {
    devLog.info('[MovementSystem] 方向', direction, '不可通行');
    EventBus.emit(GE.MOVE_BLOCKED, {
      direction,
      currentIdx: typeof fromRef === 'number' ? fromRef : null,
      currentRef: fromRef,
    });
    return { ok: false, finalIdx: null, finalRef: null, byVehicle: false, blocked: false };
  }

  const finalRef = path[path.length - 1];
  const finalIdx = typeof finalRef === 'number' ? finalRef : null;

  // 1. 扣 stamina：整段移动只扣 1 点（滑行是"被迫"的，不额外消耗）
  const isFreeMove = !!gs.player.nextMoveNoStamina;
  if (isFreeMove) {
    gs.player.nextMoveNoStamina = false;
    devLog.info('[MovementSystem] 芋圆免行动力触发，本次移动不扣 stamina');
  } else {
    StaminaSystem.spendStaminaActive(gs, 1, { reason: 'move' });
  }

  // 2. 逐格结算【经过时】
  firePassHooksAlong(gs, path);

  // 2b. 粘液 debuff：仅最终停留格结算
  {
    const tile = getTile(gs, finalRef);
    if (tile && Array.isArray(tile.states)) {
      const slimeIdx = tile.states.findIndex((s) => s.type === 'slime');
      if (slimeIdx >= 0) {
        CombatSystem.applyTrueDamageToPlayer(gs, gs.player, 5, { reason: 'slime_hit' });
        StaminaSystem.loseStaminaNegativeEffect(gs, 1, { reason: 'slime_hit' });
        tile.states.splice(slimeIdx, 1);
        EventBus.emit(GE.TOAST_SHOW, { text: '🟢 粘液：hp -5 stamina -1', duration: 1500 });
        devLog.info('[MovementSystem] slime state triggered → removed');
      }
    }
  }

  // 3. 更新玩家位置（冰面滑行的终点）
  setPlayerRef(gs, finalRef);
  for (const ref of path) markVisited(gs, ref);
  // 蓝息光环随位置动态更新（进入/离开范围即时生效）
  syncBlueBreath(gs);

  // 4. 触发【进入时】：仅最终停留格
  fireEnterHooks(gs, finalRef);

  // 5. 广播 MOVE 事件（路径长度 = 本次经过的格数，与载具口径一致）
  const distance = path.length;
  EventBus.emit(GE.MOVE, {
    fromIdx: typeof fromRef === 'number' ? fromRef : null,
    toIdx: finalIdx,
    fromRef,
    toRef: finalRef,
    direction,
    path,
    distance,
  });
  emitTileUpdated(gs, fromRef);
  emitTileUpdated(gs, finalRef);

  // 6. 【移动后】：走完整段路径后触发一次
  if (!gs.team) gs.team = {};
  gs.team.dailyDistanceMoved = (gs.team.dailyDistanceMoved || 0) + distance;
  HookDispatcher.fire('onMoveEnd', {
    gs,
    distance,
    fromIdx: typeof fromRef === 'number' ? fromRef : null,
    toIdx: finalIdx,
    fromRef,
    toRef: finalRef,
  });
  TalentSystem.onMoveEnd(gs);

  if (distance > 1) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🧊 冰面滑行 ${distance} 格`, duration: 1200 });
  }
  devLog.info('[MovementSystem] 移动成功:', tileRefKey(fromRef), '→', tileRefKey(finalRef), direction, 'distance=', distance);
  return { ok: true, finalIdx, finalRef, byVehicle: false, blocked: false };
}

/**
 * 兼容旧调用：只关心最终停留格（失败 null）。
 * @returns {number|null}
 */
export function move(gs, direction) {
  const r = moveStep(gs, direction);
  return r.ok ? r.finalIdx : null;
}

export const MovementSystem = {
  move,
  moveStep,
  resolvePath,
  emitTileUpdated,
};
