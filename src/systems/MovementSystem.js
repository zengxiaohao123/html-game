// src/systems/MovementSystem.js
// 移动系统：WASD 驱动，外圈 8 格回字形地图
// 核心约定：
//   1. Direction → Distance 邻居映射：dirToIndex(direction) → outerNeighbors 返回数组下标
//   2. 不可移动时返回 null，不扣 stamina、不触发 hook、不更新 GS
//
// Phase 3 扩展：
//   - onPass / onEnter HookDispatcher.fire 之后，再调 SkillSystem.triggerSkillByHook
//     （让角色技能自动攻击栅栏内的危险生物）
//   - 额外：粘液 debuff 检查（若 tile 有粘液 state → hp -5 stamina -1 然后移除）
//
// v0.5 扩展：
//   - 【冰面】徒步进入时被迫沿原方向滑行：滑到非冰面、或无法继续直行（拐角）才停。
//     滑行不额外扣行动力；每滑过一格都触发【经过时】，终点触发【进入时】。
//     使用载具移动不受滑行影响（走 VehicleSystem，不经过这里的滑行逻辑）。
//   - WASD 与「前往」共用同一条「1 格移动」入口 moveStep：
//     未装备载具 → 徒步跋涉；载具规则允许落到相邻这一格 → 按「使用载具」结算
//     （VehicleSystem.tryMove，消耗次数并派生 byVehicle 事件 / 移形等联动）；
//     装备载具但该载具不允许这 1 格 → 整体拦截本次按键（不移动、不发事件、不改变任何状态）。
//   - 【移动后】hook：走完整段路径后触发一次，params.distance = 本次走过的格数
//     （蒲公英田块按这个提升价值，蹁跹天赋按这个回血）。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { Distance } from '../core/Distance.js';
import { Direction } from '../utils/Direction.js';
import { devLog } from '../core/Logger.js';
import { firePassHooksAlong, fireEnterHooks } from './MoveHooks.js';
import { CombatSystem } from './CombatSystem.js';
import { TalentSystem } from './TalentSystem.js';
import { VehicleSystem } from './VehicleSystem.js';
import { StaminaSystem } from './StaminaSystem.js';
import { normalizeTerrain } from '../data/terrains.js';

/** 该格地形是否为冰面 */
function isIce(gs, idx) {
  const tile = gs.map.outerTiles[idx];
  return !!tile && normalizeTerrain(tile.terrain) === 'terrain_ice';
}

/**
 * 计算本次移动的完整路径（含冰面滑行），不产生任何副作用。
 * @returns {number[]} 依次经过的格 idx（不含起点）；第一步不可走时返回 []
 */
export function resolvePath(gs, dirIdx) {
  const startIdx = gs.player.x;
  const path = [];

  let cur = startIdx;
  let next = Distance.outerNeighbors(gs.map, cur)[dirIdx];
  if (next === null || next === undefined) return [];
  path.push(next);
  cur = next;

  // 冰面滑行：只要落在冰面上，就继续沿同一方向前进；无法直行（拐角/边界）则停下
  let guard = 0;
  while (isIce(gs, cur) && guard++ < 64) {
    const ahead = Distance.outerNeighbors(gs.map, cur)[dirIdx];
    if (ahead === null || ahead === undefined) break;   // 必须转弯 → 停在冰面上
    if (path.includes(ahead)) break;                    // 环形地图防死循环
    path.push(ahead);
    cur = ahead;
  }
  return path;
}

/** 记录"本日进入过的地块"（momo 图腾优先传送用） */
function markVisited(gs, idx) {
  if (!Array.isArray(gs.player.visitedTodayIdx)) gs.player.visitedTodayIdx = [];
  if (!gs.player.visitedTodayIdx.includes(idx)) gs.player.visitedTodayIdx.push(idx);
}

/**
 * 尝试移动玩家
 * @param {object} gs 全局状态（会被直接修改）
 * @param {string} direction 'up' | 'right' | 'down' | 'left'
 * @returns {{ ok: boolean, finalIdx: number|null, byVehicle: boolean, blocked: boolean }}
 *   移动成功时 finalIdx 为最终停留格 idx。
 *   blocked=true 表示「装备了载具但该载具不允许这 1 格」→ 本次按键整体拦截：
 *   不移动、不扣行动力、不推进回合、不触发冷却、不消耗次数、不卸下载具、不发任何事件。
 *   byVehicle=true 表示本次按「使用载具」结算（已由 VehicleSystem 发 MOVE/byVehicle 等事件）。
 */
