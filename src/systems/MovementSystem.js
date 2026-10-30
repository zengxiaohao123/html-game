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
//     使用载具移动不受滑行影响（走 VehicleSystem，不经过这里）。
//   - 【移动后】hook：走完整段路径后触发一次，params.distance = 本次走过的格数
//     （蒲公英田地按这个提升价值，蹁跹天赋按这个回血）。

import { EventBus } from '../core/EventBus.js';
import { GE } from '../core/GameEvents.js';
import { HookDispatcher } from '../core/HookDispatcher.js';
import { Distance } from '../core/Distance.js';
import { Direction } from '../utils/Direction.js';
import { devLog } from '../core/Logger.js';
import { SkillSystem } from './SkillSystem.js';
import { CombatSystem } from './CombatSystem.js';
import { TalentSystem } from './TalentSystem.js';
import { VehicleSystem } from './VehicleSystem.js';
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
  let next = Distance.outerNeighbors(gs.map.size, cur)[dirIdx];
  if (next === null || next === undefined) return [];
  path.push(next);
  cur = next;

  // 冰面滑行：只要落在冰面上，就继续沿同一方向前进；无法直行（拐角/边界）则停下
  let guard = 0;
  while (isIce(gs, cur) && guard++ < 64) {
    const ahead = Distance.outerNeighbors(gs.map.size, cur)[dirIdx];
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
 * @returns {number|null} 移动成功返回最终停留格 idx，失败返回 null
 */
export function move(gs, direction) {
  const dirIdx = Direction.dirToIndex(direction);
  if (dirIdx === -1) {
    devLog.warn('[MovementSystem] 非法方向:', direction);
    return null;
  }

  // WASD 永远只走 1 步；冰面会额外滑行（滑行不额外扣行动力）
  // 载具的"一次移动更远"只通过 InfoPanel 点击「前往」走 VehicleSystem.tryMove
  const path = resolvePath(gs, dirIdx);
  if (path.length === 0) {
    devLog.info('[MovementSystem] 方向', direction, '不可通行');
    EventBus.emit(GE.MOVE_BLOCKED, { direction, currentIdx: gs.player.x });
    return null;
  }

  const fromIdx = gs.player.x;
  const finalIdx = path[path.length - 1];

  // 1. 扣 stamina：整段移动只扣 1 点（滑行是"被迫"的，不额外消耗）
  const isFreeMove = !!gs.player.nextMoveNoStamina;
  if (isFreeMove) {
    gs.player.nextMoveNoStamina = false; // 用掉即清，不可叠加
    devLog.info('[MovementSystem] 芋圆免行动力触发，本次移动不扣 stamina');
  } else {
    gs.player.stamina -= 1;
    EventBus.emit(GE.STAMINA_CHANGE, {
      newValue: gs.player.stamina,
      delta: -1,
      maxStamina: gs.player.maxStamina,
    });
  }

  // 2. 逐格结算【经过时】：冰面滑行经过的每一格都算（起点不算，含终点）
  for (const idx of path) {
    HookDispatcher.fire('onPass', { gs, tileIdx: idx });
    SkillSystem.triggerSkillByHook('onPass', { gs, tileIdx: idx });

    // 粘液 debuff：进入该格时 hp -5、stamina -1，然后移除
    const tile = gs.map.outerTiles[idx];
    if (tile && Array.isArray(tile.states)) {
      const slimeIdx = tile.states.findIndex((s) => s.type === 'slime');
      if (slimeIdx >= 0) {
        CombatSystem.applyTrueDamageToPlayer(gs.player, 5, { reason: 'slime_hit' });
        gs.player.stamina -= 1;
        EventBus.emit(GE.STAMINA_CHANGE, {
          newValue: gs.player.stamina, delta: -1, maxStamina: gs.player.maxStamina,
        });
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
  HookDispatcher.fire('onEnter', { gs, tileIdx: finalIdx });
  SkillSystem.triggerSkillByHook('onEnter', { gs, tileIdx: finalIdx });

  // 5. 广播 MOVE 事件
  EventBus.emit(GE.MOVE, { fromIdx, toIdx: finalIdx, direction, path });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: fromIdx });
  EventBus.emit(GE.TILE_UPDATED, { tileIdx: finalIdx });

  // 6. 【移动后】：走完整段路径后触发一次（距离 = 本次经过的格数）
  const distance = path.length;
  HookDispatcher.fire('onMoveEnd', { gs, distance, fromIdx, toIdx: finalIdx });
  TalentSystem.onMoveEnd(gs);

  // 7. 装备载具时：WASD 1 步移动也消耗 1 次载具使用次数（载具用完自动卸下）
  if (gs.vehicle?.current) {
    VehicleSystem.useOnce(gs);
  }

  if (distance > 1) {
    EventBus.emit(GE.TOAST_SHOW, { text: `🧊 冰面滑行 ${distance} 格`, duration: 1200 });
  }
  devLog.info('[MovementSystem] 移动成功:', fromIdx, '→', finalIdx, direction, 'distance=', distance);
  return finalIdx;
}

export const MovementSystem = {
  move,
  resolvePath,
};