export function moveStep(gs, direction) {
  const dirIdx = Direction.dirToIndex(direction);
  if (dirIdx === -1) {
    devLog.warn('[MovementSystem] 非法方向:', direction);
    return { ok: false, finalIdx: null, byVehicle: false, blocked: false };
  }

  const fromIdx = gs.player.x;
  // 「走 1 格」的目标格：只看相邻一格（不含冰面滑行 —— 滑行是徒步专属的地形位移）
  const stepIdx = Distance.outerNeighbors(gs.map, fromIdx)[dirIdx];
  // 载具三态判定：无载具 / 允许（按载具结算）/ 不允许（整体拦截）
  const vehicleStep = VehicleSystem.canUseVehicleForStep(gs, stepIdx);

  if (stepIdx === null || stepIdx === undefined) {
    // 该方向没有相邻格（边界/栅栏内侧）：装备载具时同样按「载具不允许」静默拦截
    if (vehicleStep.status !== VehicleSystem.VEHICLE_STEP_STATUS.NO_VEHICLE) {
      devLog.info('[MovementSystem] 载具不允许该方向，按键拦截:', direction);
      return { ok: false, finalIdx: null, byVehicle: false, blocked: true };
    }
    devLog.info('[MovementSystem] 方向', direction, '不可通行');
    EventBus.emit(GE.MOVE_BLOCKED, { direction, currentIdx: fromIdx });
    return { ok: false, finalIdx: null, byVehicle: false, blocked: false };
  }

  // 装备了载具但该载具不允许这 1 格 → 直接阻止本次 WASD（无提示、无联动、不改变任何状态）
  if (vehicleStep.status === VehicleSystem.VEHICLE_STEP_STATUS.BLOCKED) {
    devLog.info('[MovementSystem] 载具不允许该格，按键拦截:', vehicleStep.reason);
    return { ok: false, finalIdx: null, byVehicle: false, blocked: true };
  }

  // 载具允许：收敛到 VehicleSystem.tryMove 的统一载具流程
  // （消耗次数 / 唯一终点结算 / MOVE { byVehicle:true } → 移形等联动）
  if (vehicleStep.status === VehicleSystem.VEHICLE_STEP_STATUS.ALLOWED) {
    const r = VehicleSystem.tryMove(gs, { targetIdx: stepIdx, wasdStep: true });
    if (r.ok) {
      devLog.info('[MovementSystem] WASD 载具移动成功:', fromIdx, '→', r.finalIdx);
      return { ok: true, finalIdx: r.finalIdx, byVehicle: true, blocked: false };
    }
    // 载具已装备时不做徒步兜底（否则等于绕过载具规则）；按整体拦截处理
    devLog.info('[MovementSystem] WASD 载具移动未生效，按键拦截:', r.reason);
    return { ok: false, finalIdx: null, byVehicle: false, blocked: true };
  }

  // 徒步：未装备载具，WASD 走 1 步；冰面会额外滑行（滑行不额外扣行动力）
  const path = resolvePath(gs, dirIdx);
  if (path.length === 0) {
    devLog.info('[MovementSystem] 方向', direction, '不可通行');
    EventBus.emit(GE.MOVE_BLOCKED, { direction, currentIdx: gs.player.x });
    return { ok: false, finalIdx: null, byVehicle: false, blocked: false };
  }

  const finalIdx = path[path.length - 1];

  // 1. 扣 stamina：整段移动只扣 1 点（滑行是"被迫"的，不额外消耗）
  //    移动是玩家主动操作：允许透支为负，但不低于下限（StaminaSystem 统一夹取）
  const isFreeMove = !!gs.player.nextMoveNoStamina;
  if (isFreeMove) {
    gs.player.nextMoveNoStamina = false; // 用掉即清，不可叠加
    devLog.info('[MovementSystem] 芋圆免行动力触发，本次移动不扣 stamina');
  } else {
    StaminaSystem.spendStaminaActive(gs, 1, { reason: 'move' });
  }

  // 2. 逐格结算【经过时】：冰面滑行经过的每一格都算（起点不算，含终点）
  //    与载具共用 MoveHooks 的同一条路径结算
  firePassHooksAlong(gs, path);

  // 2b. 粘液 debuff：仅最终停留格结算（§15「进入该格时」；冰面滑行经过的中间格不触发）
  {
    const tile = gs.map.outerTiles[finalIdx];
    if (tile && Array.isArray(tile.states)) {
      const slimeIdx = tile.states.findIndex((s) => s.type === 'slime');
      if (slimeIdx >= 0) {
        // 注：粘液是地块 debuff（§15），不是生物主动攻击，不受生物停战阻挡
        CombatSystem.applyTrueDamageToPlayer(gs, gs.player, 5, { reason: 'slime_hit' });
        // 粘液是负面效果扣除：不允许把行动力扣到 0 以下
        StaminaSystem.loseStaminaNegativeEffect(gs, 1, { reason: 'slime_hit' });
        tile.states.splice(slimeIdx, 1);
        EventBus.emit(GE.TOAST_SHOW, { text: '🟢 粘液：hp -5 stamina -1', duration: 1500 });
        devLog.info('[MovementSystem] slime state triggered → removed');
      }
    }
  }

  // 3. 更新玩家位置（冰面滑行的终点）
  gs.player.x = finalIdx;
  for (const idx of path) markVisited(gs, idx);

  // 4. 触发【进入时】：仅最终停留格
  fireEnterHooks(gs, finalIdx);

  // 5. 广播 MOVE 事件（路径长度 = 本次经过的格数，与载具口径一致）
  const distance = path.length;
  EventBus.emit(GE.MOVE, { fromIdx, toIdx: finalIdx, direction, path, distance });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: fromIdx });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: finalIdx });

  // 6. 【移动后】：走完整段路径后触发一次（距离 = 本次经过的格数）
  // 移形（SKL-L-008）：累计本日移动距离（本日内每经过 1 格倍率 +5%）
  if (!gs.team) gs.team = {};
  gs.team.dailyDistanceMoved = (gs.team.dailyDistanceMoved || 0) + distance;
  HookDispatcher.fire('onMoveEnd', { gs, distance, fromIdx, toIdx: finalIdx });
  TalentSystem.onMoveEnd(gs);

  // 7. 徒步语义：不消耗载具次数、不触发任何载具联动
  //    （载具允许该格时已在上方走 VehicleSystem.tryMove，不会走到这里）

  if (distance > 1) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🧊 冰面滑行 ${distance} 格`, duration: 1200 });
  }
  devLog.info('[MovementSystem] 移动成功:', fromIdx, '→', finalIdx, direction, 'distance=', distance);
  return { ok: true, finalIdx, byVehicle: false, blocked: false };
}

/**
 * 兼容旧调用：只关心最终停留格（失败 null）。
 * 需要区分「载具移动 / 徒步」时请用 moveStep。
 * @param {object} gs
 * @param {string} direction
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
};
